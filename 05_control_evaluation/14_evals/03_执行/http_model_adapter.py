#!/usr/bin/env python3
"""Streaming JSONL adapter for OpenAI-compatible chat or Responses APIs.

Each profile is configured only through environment variables. Secrets are never
copied into protocol responses or logs.
"""

from __future__ import annotations

import argparse
import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[3]  # .../05_control_evaluation/14_evals/03_执行
QUOTA_BLOCKED_PROFILES: set[str] = set()


def _ssl_context() -> ssl.SSLContext:
    try:
        import certifi  # type: ignore

        return ssl.create_default_context(cafile=certifi.where())
    except Exception:
        return ssl.create_default_context()


def _bootstrap_eval_env_from_runtime_local() -> None:
    """Load 06_runtime/.env.local into EVAL_* when eval harness env is unset."""
    env_path = REPO_ROOT / "06_runtime" / ".env.local"
    if not env_path.is_file():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, _, value = stripped.partition("=")
        key, value = key.strip(), value.strip()
        if key and key not in os.environ:
            os.environ[key] = value
    api_key = os.environ.get("DEEPSEEK_API_KEY", "")
    if not api_key:
        return
    base_url = os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com")
    producer_model = os.environ.get("DEEPSEEK_MODEL", "deepseek-v4-flash")
    review_model = os.environ.get("DEEPSEEK_REVIEW_MODEL", "deepseek-v4-flash")
    for role in ("PRODUCER", "JUDGE_A", "JUDGE_B", "DOWNSTREAM_A", "DOWNSTREAM_B"):
        os.environ.setdefault(f"EVAL_{role}_API_KEY", api_key)
        os.environ.setdefault(f"EVAL_{role}_BASE_URL", base_url)
        os.environ.setdefault(f"EVAL_{role}_API_STYLE", "chat_completions")
    os.environ.setdefault("EVAL_PRODUCER_MODEL", producer_model)
    for role in ("JUDGE_A", "JUDGE_B", "DOWNSTREAM_A", "DOWNSTREAM_B"):
        os.environ.setdefault(f"EVAL_{role}_MODEL", review_model)


_bootstrap_eval_env_from_runtime_local()


def profile_prefix(profile: str) -> str:
    return "EVAL_" + "".join(character if character.isalnum() else "_" for character in profile.upper())


def setting(profile: str, name: str, fallback: str = "") -> str:
    prefix = profile_prefix(profile)
    value = os.environ.get(f"{prefix}_{name}")
    if value is not None:
        return value
    if name == "API_KEY":
        return os.environ.get("DEEPSEEK_API_KEY") or os.environ.get("OPENAI_API_KEY", fallback)
    if name == "BASE_URL":
        return os.environ.get("DEEPSEEK_BASE_URL") or os.environ.get("OPENAI_BASE_URL", fallback)
    if name == "MODEL" and profile == "producer":
        return os.environ.get("DEEPSEEK_MODEL", fallback)
    if name == "MODEL":
        return os.environ.get("DEEPSEEK_REVIEW_MODEL") or os.environ.get("DEEPSEEK_MODEL", fallback)
    return fallback


def extract_responses_text(payload: dict[str, Any]) -> str:
    if payload.get("output_text"):
        return str(payload["output_text"])
    chunks: list[str] = []
    for output in payload.get("output") or []:
        for content in output.get("content") or []:
            if content.get("type") in {"output_text", "text"} and content.get("text"):
                chunks.append(str(content["text"]))
    return "".join(chunks)


def parse_model_json(text: str) -> Any:
    stripped = text.strip()
    if stripped.startswith("```"):
        lines = stripped.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        stripped = "\n".join(lines).strip()
    return json.loads(stripped)


def _deepseek_compat(base_url: str, model: str) -> bool:
    blob = f"{base_url} {model}".lower()
    return "deepseek" in blob


def request_payload(
    request: dict[str, Any],
    profile: str,
    model: str,
    api_style: str,
    *,
    base_url: str = "",
) -> dict[str, Any]:
    messages = list(request.get("messages") or [])
    schema = request.get("response_schema") or {}
    max_tokens = int(request.get("max_output_tokens") or 4096)
    if api_style == "responses":
        payload: dict[str, Any] = {"model": model, "input": messages, "max_output_tokens": max_tokens}
        if schema:
            payload["text"] = {
                "format": {
                    "type": "json_schema",
                    "name": f"eval_{request.get('role', 'result')}",
                    "strict": True,
                    "schema": schema,
                }
            }
        reasoning_effort = setting(profile, "REASONING_EFFORT", "")
        if reasoning_effort:
            payload["reasoning"] = {"effort": reasoning_effort}
        return payload

    payload = {
        "model": model,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": request.get("temperature", 0),
        "seed": request.get("seed"),
    }
    if schema:
        if _deepseek_compat(base_url, model):
            schema_hint = json.dumps(schema, ensure_ascii=False)
            hint = (
                f"\n\n你必须只返回一个合法 JSON 对象，不要使用 Markdown 代码块。"
                f"返回值必须符合以下 JSON Schema：\n{schema_hint}"
            )
            if messages and messages[0].get("role") == "system":
                messages[0] = {**messages[0], "content": str(messages[0].get("content", "")) + hint}
            else:
                messages.insert(0, {"role": "system", "content": hint.strip()})
            payload["messages"] = messages
            payload["response_format"] = {"type": "json_object"}
        else:
            payload["response_format"] = {
                "type": "json_schema",
                "json_schema": {
                    "name": f"eval_{request.get('role', 'result')}",
                    "strict": True,
                    "schema": schema,
                },
            }
    return {key: value for key, value in payload.items() if value is not None}


