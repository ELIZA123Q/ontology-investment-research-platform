from __future__ import annotations

import os
from pathlib import Path
import tomllib

import yaml

from ir_platform.cli import build_parser


ROOT = Path(__file__).resolve().parents[1]


def test_repository_root_is_an_installable_skill() -> None:
    text = (ROOT / "SKILL.md").read_text(encoding="utf-8")
    assert text.startswith("---\n")
    end = text.find("\n---\n", 4)
    metadata = yaml.safe_load(text[4:end])
    assert metadata["name"] == "ontology-investment-research"

    agent = yaml.safe_load((ROOT / "agents" / "openai.yaml").read_text(encoding="utf-8"))
    assert "$ontology-investment-research" in agent["interface"]["default_prompt"]
    custom_agent_path = ROOT / ".codex" / "agents" / "investment-research.toml"
    custom_agent = tomllib.loads(custom_agent_path.read_text(encoding="utf-8"))
    assert custom_agent["mcp_servers"]["akshare_mcp"]["command"] == "uvx"
    assert "9b6a22b6d83cce2a996a5072743bb06686040ce0" in " ".join(
        custom_agent["mcp_servers"]["akshare_mcp"]["args"]
    )
    for name in ("bootstrap.sh", "doctor.sh", "ir-platform.sh", "demo.sh"):
        path = ROOT / "scripts" / name
        assert path.is_file()
        assert os.access(path, os.X_OK)


def test_cli_accepts_runtime_context_for_dynamic_execution() -> None:
    args = build_parser().parse_args(
        ["run", "plan:quickstart", "quickstart", "--context", "runtime-context.yaml"]
    )
    assert args.command == "run"
    assert args.context == "runtime-context.yaml"
