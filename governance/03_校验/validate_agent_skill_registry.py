#!/usr/bin/env python3
"""Validate that every project Skill is registered in the Agent manifest."""

from __future__ import annotations

from pathlib import Path
import re
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parents[2]


AGENT_MANIFEST = ROOT / ".agents" / "agent.yaml"
SKILLS_ROOT = ROOT / ".agents" / "skills"


def fail(message: str) -> None:
    raise ValueError(message)


def load_yaml_file(path: Path) -> Any:
    try:
        value = yaml.safe_load(path.read_text(encoding="utf-8"))
    except Exception as exc:
        fail(f"{path.relative_to(ROOT).as_posix()} 不是合法 YAML: {exc}")
    if value is None:
        fail(f"{path.relative_to(ROOT).as_posix()} 为空")
    return value


def parse_markdown(path: Path) -> tuple[dict[str, Any], str]:
    text = path.read_text(encoding="utf-8")
    match = re.match(r"\A---\n(.*?)\n---\n(.*)\Z", text, re.S)
    if not match:
        fail(f"{path.relative_to(ROOT).as_posix()} 缺少 YAML front matter")
    meta = yaml.safe_load(match.group(1))
    if not isinstance(meta, dict):
        fail(f"{path.relative_to(ROOT).as_posix()} front matter 必须是对象")
    return meta, match.group(2)


def require_mapping(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        fail(f"{label} 必须是对象")
    return value


def require_list(value: Any, label: str) -> list[Any]:
    if not isinstance(value, list) or not value:
        fail(f"{label} 必须是非空列表")
    return value


def require_string(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        fail(f"{label} 必须是非空字符串")
    return value.strip()


def validate_repository() -> list[str]:
    errors: list[str] = []
    try:
        manifest = require_mapping(load_yaml_file(AGENT_MANIFEST), ".agents/agent.yaml")
        if manifest.get("schema_version") != "1.0":
            fail(".agents/agent.yaml.schema_version 必须为 1.0")
        skills = require_list(manifest.get("skills"), ".agents/agent.yaml.skills")
        workflow = require_list(manifest.get("workflow"), ".agents/agent.yaml.workflow")

        registered: dict[str, Path] = {}
        for index, item in enumerate(skills):
            skill = require_mapping(item, f"skills[{index}]")
            name = require_string(skill.get("name"), f"skills[{index}].name")
            path_text = require_string(skill.get("path"), f"skills[{index}].path")
            require_string(skill.get("owns"), f"skills[{index}].owns")
            require_string(skill.get("does_not_own"), f"skills[{index}].does_not_own")
            require_string(skill.get("required_when"), f"skills[{index}].required_when")
            path = ROOT / path_text
            if name in registered:
                fail(f"Skill 重复登记: {name}")
            if not path.is_file():
                fail(f"Skill 登记文件不存在: {path_text}")
            meta, _body = parse_markdown(path)
            if meta.get("name") != name:
                fail(f"{path_text} front matter name 与 agent 登记不一致")
            if not (path.parent / "agents" / "openai.yaml").is_file():
                fail(f"{path.parent.relative_to(ROOT).as_posix()} 缺少 agents/openai.yaml")
            registered[name] = path

        actual = {path.parent.name: path for path in SKILLS_ROOT.glob("*/SKILL.md")}
        missing = sorted(set(actual) - set(registered))
        stale = sorted(set(registered) - set(actual))
        if missing:
            fail("Skill 未登记到 Agent: " + ", ".join(missing))
        if stale:
            fail("Agent 登记了不存在的 Skill: " + ", ".join(stale))

        required_in_workflow: set[str] = set()
        for index, item in enumerate(workflow):
            stage = require_mapping(item, f"workflow[{index}]")
            for skill_name in require_list(stage.get("required_skills"), f"workflow[{index}].required_skills"):
                required_in_workflow.add(require_string(skill_name, f"workflow[{index}].required_skills[]"))
        unused = sorted(set(registered) - required_in_workflow)
        if unused:
            fail("Skill 未被任何阶段调用: " + ", ".join(unused))
    except Exception as exc:
        errors.append(str(exc))
    return errors


def main() -> int:
    errors = validate_repository()
    if errors:
        for error in errors:
            print(f"ERROR: {error}")
        print(f"AGENT_SKILL_REGISTRY_RETURN_REQUIRED: {len(errors)} error(s)")
        return 1
    print("AGENT_SKILL_REGISTRY_PASS: 所有 .agents/skills Skill 均已登记并被 Agent 阶段调用。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
