#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import json
import os
import urllib.error
import unittest
from pathlib import Path
from unittest.mock import patch


ADAPTER_PATH = Path(__file__).resolve().parents[1] / "http_model_adapter.py"
SPEC = importlib.util.spec_from_file_location("http_model_adapter", ADAPTER_PATH)
assert SPEC and SPEC.loader
adapter = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(adapter)


class FakeResponse:
    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self):
        return json.dumps({
            "model": "producer-frozen-v1",
            "choices": [{"message": {"content": "{\"artifact_text\":\"ok\"}"}}],
            "usage": {"prompt_tokens": 10, "completion_tokens": 4},
        }).encode("utf-8")


class FakeCodeFenceResponse:
    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self):
        return json.dumps({
            "model": "producer-frozen-v1",
            "choices": [{"message": {"content": "```json\n{\"artifact_text\":\"ok\"}\n```"}}],
            "usage": {"prompt_tokens": 10, "completion_tokens": 4},
        }).encode("utf-8")


class HttpModelAdapterTests(unittest.TestCase):
    def setUp(self):
        adapter.QUOTA_BLOCKED_PROFILES.clear()

    def request(self):
        return {
            "request_id": "req-1",
            "role": "same_evidence_direct_generator",
            "model_profile": "producer",
            "messages": [{"role": "user", "content": "return json"}],
            "temperature": 0,
            "seed": 11,
            "max_output_tokens": 100,
            "response_schema": {"type": "object", "properties": {"artifact_text": {"type": "string"}}, "required": ["artifact_text"]},
        }

    @patch.dict(os.environ, {
        "EVAL_PRODUCER_API_KEY": "do-not-log-this-secret",
        "EVAL_PRODUCER_BASE_URL": "https://models.example/v1",
        "EVAL_PRODUCER_MODEL": "producer-frozen-v1",
        "EVAL_PRODUCER_API_STYLE": "chat_completions",
    }, clear=False)
    @patch.object(adapter.urllib.request, "urlopen", return_value=FakeResponse())
    def test_chat_adapter_returns_protocol_response_without_secret(self, mocked_open):
        response = adapter.invoke(self.request(), "producer")
        self.assertEqual(response["status"], "ok")
        self.assertEqual(response["request_id"], "req-1")
        self.assertEqual(response["result"], {"artifact_text": "ok"})
        self.assertNotIn("do-not-log-this-secret", json.dumps(response))
        sent_request = mocked_open.call_args.args[0]
        self.assertEqual(sent_request.full_url, "https://models.example/v1/chat/completions")
        body = json.loads(sent_request.data)
        self.assertEqual(body["response_format"]["type"], "json_schema")

    @patch.dict(os.environ, {}, clear=True)
    def test_missing_key_is_structured_and_does_not_call_network(self):
        with self.assertRaisesRegex(RuntimeError, "EVAL_PRODUCER_API_KEY"):
            adapter.invoke(self.request(), "producer")

    @patch.dict(os.environ, {
        "EVAL_PRODUCER_API_KEY": "do-not-log-this-secret",
        "EVAL_PRODUCER_BASE_URL": "https://models.example/v1",
        "EVAL_PRODUCER_MODEL": "producer-frozen-v1",
        "EVAL_PRODUCER_API_STYLE": "chat_completions",
    }, clear=False)
    @patch.object(adapter.urllib.request, "urlopen", return_value=FakeCodeFenceResponse())
    def test_code_fence_json_is_parsed(self, _mocked_open):
        response = adapter.invoke(self.request(), "producer")
        self.assertEqual(response["status"], "ok")
        self.assertEqual(response["result"], {"artifact_text": "ok"})

    @patch.dict(os.environ, {
        "EVAL_PRODUCER_API_KEY": "do-not-log-this-secret",
        "EVAL_PRODUCER_BASE_URL": "https://models.example/v1",
        "EVAL_PRODUCER_MODEL": "producer-frozen-v1",
        "EVAL_PRODUCER_API_STYLE": "chat_completions",
    }, clear=False)
    def test_402_blocks_followup_requests(self):
        err = urllib.error.HTTPError(
            url="https://models.example/v1/chat/completions",
            code=402,
            msg="Payment Required",
            hdrs=None,
            fp=None,
        )
        with patch.object(adapter.urllib.request, "urlopen", side_effect=err) as mocked_open:
            with self.assertRaises(urllib.error.HTTPError):
                adapter.invoke(self.request(), "producer")
            self.assertEqual(mocked_open.call_count, 1)
            with self.assertRaisesRegex(RuntimeError, "HTTP 402"):
                adapter.invoke(self.request(), "producer")
            self.assertEqual(mocked_open.call_count, 1)


if __name__ == "__main__":
    unittest.main()
