from __future__ import annotations

import hashlib
import json
import os
import threading
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, TimeoutError
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Callable
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

import akshare as ak

HOST = "127.0.0.1"
PORT = int(os.environ.get("VNEXT_AKSHARE_PORT", "3012"))
TOKEN = os.environ.get("VNEXT_INTERNAL_CONNECTOR_TOKEN", "")
CONNECTOR_ID = "akshare_public"
TIMEZONE = ZoneInfo("Asia/Shanghai")
TRUSTED_DISCLOSURE_HOSTS = {
    "www.cninfo.com.cn", "static.sse.com.cn", "www.sse.com.cn",
    "www.szse.cn", "www.bse.cn", "www.neeq.com.cn",
}
_cache: dict[str, tuple[float, Any]] = {}
_cache_lock = threading.Lock()


def cached(key: str, producer: Callable[[], Any], ttl: int = 900) -> Any:
    with _cache_lock:
        hit = _cache.get(key)
        if hit and time.time() - hit[0] < ttl:
            return hit[1]
    value = producer()
    with _cache_lock:
        _cache[key] = (time.time(), value)
    return value


def timed_call(producer: Callable[[], Any], timeout: int = 45) -> Any:
    executor = ThreadPoolExecutor(max_workers=1)
    future = executor.submit(producer)
    try:
        return future.result(timeout=timeout)
    except TimeoutError as error:
        future.cancel()
        raise RuntimeError(f"AKShare call exceeded {timeout}s") from error
    finally:
        executor.shutdown(wait=False, cancel_futures=True)


def text(value: Any) -> str:
    if value is None:
        return ""
    rendered = str(value).strip()
    return "" if rendered.lower() == "nan" else rendered


def iso_time(value: Any, fallback: datetime | None = None) -> str:
    raw = text(value)
    parsed: datetime
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        parsed = fallback or datetime.now(TIMEZONE)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=TIMEZONE)
    return parsed.isoformat()


def fingerprint(*parts: str) -> str:
    return "sha256:" + hashlib.sha256("\n".join(parts).encode("utf-8")).hexdigest()


def match_profile(profile: dict[str, Any], title: str, body: str, symbol: str = "") -> tuple[int, str] | None:
    symbols = [text(item) for item in profile.get("symbols", []) if text(item)]
    keywords = [text(item) for item in profile.get("keywords", []) if text(item)]
    reasons: list[str] = []
    score = 0
    if symbol and symbol in symbols:
        score += 30
        reasons.append(f"精确代码 {symbol}")
    for keyword in keywords:
        if keyword in title:
            score += 20
            reasons.append(f"标题命中“{keyword}”")
        elif keyword in body:
            score += 5
            reasons.append(f"正文命中“{keyword}”")
    return (score, "·".join(dict.fromkeys(reasons))) if score else None


def news_candidates(profile: dict[str, Any], captured_at: str) -> tuple[list[dict[str, Any]], list[str]]:
    errors: list[str] = []
    candidates: list[dict[str, Any]] = []
    queries = list(dict.fromkeys([*profile.get("symbols", []), *profile.get("keywords", [])]))[:12]
    for query in queries:
        query = text(query)
        if not query:
            continue
        try:
            frame = timed_call(lambda q=query: cached(f"news:{q}", lambda: ak.stock_news_em(symbol=q)))
        except Exception as error:  # upstream interfaces fail independently
            errors.append(f"news {query}: {error}")
            continue
        for _, row in frame.head(10).iterrows():
            title = text(row.get("新闻标题"))
            content = text(row.get("新闻内容")) or title
            uri = text(row.get("新闻链接"))
            if not title or not uri:
                continue
            symbol = query if query.isdigit() and len(query) == 6 else ""
            matched = match_profile(profile, title, content, symbol)
            if not matched:
                continue
            published_at = iso_time(row.get("发布时间"))
            score, reason = matched
            age_hours = max(0.0, (datetime.now(TIMEZONE) - datetime.fromisoformat(published_at)).total_seconds() / 3600)
            score += 10 if age_hours <= 24 else 5 if age_hours <= 168 else 0
            candidates.append({
                "connectorId": CONNECTOR_ID, "conversationId": profile["conversationId"], "kind": "news",
                "symbol": symbol or None, "title": title, "excerpt": content[:500], "content": content,
                "publisher": text(row.get("文章来源")) or "公开财经媒体", "sourceUri": uri,
                "sourceType": "secondary", "publishedAt": published_at, "capturedAt": captured_at,
                "matchReason": reason, "score": score, "fingerprint": fingerprint(uri, title, published_at),
            })
    return candidates, errors