def invoke(request: dict[str, Any], profile: str) -> dict[str, Any]:
    started = time.monotonic()
    request_id = str(request.get("request_id") or "")
    api_key = setting(profile, "API_KEY")
    base_url = setting(profile, "BASE_URL", "https://api.openai.com/v1").rstrip("/")
    model = setting(profile, "MODEL", str(request.get("model_profile") or ""))
    api_style = setting(profile, "API_STYLE", "chat_completions").lower()
    if not request_id:
        raise ValueError("request_id is required")
    if profile in QUOTA_BLOCKED_PROFILES:
        raise RuntimeError("model endpoint HTTP 402")
    if not api_key:
        raise RuntimeError(f"missing {profile_prefix(profile)}_API_KEY")
    if not model:
        raise RuntimeError(f"missing {profile_prefix(profile)}_MODEL")
    if api_style not in {"chat_completions", "responses"}:
        raise RuntimeError("API_STYLE must be chat_completions or responses")
    endpoint = f"{base_url}/responses" if api_style == "responses" else f"{base_url}/chat/completions"
    body = request_payload(request, profile, model, api_style, base_url=base_url)
    timeout = float(setting(profile, "TIMEOUT_SECONDS", "120"))
    max_attempts = int(setting(profile, "MAX_ATTEMPTS", "4"))
    retryable_http = {408, 409, 425, 429, 500, 502, 503, 504}
    last_error: Exception | None = None
    for attempt in range(max_attempts):
        try:
            raw_request = urllib.request.Request(
                endpoint,
                data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(raw_request, timeout=timeout, context=_ssl_context()) as response:  # noqa: S310
                payload = json.loads(response.read().decode("utf-8"))
            if api_style == "responses":
                text = extract_responses_text(payload)
            else:
                text = str(payload["choices"][0]["message"].get("content") or "")
            if not text.strip():
                raise RuntimeError("model returned empty text")
            try:
                result = parse_model_json(text)
            except json.JSONDecodeError as exc:
                raise RuntimeError(f"model did not return valid JSON: {exc}") from exc
            return {
                "request_id": request_id,
                "status": "ok",
                "model_id": str(payload.get("model") or model),
                "text": text,
                "result": result,
                "usage": payload.get("usage") or {},
                "latency_ms": round((time.monotonic() - started) * 1000),
                "error": None,
            }
        except urllib.error.HTTPError as exc:
            last_error = exc
            if exc.code == 402:
                QUOTA_BLOCKED_PROFILES.add(profile)
                raise
            if exc.code not in retryable_http or attempt + 1 >= max_attempts:
                raise
            time.sleep(min(2**attempt, 8))
        except (urllib.error.URLError, TimeoutError, RuntimeError) as exc:
            last_error = exc
            message = str(exc)
            retryable = any(
                token in message
                for token in (
                    "UNEXPECTED_EOF",
                    "empty text",
                    "valid JSON",
                    "timed out",
                    "Connection reset",
                )
            )
            if not retryable or attempt + 1 >= max_attempts:
                raise
            time.sleep(min(2**attempt, 8))
    raise last_error or RuntimeError("model request failed")


def error_response(request: dict[str, Any], profile: str, error: Exception, started: float) -> dict[str, Any]:
    if isinstance(error, urllib.error.HTTPError):
        message = f"model endpoint HTTP {error.code}"
    elif isinstance(error, urllib.error.URLError):
        message = f"model endpoint unavailable: {error.reason}"
    else:
        message = str(error)
    return {
        "request_id": str(request.get("request_id") or ""),
        "status": "error",
        "model_id": setting(profile, "MODEL", str(request.get("model_profile") or "unknown")),
        "text": "",
        "result": {},
        "usage": {},
        "latency_ms": round((time.monotonic() - started) * 1000),
        "error": message[:1000],
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--profile", required=True)
    args = parser.parse_args()
    cache: dict[str, dict[str, Any]] = {}
    for line in sys.stdin:
        if not line.strip():
            continue
        started = time.monotonic()
        try:
            request = json.loads(line)
            request_id = str(request.get("request_id") or "")
            response = cache.get(request_id) or invoke(request, args.profile)
            if request_id:
                cache[request_id] = response
        except Exception as exc:  # noqa: BLE001 - protocol must return structured errors
            request = locals().get("request") if isinstance(locals().get("request"), dict) else {}
            response = error_response(request, args.profile, exc, started)
        print(json.dumps(response, ensure_ascii=False), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
