from __future__ import annotations

import json
from pathlib import Path
import tomllib

import yaml

from ir_platform.validation import validate_project


ROOT = Path(__file__).resolve().parents[1]
REQUIRED_PATHS = (
    "SKILL.md",
    "agents/openai.yaml",
    ".codex/agents/investment-research.toml",
    "src/ir_platform",
    "语义本体",
    "研究运行合同",
    "研究规则/rules.yaml",
    "研究能力/capabilities.yaml",
    "研究能力/logics.yaml",
    "研究方法/取证/method-registry.yaml",
    "研究方法/推理/method-registry.yaml",
)


def main() -> int:
    missing = [path for path in REQUIRED_PATHS if not (ROOT / path).exists()]
    if missing:
        raise SystemExit("安装不完整，缺少：" + ", ".join(missing))

    skill_text = (ROOT / "SKILL.md").read_text(encoding="utf-8")
    if not skill_text.startswith("---\n"):
        raise SystemExit("SKILL.md 缺少 YAML frontmatter")
    end = skill_text.find("\n---\n", 4)
    metadata = yaml.safe_load(skill_text[4:end])
    if metadata.get("name") != "ontology-investment-research":
        raise SystemExit("SKILL.md name 与安装名不一致")

    agent = yaml.safe_load((ROOT / "agents/openai.yaml").read_text(encoding="utf-8"))
    prompt = str((agent.get("interface") or {}).get("default_prompt", ""))
    if "$ontology-investment-research" not in prompt:
        raise SystemExit("agents/openai.yaml 未显式引用 Skill")

    custom_agent = tomllib.loads(
        (ROOT / ".codex" / "agents" / "investment-research.toml").read_text(encoding="utf-8")
    )
    mcp = (custom_agent.get("mcp_servers") or {}).get("akshare_mcp") or {}
    if mcp.get("command") != "uvx" or "9b6a22b6d83cce2a996a5072743bb06686040ce0" not in " ".join(
        mcp.get("args") or []
    ):
        raise SystemExit("专用 Agent 未固定默认 AkShare MCP 版本")

    ignored = (ROOT / ".gitignore").read_text(encoding="utf-8").splitlines()
    if not {"outputs/", "research_outputs/"}.issubset(set(ignored)):
        raise SystemExit("研究输出目录尚未从 Git 分发包排除")

    result = validate_project(ROOT)
    print(
        json.dumps(
            {"status": "ok", "skill": metadata["name"], "project_validation": result},
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