def announcement_candidates(profiles: list[dict[str, Any]], captured_at: str) -> tuple[list[dict[str, Any]], list[str]]:
    day = datetime.now(TIMEZONE).strftime("%Y%m%d")
    try:
        frame = timed_call(lambda: cached(f"notices:{day}", lambda: ak.stock_notice_report(symbol="全部", date=day)))
    except Exception as error:
        return [], [f"announcements {day}: {error}"]
    results: list[dict[str, Any]] = []
    for _, row in frame.iterrows():
        symbol = text(row.get("代码")).zfill(6)
        company = text(row.get("名称"))
        title = text(row.get("公告标题"))
        uri = text(row.get("网址"))
        if not title or not uri:
            continue
        for profile in profiles:
            matched = match_profile(profile, f"{company} {title}", title, symbol)
            if not matched:
                continue
            score, reason = matched
            host = (urlparse(uri).hostname or "").lower()
            primary = host in TRUSTED_DISCLOSURE_HOSTS
            published_at = iso_time(row.get("公告日期"))
            content = f"{company}｜{title}｜{row.get('公告类型', '')}"
            results.append({
                "connectorId": CONNECTOR_ID, "conversationId": profile["conversationId"], "kind": "announcement",
                "symbol": symbol, "title": title, "excerpt": content[:500], "content": content,
                "publisher": company or "上市公司公告", "sourceUri": uri,
                "sourceType": "primary" if primary else "secondary", "publishedAt": published_at,
                "capturedAt": captured_at, "matchReason": reason, "score": score + 50 + (10 if primary else 0),
                "fingerprint": fingerprint(uri, title, published_at),
            })
    return results, []


def post_callback(url: str, token: str, payload: dict[str, Any]) -> None:
    request = urllib.request.Request(
        url,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        method="POST",
        headers={"content-type": "application/json", "x-vnext-connector-token": token},
    )
    with urllib.request.urlopen(request, timeout=10) as response:
        if response.status >= 300:
            raise RuntimeError(f"callback returned {response.status}")


def run_refresh(payload: dict[str, Any]) -> None:
    run_id = text(payload.get("runId"))
    profiles = [item for item in payload.get("profiles", []) if isinstance(item, dict) and item.get("enabled", True)]
    callback_url = text(payload.get("callbackUrl"))
    callback_token = text(payload.get("callbackToken"))
    captured_at = datetime.now(TIMEZONE).isoformat()
    candidates: list[dict[str, Any]] = []
    errors: list[str] = []
    started = time.monotonic()
    try:
        announcements, announcement_errors = announcement_candidates(profiles, captured_at)
        candidates.extend(announcements)
        errors.extend(announcement_errors)
        for profile in profiles:
            if time.monotonic() - started > 120:
                errors.append("refresh exceeded 120s; remaining queries skipped")
                break
            news, news_errors = news_candidates(profile, captured_at)
            candidates.extend(news)
            errors.extend(news_errors)
        deduplicated: dict[tuple[str, str], dict[str, Any]] = {}
        for candidate in candidates:
            key = (candidate["conversationId"], candidate["fingerprint"])
            previous = deduplicated.get(key)
            if previous is None or candidate["score"] > previous["score"]:
                deduplicated[key] = candidate
        ranked = sorted(deduplicated.values(), key=lambda item: (item["score"], item["publishedAt"]), reverse=True)
        per_conversation: dict[str, int] = {}
        limited: list[dict[str, Any]] = []
        for item in ranked:
            count = per_conversation.get(item["conversationId"], 0)
            if count >= 30:
                continue
            per_conversation[item["conversationId"]] = count + 1
            limited.append(item)
        status = "partial" if errors and limited else "failed" if errors else "completed"
        post_callback(callback_url, callback_token, {"runId": run_id, "status": status, "candidates": limited, "error": "; ".join(errors)[:2000] or None})
    except Exception as error:
        try:
            post_callback(callback_url, callback_token, {"runId": run_id, "status": "failed", "candidates": [], "error": str(error)[:2000]})
        except Exception:
            pass


class Handler(BaseHTTPRequestHandler):
    server_version = "vNext-AKShare/0.1"

    def log_message(self, format: str, *args: Any) -> None:
        print(f"akshare {self.address_string()} {format % args}", flush=True)

    def json_response(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if self.path != "/health":
            self.json_response(404, {"error": "not found"})
            return
        self.json_response(200, {"service": "vnext-akshare-connector", "status": "ready", "akshareVersion": ak.__version__})

    def do_POST(self) -> None:
        if self.path != "/refresh":
            self.json_response(404, {"error": "not found"})
            return
        if not TOKEN or self.headers.get("x-vnext-connector-token", "") != TOKEN:
            self.json_response(401, {"error": "unauthorized"})
            return
        try:
            length = min(int(self.headers.get("content-length", "0")), 1_000_000)
            payload = json.loads(self.rfile.read(length))
            threading.Thread(target=run_refresh, args=(payload,), daemon=True).start()
            self.json_response(202, {"status": "accepted", "runId": payload.get("runId")})
        except Exception as error:
            self.json_response(400, {"error": str(error)})


if __name__ == "__main__":
    print(f"vNext AKShare connector {ak.__version__} listening on http://{HOST}:{PORT}", flush=True)
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
