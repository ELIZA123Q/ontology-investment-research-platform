from __future__ import annotations

from abc import ABC, abstractmethod
from datetime import datetime
from typing import Any

from .models import GraphBundle, RuntimeEntity, RuntimeRelation


class ResearchGraphRepository(ABC):
    """研究图的唯一写入端口。业务层不得直接操作 Semantica。"""

    @abstractmethod
    def add_bundle(self, bundle: GraphBundle) -> None: ...

    @abstractmethod
    def add_entity(self, entity: RuntimeEntity) -> None: ...

    @abstractmethod
    def add_relation(self, relation: RuntimeRelation) -> None: ...

    @abstractmethod
    def get_entity(self, entity_id: str) -> RuntimeEntity | None: ...

    @abstractmethod
    def list_entities(self, bundle_id: str | None = None) -> list[RuntimeEntity]: ...

    @abstractmethod
    def list_relations(self, bundle_id: str | None = None) -> list[RuntimeRelation]: ...

    @abstractmethod
    def state_at(
        self,
        *,
        valid_at: datetime | None = None,
        recorded_at: datetime | None = None,
        bundle_id: str | None = None,
    ) -> GraphBundle: ...

    @abstractmethod
    def query_sparql(self, query: str) -> dict[str, Any]: ...

    @abstractmethod
    def record_provenance(
        self,
        entity: RuntimeEntity,
        *,
        activity_id: str,
        source: str,
        source_location: str | None = None,
        used_entities: list[str] | None = None,
        agent_id: str = "ir-platform",
    ) -> None: ...

