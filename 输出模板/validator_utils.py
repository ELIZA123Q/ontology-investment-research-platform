#!/usr/bin/env python3
"""Shared helpers for output-template contract validators."""

from __future__ import annotations

import csv
import hashlib
import json
import re
from pathlib import Path
from typing import Any, Iterable

import yaml


class UniqueKeyLoader(yaml.SafeLoader):
    """YAML loader that rejects duplicate keys inside one mapping."""


def _construct_mapping(loader: UniqueKeyLoader, node: yaml.Node, deep: bool = False) -> dict[str, Any]:
    mapping: dict[str, Any] = {}
    for key_node, value_node in node.value:
        key = loader.construct_object(key_node, deep=deep)
        if key in mapping:
            raise ValueError(f"YAML duplicate key: {key}")
        mapping[key] = loader.construct_object(value_node, deep=deep)
    return mapping


UniqueKeyLoader.add_constructor(yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, _construct_mapping)


def fail(message: str) -> None:
    raise ValueError(message)


def as_version(value: Any) -> str:
    return str(value).strip().strip('"').strip("'")


def require_schema_version(value: Any, label: str, *, expected: str) -> None:
    """校验显式声明的协议版本，避免默认版本掩盖模板升级。"""
    if as_version(value) != expected:
        fail(f"{label}.schema_version 必须为 {expected}")


def read_text(path: str | Path) -> str:
    return Path(path).read_text(encoding="utf-8-sig")


def file_sha256(path: str | Path) -> str:
    """Return the stable SHA-256 identifier for a frozen artifact."""
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return "sha256:" + digest.hexdigest()


def artifact_sha256(path: str | Path) -> str:
    artifact = Path(path)
    if artifact.is_file():
        return file_sha256(artifact)
    if not artifact.is_dir():
        fail(f"审阅对象不存在: {artifact}")
    digest = hashlib.sha256()
    for child in sorted(item for item in artifact.rglob("*") if item.is_file()):
        relative = child.relative_to(artifact).as_posix()
        digest.update(relative.encode("utf-8"))
        digest.update(b"\0")
        digest.update(file_sha256(child).encode("ascii"))
        digest.update(b"\n")
    return "sha256:" + digest.hexdigest()


def load_yaml_text(text: str, label: str = "YAML") -> Any:
    try:
        return yaml.load(text, Loader=UniqueKeyLoader)
    except Exception as exc:  # pragma: no cover - error path
        fail(f"{label} 不是合法 YAML: {exc}")


def load_yaml_file(path: str | Path) -> Any:
    path = Path(path)
    data = load_yaml_text(read_text(path), str(path))
    if data is None:
        fail(f"{path} 为空")
    return data


def parse_markdown(path: str | Path) -> tuple[dict[str, Any], str]:
    path = Path(path)
    text = read_text(path)
    match = re.match(r"\A---\n(.*?)\n---\n(.*)\Z", text, re.S)
    if not match:
        fail(f"{path} 缺少 YAML front matter")
    meta = load_yaml_text(match.group(1), f"{path} front matter")
    if not isinstance(meta, dict):
        fail(f"{path} front matter 必须是对象")
    return meta, match.group(2)


def require_keys(mapping: dict[str, Any], keys: Iterable[str], label: str) -> None:
    missing = [key for key in keys if key not in mapping]
    if missing:
        fail(f"{label} 缺少字段: {', '.join(missing)}")


def require_non_empty(value: Any, label: str) -> None:
    if value is None or value == "" or value == [] or value == {}:
        fail(f"{label} 不得为空")


