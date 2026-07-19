#!/usr/bin/env python3
"""Streaming JSONL adapter for OpenAI-compatible chat or Responses APIs.

Each profile is configured only through environment variables. Secrets are never
copied into protocol responses or logs.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from typing import Any


def profile_prefix(profile: str) -> str:
    return "EVAL_" + "".join(character if character.isalnum() else "_" for character in profile.upper())


def setting(profile: str, name: str, fallback: str = "") -> str:
    prefix = profile_prefix(profile)
    value = os.environ.get(f"{prefix}_{name}")
    if value is not None:
        return value
    if name == "API_KEY":
        return os.environ.get("OPENAI_API_KEY", fallback)
    if name == "BASE_URL":
        return os.environ.get("OPENAI_BASE_URL", fallback)
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


def request_payload(request: dict[str, Any], profile: str, model: str, api_style: str) -> dict[str, Any]:
    messages = request.get("messages") or []
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
    if not api_key:
        raise RuntimeError(f"missing {profile_prefix(profile)}_API_KEY")
    if not model:
        raise RuntimeError(f"missing {profile_prefix(profile)}_MODEL")
    if api_style not in {"chat_completions", "responses"}:
        raise RuntimeError("API_STYLE must be chat_completions or responses")
    endpoint = f"{base_url}/responses" if api_style == "responses" else f"{base_url}/chat/completions"
    body = request_payload(request, profile, model, api_style)
    raw_request = urllib.request.Request(
        endpoint,
        data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        method="POST",
    )
    timeout = float(setting(profile, "TIMEOUT_SECONDS", "120"))
    with urllib.request.urlopen(raw_request, timeout=timeout) as response:  # noqa: S310 - configured model endpoint
        payload = json.loads(response.read().decode("utf-8"))
    if api_style == "responses":
        text = extract_responses_text(payload)
    else:
        text = str(payload["choices"][0]["message"].get("content") or "")
    if not text:
        raise RuntimeError("model returned empty text")
    try:
        result = json.loads(text)
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
