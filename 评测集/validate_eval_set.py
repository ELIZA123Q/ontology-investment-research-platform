#!/usr/bin/env python3
"""校验研究质量评测集：可解析性、覆盖、任务卡结构、答案泄漏与可运行状态。"""

from __future__ import annotations

import re
import sys
from datetime import date
from pathlib import Path

try:
    import yaml
except ImportError:  # pragma: no cover
    print("FAIL: 需要 PyYAML", file=sys.stderr)
    raise SystemExit(2)


ROOT = Path(__file__).resolve().parent
CATALOG = ROOT / "00_评测集总览.yaml"
METRICS = ROOT / "02_指标定义.yaml"
SCORECARD = ROOT / "03_评分表模板.yaml"
CARD_DIR = ROOT / "01_标准任务卡"

DIMS = (
    "task_type",
    "evidence_state",
    "ontology_state",
    "report_type",
    "run_type",
    "expected_outcome",
)

TASK_INPUT_REQUIRED = (
    "用户问题",
    "对象",
    "时间范围",
    "信息截止日",
    "研究范围",
    "可用信息范围",
    "特别约束",
)

REVIEW_REQUIRED = (
    "预期判断状态",
    "预期核心判断轮廓",
    "允许的合理分歧",
    "必须识别的问题",
    "关键反证",
    "最低证据锚点",
    "不允许出现的结论",
    "结论边界",
    "通过标准",
)

ANCHOR_KEYS = ("必须确认", "可接受代理", "必须声明缺口")
COUNTER_KEY = "若未处理则不得直接通过"
BOUNDARY_KEYS = ("可接受终点", "禁止表达")
SCOPE_KEYS = ("terminal_stage", "required_artifacts")
REGRESSION_GROUPS = {
    "anchor_baseline",
    "high_discrimination",
    "capability",
    "pending",
}

LEAKAGE_PATTERNS = (
    r"预期因",
    r"正确终点",
    r"预期不足以",
    r"高质量暂不可判断",
    r"应保留争议",
    r"必须保留冲突",
    r"不得任意站队",
    r"本体重大缺口",
    r"本题应",
    r"预期终点",
    r"应在\s*01\s*退回",
    r"应阻断",
    r"应暂不可判断",
)


def fail(msg: str) -> None:
    print(f"FAIL: {msg}")
    raise SystemExit(1)


