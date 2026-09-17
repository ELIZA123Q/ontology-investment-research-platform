from __future__ import annotations

from datetime import date
from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field, HttpUrl, model_validator


ROOT = Path(__file__).resolve().parents[2]
SOURCE_ROLES = {"primary", "baseline", "mechanism", "cross_check", "counter", "discovery"}


class PublicSourceFamily(BaseModel):
    """Stable metadata for finding evidence; never stores changing research facts."""

    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1)
    producer: str = Field(min_length=1)
    source_roles: list[str] = Field(min_length=1)
    markets: list[str] = Field(min_length=1)
    domains: list[str] = Field(min_length=1)
    official_entry_url: HttpUrl
    query_playbook_ref: str = Field(min_length=1)
    access_scope: Literal["public", "licensed", "mixed"]
    update_cadence: str = Field(min_length=1)
    independence_group: str = Field(min_length=1)
    required_locator_level: str = Field(min_length=1)
    known_limitations: list[str] = Field(min_length=1)
    fallback_refs: list[str]
    last_verified: date

    @model_validator(mode="after")
    def validate_roles(self) -> "PublicSourceFamily":
        unknown = set(self.source_roles) - SOURCE_ROLES
        if unknown:
            raise ValueError(f"未知来源角色: {sorted(unknown)}")
        if len(self.source_roles) != len(set(self.source_roles)):
            raise ValueError("来源角色不得重复")
        return self


class PublicSourceIndex:
    """Machine-readable index of source families and their query playbooks."""

    DEFAULT_PATH = ROOT / "研究方法" / "取证" / "source-index.yaml"

    def __init__(self, path: str | Path = DEFAULT_PATH) -> None:
        self.path = Path(path)
        document = yaml.safe_load(self.path.read_text(encoding="utf-8")) or {}
        if document.get("schema_name") != "public_research_source_index":
            raise ValueError(f"{self.path}: schema_name 无效")
        items = document.get("sources")
        if not isinstance(items, list) or not items:
            raise ValueError(f"{self.path}: sources 必须是非空列表")
        self.schema_version = str(document.get("schema_version") or "")
        self._items: dict[str, PublicSourceFamily] = {}
        for raw in items:
            family = PublicSourceFamily.model_validate(raw)
            if family.id in self._items:
                raise ValueError(f"来源族 ID 重复: {family.id}")
            self._items[family.id] = family
        self._validate_references()

    def _validate_references(self) -> None:
        ids = set(self._items)
        base = self.path.parent
        for family in self._items.values():
            unknown_fallbacks = set(family.fallback_refs) - ids
            if unknown_fallbacks:
                raise ValueError(f"来源族 {family.id} 引用未知回退源: {sorted(unknown_fallbacks)}")
            raw_path, separator, anchor = family.query_playbook_ref.partition("#")
            if not separator or not anchor:
                raise ValueError(f"来源族 {family.id} 的 query_playbook_ref 必须包含查询编号")
            playbook = base / raw_path
            if not playbook.is_file():
                raise ValueError(f"来源族 {family.id} 的查询手册不存在: {playbook}")
            if anchor not in playbook.read_text(encoding="utf-8"):
                raise ValueError(f"来源族 {family.id} 的查询编号不存在: {anchor}")

    def resolve(self, identifier: str) -> PublicSourceFamily:
        try:
            return self._items[identifier]
        except KeyError as exc:
            raise KeyError(f"未知公开来源族: {identifier}") from exc

    def all(self) -> list[PublicSourceFamily]:
        return [self._items[key] for key in sorted(self._items)]

    def select(self, *, market: str | None = None, domain: str | None = None) -> list[PublicSourceFamily]:
        return [
            item
            for item in self.all()
            if (market is None or market in item.markets or "global" in item.markets)
            and (domain is None or domain in item.domains or "general" in item.domains)
        ]
