from __future__ import annotations

from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field, model_validator


ROOT = Path(__file__).resolve().parents[3]


class FinancialDataSourceDefinition(BaseModel):
    """外部金融数据 MCP 的稳定调用合同，不导入任何供应商实现。"""

    model_config = ConfigDict(extra="forbid")

    id: str
    version: str
    protocol: Literal["mcp"]
    transport: Literal["stdio", "streamable_http"]
    repository: str
    revision: str = Field(min_length=7)
    command: str
    args: list[str]
    credentials_required: bool
    markets: list[str]
    capabilities: list[str]
    preferred_tools: list[str]
    upstream_sources: list[str]
    restrictions: list[str]

    @model_validator(mode="after")
    def validate_runtime_contract(self) -> "FinancialDataSourceDefinition":
        if not self.command.strip() or not self.args:
            raise ValueError("金融数据 MCP 必须声明可执行命令和参数")
        if not self.markets or not self.capabilities:
            raise ValueError("金融数据 MCP 必须声明市场与能力范围")
        return self


class FinancialDataSourceRegistry:
    """读取默认金融数据源；规划器只依赖本注册表，不依赖具体 MCP 包。"""

    def __init__(self, path: str | Path = ROOT / "研究能力" / "data_sources.yaml") -> None:
        self.path = Path(path)
        document = yaml.safe_load(self.path.read_text(encoding="utf-8")) or {}
        raw_sources = document.get("sources")
        if not isinstance(raw_sources, dict) or not raw_sources:
            raise ValueError(f"{self.path}: sources 必须是非空对象")
        self.forbidden_source_ids = {str(item) for item in document.get("forbidden_source_ids", [])}
        self._items: dict[str, FinancialDataSourceDefinition] = {}
        for identifier, value in raw_sources.items():
            payload = dict(value or {})
            payload["id"] = str(identifier)
            definition = FinancialDataSourceDefinition.model_validate(payload)
            if definition.id in self.forbidden_source_ids:
                raise ValueError(f"禁用的数据源不得登记为可用源: {definition.id}")
            self._items[definition.id] = definition
        self.default_source_id = str(document.get("default_source") or "")
        if self.default_source_id in self.forbidden_source_ids:
            raise ValueError(f"默认金融数据源已被禁用: {self.default_source_id}")
        if self.default_source_id not in self._items:
            raise ValueError(f"默认金融数据源不存在: {self.default_source_id}")
        self.fallback_order = [str(item) for item in document.get("fallback_order", [])]
        self.formal_fact_policy = dict(document.get("formal_fact_policy") or {})

    def resolve(self, identifier: str) -> FinancialDataSourceDefinition:
        if identifier in self.forbidden_source_ids:
            raise KeyError(f"金融数据源已禁用: {identifier}")
        try:
            return self._items[identifier]
        except KeyError as exc:
            raise KeyError(f"未知金融数据源: {identifier}") from exc

    def default(self) -> FinancialDataSourceDefinition:
        return self.resolve(self.default_source_id)

    def all(self) -> list[FinancialDataSourceDefinition]:
        return [self._items[key] for key in sorted(self._items)]