def load_yaml(path: Path) -> object:
    try:
        return yaml.safe_load(path.read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001
        fail(f"{path.name} 无法解析: {exc}")
        raise


def main() -> int:
    today = date.today()
    catalog = load_yaml(CATALOG)
    metrics = load_yaml(METRICS)
    scorecard = load_yaml(SCORECARD)

    if not isinstance(catalog, dict):
        fail("00_评测集总览.yaml 根节点须为映射")
    if not isinstance(metrics, dict) or "core_metrics" not in metrics:
        fail("02_指标定义.yaml 缺少 core_metrics")
    if not isinstance(scorecard, dict) or "core_metrics" not in scorecard:
        fail("03_评分表模板.yaml 缺少 core_metrics")
    if "evaluation_status" not in scorecard:
        fail("03_评分表模板.yaml 缺少 evaluation_status")
    if "independence" not in scorecard:
        fail("03_评分表模板.yaml 缺少 independence")

    metric_ids = [m.get("metric_id") for m in metrics.get("core_metrics") or []]
    expected_metric_ids = ["问题保持", "证据支撑", "推理成立", "反证处理", "判断强度", "交付可用性"]
    if metric_ids != expected_metric_ids:
        fail(f"核心指标应为 {expected_metric_ids}，实际为 {metric_ids}")

    tasks = catalog.get("tasks") or []
    requirements = catalog.get("coverage_requirements") or {}
    low, high = catalog.get("task_count_range") or [12, 20]

    if not (low <= len(tasks) <= high):
        fail(f"任务数 {len(tasks)} 不在 [{low}, {high}]")
    if catalog.get("task_count") != len(tasks):
        fail("task_count 与 tasks 列表长度不一致")

    seen_ids: set[str] = set()
    observed: dict[str, set[str]] = {d: set() for d in DIMS}
    leakage_re = re.compile("|".join(LEAKAGE_PATTERNS))

    for task in tasks:
        tid = task["task_id"]
        if tid in seen_ids:
            fail(f"重复 task_id: {tid}")
        seen_ids.add(tid)

        status = task.get("task_status")
        if status not in {"active", "planned"}:
            fail(f"{tid} task_status 须为 active 或 planned")

        rg = task.get("regression_group")
        if rg not in REGRESSION_GROUPS:
            fail(f"{tid} regression_group 无效: {rg}")

        card_path = ROOT / task["card"]
        if not card_path.is_file():
            fail(f"缺少任务卡: {card_path}")

        card = load_yaml(card_path)
        if not isinstance(card, dict):
            fail(f"{card_path.name} 根节点须为映射")
        if card.get("task_id") != tid:
            fail(f"{card_path.name} 的 task_id 与总览不一致")
        if card.get("task_status") != status:
            fail(f"{tid} 总览与任务卡 task_status 不一致")
        if card.get("regression_group") != rg:
            fail(f"{tid} 总览与任务卡 regression_group 不一致")

        dims = card.get("dimensions") or {}
        for dim in DIMS:
            if task.get(dim) != dims.get(dim):
                fail(f"{tid} 总览与任务卡的 {dim} 不一致")
            observed[dim].add(dims[dim])

        scope = card.get("evaluation_scope") or {}
        for key in SCOPE_KEYS:
            if key not in scope or scope[key] in (None, "", []):
                fail(f"{tid} evaluation_scope 缺少: {key}")
        cat_scope = task.get("evaluation_scope") or {}
        if str(cat_scope.get("terminal_stage")) != str(scope.get("terminal_stage")):
            fail(f"{tid} 总览与任务卡 evaluation_scope.terminal_stage 不一致")
        if list(cat_scope.get("required_artifacts") or []) != list(scope.get("required_artifacts") or []):
            fail(f"{tid} 总览与任务卡 evaluation_scope.required_artifacts 不一致")

        task_input = card.get("任务输入") or {}
        review = card.get("评审参考") or {}
        for key in TASK_INPUT_REQUIRED:
            if key not in task_input or task_input[key] in (None, "", []):
                fail(f"{tid} 任务输入缺少: {key}")
        for key in REVIEW_REQUIRED:
            if key not in review or review[key] in (None, "", []):
                fail(f"{tid} 评审参考缺少: {key}")

        anchors = review.get("最低证据锚点")
        if not isinstance(anchors, dict):
            fail(f"{tid} 最低证据锚点须为映射（必须确认/可接受代理/必须声明缺口）")
        for key in ANCHOR_KEYS:
            if key not in anchors:
                fail(f"{tid} 最低证据锚点缺少: {key}")
        if not anchors.get("必须确认"):
            fail(f"{tid} 最低证据锚点.必须确认 不能为空")

        counters = review.get("关键反证")
        if not isinstance(counters, dict) or not counters.get(COUNTER_KEY):
            fail(f"{tid} 关键反证须含「{COUNTER_KEY}」列表")

        boundary = review.get("结论边界")
        if not isinstance(boundary, dict):
            fail(f"{tid} 结论边界须为映射")
        for key in BOUNDARY_KEYS:
            if key not in boundary or boundary[key] in (None, "", []):
                fail(f"{tid} 结论边界缺少: {key}")
        if dims.get("expected_outcome") not in set(boundary.get("可接受终点") or []):
            fail(f"{tid} 预期终点未落入结论边界.可接受终点")

        if review.get("预期判断状态") != dims.get("expected_outcome"):
            fail(f"{tid} 评审参考.预期判断状态 与 dimensions.expected_outcome 不一致")

        if task.get("object") != task_input.get("对象"):
            fail(f"{tid} 总览 object 与任务输入.对象 不一致")
        if str(task.get("info_cutoff")) != str(task_input.get("信息截止日")):
            fail(f"{tid} 总览 info_cutoff 与任务输入.信息截止日 不一致")

        baseline = card.get("评测基线") or {}
        if not baseline.get("ontology_snapshot_ref") or not baseline.get("methodology_ref"):
            fail(f"{tid} 缺少评测基线 ontology_snapshot_ref / methodology_ref")

        blob = yaml.dump(task_input, allow_unicode=True)
        hit = leakage_re.search(blob)
        if hit:
            fail(f"{tid} 任务输入疑似泄漏评审答案，命中: {hit.group(0)}")

        cutoff = date.fromisoformat(str(task_input["信息截止日"]))
        if status == "active" and cutoff > today:
            fail(f"{tid} 为 active，但信息截止日 {cutoff} 晚于运行日 {today}")
        if status == "planned":
            available_after = card.get("available_after") or task.get("available_after")
            if not available_after:
                fail(f"{tid} planned 任务缺少 available_after")
            if cutoff <= today:
                fail(f"{tid} 为 planned，但信息截止日 {cutoff} 不晚于运行日；应改为 active 或调整日期")
            if rg != "pending":
                fail(f"{tid} planned 任务的 regression_group 应为 pending")

        if dims.get("run_type") == "增量更新" and not (
            card.get("base_task_ref") or task.get("base_task_ref")
        ):
            fail(f"{tid} 增量更新缺少 base_task_ref")

        if dims.get("run_type") == "历史回放" and not task_input.get("信息截止日"):
            fail(f"{tid} 历史回放缺少信息截止日")

    card_files = sorted(CARD_DIR.glob("EVAL-T*.yaml"))
    if len(card_files) != len(tasks):
        fail(f"任务卡文件数 {len(card_files)} 与总览任务数 {len(tasks)} 不一致")

    for dim, required in requirements.items():
        missing = set(required) - observed[dim]
        if missing:
            fail(f"{dim} 缺少覆盖: {sorted(missing)}")

    index = catalog.get("coverage_index") or {}
    for dim, mapping in index.items():
        if dim == "task_status":
            for value, ids in mapping.items():
                actual = {t["task_id"] for t in tasks if t.get("task_status") == value}
                if set(ids) != actual:
                    fail(f"coverage_index.task_status.{value} 与 tasks 不一致")
            continue
        if dim == "regression_group":
            for value, ids in mapping.items():
                actual = {t["task_id"] for t in tasks if t.get("regression_group") == value}
                if set(ids) != actual:
                    fail(f"coverage_index.regression_group.{value} 与 tasks 不一致")
            continue
        for value, ids in mapping.items():
            for tid in ids:
                if tid not in seen_ids:
                    fail(f"coverage_index.{dim}.{value} 引用未知任务 {tid}")
            actual = {t["task_id"] for t in tasks if t.get(dim) == value}
            if set(ids) != actual:
                fail(f"coverage_index.{dim}.{value} 与 tasks 不一致")

    partitions = catalog.get("suite_partitions") or {}
    for g in REGRESSION_GROUPS:
        part = partitions.get(g) or {}
        part_ids = set(part.get("tasks") or [])
        actual = {t["task_id"] for t in tasks if t.get("regression_group") == g}
        if part_ids != actual:
            fail(f"suite_partitions.{g}.tasks 与 tasks.regression_group 不一致")

    active_n = sum(1 for t in tasks if t.get("task_status") == "active")
    planned_n = sum(1 for t in tasks if t.get("task_status") == "planned")
    print(
        f"EVAL_SET_PASS: {len(tasks)} 个任务（active={active_n}, planned={planned_n}）；"
        f"回归分组/评测范围/四类评审信息齐全；任务输入无答案泄漏。"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
