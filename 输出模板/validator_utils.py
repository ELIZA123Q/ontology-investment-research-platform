#!/usr/bin/env python3
"""Shared helpers for output-template contract validators."""

from __future__ import annotations

import csv
import json
import re
from pathlib import Path
from typing import Any, Iterable

import yaml


SCHEMA_VERSION = "1.0.0"


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


def require_schema_version(value: Any, label: str) -> None:
    if as_version(value) != SCHEMA_VERSION:
        fail(f"{label}.schema_version 必须为 {SCHEMA_VERSION}")


def read_text(path: str | Path) -> str:
    return Path(path).read_text(encoding="utf-8-sig")


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


def parse_triplet(path: str | Path, kind: str) -> tuple[str, str, str]:
    name = file_name(path)
    match = re.match(rf"^(?P<topic>.+){re.escape(kind)}-(?P<date>\d{{8}})-(?P<seq>\d+)(?:\.[^.]+)?$", name)
    if not match:
        fail(f"{name} 文件名必须为 <核心主题>{kind}-<YYYYMMDD>-<当日序号>")
    return match.group("topic"), match.group("date"), match.group("seq")


def ok_payload(**payload: Any) -> str:
    return json.dumps({"ok": True, **payload}, ensure_ascii=False, indent=2)


def error_payload(error: Exception) -> str:
    return json.dumps({"ok": False, "error": str(error)}, ensure_ascii=False, indent=2)
