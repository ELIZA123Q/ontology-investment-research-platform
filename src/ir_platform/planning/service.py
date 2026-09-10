from __future__ import annotations

import hashlib
import json
from typing import Any, Callable

from ir_platform.execution.data_sources import FinancialDataSourceRegistry
from ir_platform.methodology import ResearchMethodRegistry
from ir_platform.rules import LogicRegistry, RuleEvaluator, RuleRegistry

from .models import PlanProposal, ProposedNode


class ResearchPlanningService:
    """AI 可提出计划，但输出始终只是 PlanProposal，必须再经过编译。"""

    def __init__(
        self,
        logics: LogicRegistry | None = None,
        rules: RuleRegistry | None = None,
        data_sources: FinancialDataSourceRegistry | None = None,
        methods: ResearchMethodRegistry | None = None,
        proposer: Callable[[dict[str, Any], dict[str, Any]], dict[str, Any]] | None = None,
    ) -> None:
        self.logics = logics or LogicRegistry()
        self.rules = rules or RuleRegistry()
        self.data_sources = data_sources or FinancialDataSourceRegistry()
        self.methods = methods or ResearchMethodRegistry()
        self.evaluator = RuleEvaluator()
        self.proposer = proposer

    def propose(self, request: dict[str, Any], state: dict[str, Any]) -> PlanProposal:
        if self.proposer:
            return PlanProposal.model_validate(self.proposer(request, state))
        context = {"request": request, "state": state}
        matched = [
            result
            for rule in self.rules.by_kind("routing")
            if (result := self.evaluator.evaluate(rule, context)).matched
        ]
        logic_refs = [
            action["invoke_logic"]
            for result in matched
            for action in result.actions
            if "invoke_logic" in action
        ]
        if len(logic_refs) != 1:
            raise ValueError(f"任务必须且只能匹配一个路由 Logic，实际为 {logic_refs}")
        logic = self.logics.resolve(logic_refs[0])
        default_data_source = self.data_sources.default()
        methodology = self.methods.resolve_for_request(request)
        available_types = set(state.get("available_types", []))
        selected_nodes = []
        for item in logic.nodes:
            activation_results = [
                self.evaluator.evaluate(rule, context)
                for rule_ref in item.activate_rule_refs
                if (rule := self.rules.resolve(rule_ref)).evaluation_phase != "runtime"
            ]
            if activation_results and not all(result.matched for result in activation_results):
                continue
            selected_nodes.append(item)
        selected_ids = {item.id for item in selected_nodes}
        nodes = []
        for item in selected_nodes:
            parameters = dict(item.parameters)
            if item.capability_ref == "acquire_evidence":
                parameters.setdefault("data_source_ref", default_data_source.id)
            if item.capability_ref == "resolve_semantic_context":
                parameters.setdefault("methodology", methodology)
            nodes.append(
                ProposedNode(
                    id=item.id,
                    capability_ref=item.capability_ref,
                    dependencies=[dep for dep in item.dependencies if dep in selected_ids],
                    activate_rule_refs=item.activate_rule_refs,
                    parameters=parameters,
                )
            )
        initial_types = sorted({*logic.input_types, *available_types})
        awaitable_types = ["ApprovalRecord"] if "PublishedReport" in logic.goal_types else []
        signature = json.dumps(
            {
                "request": request,
                "state": state,
                "logic": logic.id,
                "financial_data_source": f"{default_data_source.id}@{default_data_source.revision}",
            },
            ensure_ascii=False,
            sort_keys=True,
            default=str,
        )
        proposal_id = "proposal:" + hashlib.sha256(signature.encode("utf-8")).hexdigest()[:20]
        return PlanProposal(
            id=proposal_id,
            request_id=str(request["id"]),
            logic_ref=logic.id,
            selection_rule_refs=[result.rule_id for result in matched],
            nodes=nodes,
            initial_types=initial_types,
            awaitable_types=awaitable_types,
            goal_types=logic.goal_types,
            context={
                "request": request,
                "state": state,
                "financial_data_source": {
                    "id": default_data_source.id,
                    "version": default_data_source.version,
                    "revision": default_data_source.revision,
                    "credentials_required": default_data_source.credentials_required,
                    "formal_fact_policy": self.data_sources.formal_fact_policy,
                },
                "methodology": methodology,
            },
        )
