from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from ir_platform.runtime.models import GraphBundle, RuntimeEntity, RuntimeRelation
from ir_platform.runtime.repository import ResearchGraphRepository


class ApprovalService:
    def __init__(self, repository: ResearchGraphRepository) -> None:
        self.repository = repository

    def approve(self, *, bundle_id: str, request_id: str, approver_id: str) -> RuntimeEntity:
        return self._record(bundle_id, request_id, approver_id, "approved")

    def reject(self, *, bundle_id: str, request_id: str, approver_id: str) -> RuntimeEntity:
        return self._record(bundle_id, request_id, approver_id, "rejected")

    def _record(self, bundle_id: str, request_id: str, approver_id: str, status: str) -> RuntimeEntity:
        request = self.repository.get_entity(request_id)
        if request is None or request.type != "ApprovalRequest" or request.bundle_id != bundle_id:
            raise ValueError("审批请求不存在或不属于当前研究运行")
        if not approver_id.strip():
            raise ValueError("正式审批必须提供人工 approver_id")
        now = datetime.now(timezone.utc)
        approval = RuntimeEntity(
            id=f"approval:{uuid4()}",
            type="ApprovalRecord",
            properties={
                "status": status,
                "approver_id": approver_id,
                "approver_type": "human",
                "request_id": request_id,
            },
            recorded_at=now,
            bundle_id=bundle_id,
        )
        relation = RuntimeRelation(
            id=f"approval-response:{uuid4()}",
            type="approvalRespondsTo",
            source_id=approval.id,
            target_id=request.id,
            recorded_at=now,
            bundle_id=bundle_id,
        )
        self.repository.add_bundle(
            GraphBundle(bundle_id=bundle_id, entities=[approval, request], relations=[relation])
        )
        self.repository.record_provenance(
            approval,
            activity_id=f"human-approval:{approval.id}",
            source=f"human:{approver_id}",
            used_entities=[request_id],
            agent_id=approver_id,
        )
        return approval

