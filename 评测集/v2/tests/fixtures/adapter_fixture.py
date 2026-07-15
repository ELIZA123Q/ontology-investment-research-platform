#!/usr/bin/env python3
"""Small streaming adapters for retry, timeout and malformed-response tests."""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path


def valid_response(request: dict[str, object]) -> dict[str, object]:
    return {
        "request_id": request["request_id"],
        "status": "ok",
        "model_id": "fixture-model",
        "text": "{}",
        "result": {},
        "usage": {},
        "latency_ms": 0,
        "error": "",
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", required=True, choices=["valid", "invalid", "mismatch", "timeout", "flaky"])
    parser.add_argument("--state-file")
    parser.add_argument("--delay", type=float, default=0.2)
    args = parser.parse_args()

    for line in sys.stdin:
        request = json.loads(line)
        if args.mode == "invalid":
            sys.stdout.write("not-json\n")
        elif args.mode == "mismatch":
            response = valid_response(request)
            response["request_id"] = "wrong-request-id"
            sys.stdout.write(json.dumps(response) + "\n")
        elif args.mode == "timeout":
            time.sleep(args.delay)
            sys.stdout.write(json.dumps(valid_response(request)) + "\n")
        elif args.mode == "flaky":
            if not args.state_file:
                raise SystemExit("flaky mode requires --state-file")
            state = Path(args.state_file)
            if not state.exists():
                state.write_text("failed-once\n", encoding="utf-8")
                sys.stdout.write("not-json\n")
            else:
                sys.stdout.write(json.dumps(valid_response(request)) + "\n")
        else:
            sys.stdout.write(json.dumps(valid_response(request)) + "\n")
        sys.stdout.flush()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