def require_mapping(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        fail(f"{label} 必须是对象")
    return value


def require_list(value: Any, label: str, *, allow_empty: bool = False) -> list[Any]:
    if not isinstance(value, list):
        fail(f"{label} 必须是列表")
    if not allow_empty and not value:
        fail(f"{label} 必须是非空列表")
    return value


def require_string(value: Any, label: str, *, min_length: int = 1) -> str:
    if not isinstance(value, str):
        fail(f"{label} 必须是字符串")
    text = value.strip()
    if len(text) < min_length:
        fail(f"{label} 不得为空")
    return text


def require_allowed(value: Any, allowed: set[str], label: str) -> str:
    text = str(value)
    if text not in allowed:
        fail(f"{label} 非法: {value}")
    return text


def require_bool(value: Any, label: str) -> bool:
    if not isinstance(value, bool):
        fail(f"{label} 必须是布尔值")
    return value


def boolish(value: Any) -> bool | None:
    if isinstance(value, bool):
        return value
    text = str(value or "").strip().lower()
    if text in {"true", "yes", "y", "1"}:
        return True
    if text in {"false", "no", "n", "0"}:
        return False
    return None


def require_boolish(value: Any, label: str) -> bool:
    parsed = boolish(value)
    if parsed is None:
        fail(f"{label} 必须是布尔值或 true/false 文本")
    return parsed


PLACEHOLDER_RE = re.compile(r"<[^>\n]+>|待填写|待补充|TBD|TODO", re.I)


def _walk_strings(value: Any, path: str) -> Iterable[tuple[str, str]]:
    if isinstance(value, str):
        yield path, value
    elif isinstance(value, dict):
        for key, child in value.items():
            yield from _walk_strings(child, f"{path}.{key}" if path else str(key))
    elif isinstance(value, list):
        for index, child in enumerate(value):
            yield from _walk_strings(child, f"{path}[{index}]")


def require_no_placeholders(value: Any, label: str) -> None:
    hits: list[str] = []
    for path, text in _walk_strings(value, label):
        if PLACEHOLDER_RE.search(text):
            hits.append(path)
    if hits:
        fail(f"{label} 含未替换模板占位符: {', '.join(hits[:8])}")


def require_all_true(mapping: dict[str, Any], label: str) -> None:
    if not isinstance(mapping, dict) or not mapping:
        fail(f"{label} 必须是非空对象")
    failed = [key for key, value in mapping.items() if value is not True]
    if failed:
        fail(f"{label} 必须全部为 true: {', '.join(failed)}")


def require_no_forbidden_phrases(text: str, phrases: Iterable[str], label: str) -> None:
    hits = sorted({phrase for phrase in phrases if phrase and phrase in text})
    if hits:
        fail(f"{label} 含禁止或过宽表达: {', '.join(hits[:10])}")


def section_text(body: str, title: str, *, heading_level: int = 2) -> str:
    pattern = rf"^{'#' * heading_level}\s+(?:\d+[.、]\s*)?{re.escape(title)}(?:\s|：|$).*$"
    match = re.search(pattern, body, re.M)
    if not match:
        return ""
    next_match = re.search(rf"^{'#' * heading_level}\s+", body[match.end() :], re.M)
    end = match.end() + next_match.start() if next_match else len(body)
    return body[match.end() : end]


def require_body_sections(body: str, sections: Iterable[str], label: str) -> None:
    missing = [section for section in sections if section not in body]
    if missing:
        fail(f"{label} 缺少正文小节: {', '.join(missing)}")


def read_csv(path: str | Path) -> list[dict[str, str]]:
    path = Path(path)
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        if reader.fieldnames is None:
            fail(f"{path} 缺少表头")
        return [dict(row) for row in reader]


def read_csv_header(path: str | Path) -> list[str]:
    path = Path(path)
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.reader(handle)
        try:
            return next(reader)
        except StopIteration:
            fail(f"{path} 为空")


def split_refs(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        refs: list[str] = []
        for item in value:
            refs.extend(split_refs(item))
        return refs
    text = str(value).strip()
    if not text:
        return []
    return [part.strip() for part in re.split(r"[|,;，；]\s*", text) if part.strip()]


def ref_set(rows: Iterable[dict[str, Any]], key: str, label: str, allow_empty: bool = False) -> set[str]:
    refs = {str(row.get(key, "")).strip() for row in rows if str(row.get(key, "")).strip()}
    if not refs and not allow_empty:
        fail(f"{label}.{key} 至少需要一个 ID")
    return refs


def assert_subset(refs: Iterable[str], universe: set[str], label: str) -> None:
    unknown = sorted({ref for ref in refs if ref and ref not in universe})
    if unknown:
        fail(f"{label} 引用了不存在的 ID: {', '.join(unknown[:10])}")


def assert_values(values: Iterable[str], allowed: set[str], label: str) -> None:
    invalid = sorted({value for value in values if value and value not in allowed})
    if invalid:
        fail(f"{label} 存在非法取值: {', '.join(invalid)}")


def same_ref(a: Any, b: Any) -> bool:
    return str(a or "").strip() == str(b or "").strip()


def file_name(path: str | Path) -> str:
    return Path(path).name


def parse_triplet(path: str | Path, kind: str, stage: str | None = None) -> tuple[str, str, str]:
    name = file_name(path)
    prefix = rf"{re.escape(stage)}-" if stage else ""
    match = re.match(rf"^{prefix}(?P<topic>.+){re.escape(kind)}-(?P<date>\d{{8}})-(?P<seq>\d+)(?:\.[^.]+)?$", name)
    if not match:
        expected = f"{stage}-<核心主题>{kind}-<YYYYMMDD>-<当日序号>" if stage else f"<核心主题>{kind}-<YYYYMMDD>-<当日序号>"
        fail(f"{name} 文件名必须为 {expected}")
    return match.group("topic"), match.group("date"), match.group("seq")


def ok_payload(**payload: Any) -> str:
    return json.dumps({"ok": True, **payload}, ensure_ascii=False, indent=2)


def error_payload(error: Exception) -> str:
    return json.dumps({"ok": False, "error": str(error)}, ensure_ascii=False, indent=2)
