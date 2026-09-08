from __future__ import annotations

from collections import defaultdict, deque

from ir_platform.rules import CapabilityDefinitionRegistry, LogicRegistry, RuleRegistry

from .models import ExecutionNode, ExecutionPlan, PlanProposal


class PlanCompilationError(ValueError):
    pass


class ExecutionPlanCompiler:
    """把不可信的计划提案编译成通过类型、权限和发布门槛检查的 DAG。"""

    def __init__(
        self,
        capabilities: CapabilityDefinitionRegistry | None = None,
        logics: LogicRegistry | None = None,
        rules: RuleRegistry | None = None,
    ) -> None:
        self.capabilities = capabilities or CapabilityDefinitionRegistry()
        self.logics = logics or LogicRegistry()
        self.rules = rules or RuleRegistry()
        self.logics.validate_references(self.capabilities, self.rules)

    def compile(
        self,
        proposal: PlanProposal,
        *,
        revision: int = 1,
        supersedes: str | None = None,
    ) -> ExecutionPlan:
        logic = self.logics.resolve(proposal.logic_ref)
        if not proposal.selection_rule_refs:
            raise PlanCompilationError("计划必须记录至少一条选择规则")
        for rule_ref in proposal.selection_rule_refs:
            self.rules.resolve(rule_ref)
        node_ids = [node.id for node in proposal.nodes]
        if len(node_ids) != len(set(node_ids)):
            raise PlanCompilationError("计划节点 ID 重复")
        known = set(node_ids)
        for node in proposal.nodes:
            unknown = set(node.dependencies) - known
            if unknown:
                raise PlanCompilationError(f"节点 {node.id} 含未知依赖: {sorted(unknown)}")
            for rule_ref in node.activate_rule_refs:
                self.rules.resolve(rule_ref)
        order = self._topological_order(proposal)
        proposed = {node.id: node for node in proposal.nodes}
        compiled: dict[str, ExecutionNode] = {}
        available_by_node: dict[str, set[str]] = {}
        initial = set(proposal.initial_types) | set(proposal.awaitable_types)
        for node_id in order:
            node = proposed[node_id]
            try:
                capability = self.capabilities.resolve(node.capability_ref)
            except KeyError as exc:
                raise PlanCompilationError(str(exc)) from exc
            if node.requested_writes and not set(node.requested_writes).issubset(capability.writes):
                raise PlanCompilationError(f"节点 {node.id} 请求越权写入")
            available = set(initial)
            for dependency in self._ancestors(node.id, proposed):
                available.update(compiled[dependency].output_types)
            missing = set(capability.input_types) - available
            if missing:
                raise PlanCompilationError(f"节点 {node.id} 输入不可满足: {sorted(missing)}")
            available_by_node[node.id] = available
            compiled[node.id] = ExecutionNode(
                id=node.id,
                capability_ref=capability.id,
                capability_version=capability.version,
                dependencies=list(node.dependencies),
                activate_rule_refs=list(node.activate_rule_refs),
                selection_rule_refs=sorted(set(proposal.selection_rule_refs + node.activate_rule_refs)),
                parameters=dict(node.parameters),
                input_types=list(capability.input_types),
                output_types=list(capability.output_types),
                reads=list(capability.reads),
                writes=list(capability.writes),
                idempotent=capability.idempotent,
                max_retries=capability.max_retries,
                side_effects=capability.side_effects,
                parallel_safe=capability.parallel_safe,
                lifecycle_view=capability.lifecycle_view,
            )
        produced = set(proposal.initial_types) | {
            output for node in compiled.values() for output in node.output_types
        }
        missing_goals = set(proposal.goal_types) - produced
        if missing_goals:
            raise PlanCompilationError(f"计划目标不可达: {sorted(missing_goals)}")
        if not set(proposal.goal_types).issubset(set(logic.goal_types)):
            raise PlanCompilationError("提案目标超出 Logic 声明")
        self._validate_formal_gates(proposal, proposed)
        return ExecutionPlan(
            id=f"plan:{proposal.request_id}:r{revision}",
            request_id=proposal.request_id,
            logic_ref=logic.id,
            logic_version=logic.version,
            selection_rule_refs=list(proposal.selection_rule_refs),
            revision=revision,
            supersedes=supersedes,
            nodes=[compiled[node_id] for node_id in order],
            initial_types=list(proposal.initial_types),
            awaitable_types=list(proposal.awaitable_types),
            goal_types=list(proposal.goal_types),
            completion_rule_refs=list(logic.completion_rule_refs),
            planning_context=dict(proposal.context),
            proposal_id=proposal.id,
        )

    @staticmethod
    def _topological_order(proposal: PlanProposal) -> list[str]:
        indegree = {node.id: 0 for node in proposal.nodes}
        outgoing: dict[str, list[str]] = defaultdict(list)
        for node in proposal.nodes:
            for dependency in node.dependencies:
                outgoing[dependency].append(node.id)
                indegree[node.id] += 1
        queue = deque(sorted(node for node, degree in indegree.items() if degree == 0))
        result: list[str] = []
        while queue:
            current = queue.popleft()
            result.append(current)
            for target in sorted(outgoing[current]):
                indegree[target] -= 1
                if indegree[target] == 0:
                    queue.append(target)
        if len(result) != len(proposal.nodes):
            raise PlanCompilationError("计划依赖形成循环")
        return result

    @classmethod
    def _ancestors(cls, node_id: str, nodes: dict[str, object]) -> set[str]:
        result: set[str] = set()
        stack = list(getattr(nodes[node_id], "dependencies"))
        while stack:
            current = stack.pop()
            if current in result:
                continue
            result.add(current)
            stack.extend(getattr(nodes[current], "dependencies"))
        return result

    def _validate_formal_gates(self, proposal: PlanProposal, nodes: dict[str, object]) -> None:
        capability_by_node = {node_id: getattr(node, "capability_ref") for node_id, node in nodes.items()}
        for node_id, capability_ref in capability_by_node.items():
            ancestors = {capability_by_node[item] for item in self._ancestors(node_id, nodes)}
            if capability_ref == "form_judgment":
                required = {"evaluate_reasoning", "form_hypotheses"}
                if "EvidenceAssessment" not in proposal.initial_types:
                    required.add("evaluate_evidence")
                if not required.issubset(ancestors):
                    raise PlanCompilationError("正式判断缺少证据、假设或规则评价门槛")
            if capability_ref == "publish_report":
                if "request_publication_approval" not in ancestors:
                    raise PlanCompilationError("发布节点缺少人工审批请求")
                if "ApprovalRecord" not in proposal.awaitable_types:
                    raise PlanCompilationError("发布计划必须声明等待人工 ApprovalRecord")
