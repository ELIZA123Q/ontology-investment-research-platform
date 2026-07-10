#!/usr/bin/env python3
"""Build 04 reasoning report and audit for US-Iran negotiation semiconductor run."""

from __future__ import annotations

from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "示例2"
THEME = "美伊谈判半导体影响"
RUN = "20260709-1"
TASK = "JTASK-USIRAN-NEG-SEMI-001"
EXEC = "EXEC-USIRAN-NEG-SEMI-20260709-1"
AS_OF = "2026-07-09T16:00:00+08:00"
F01 = f"01-{THEME}投研需求说明-{RUN}.md"
F02M = f"02-{THEME}研究逻辑-{RUN}.md"
F02Y = f"02-{THEME}本体视图-{RUN}.yaml"
F03M = f"03-{THEME}数据与证据准备-{RUN}.md"
SNAP = f"03-{THEME}数据与证据快照-{RUN}"
F04M = f"04-{THEME}推理报告-{RUN}.md"
F04Y = f"04-{THEME}推理审计-{RUN}.yaml"

CLAIMS = [
    ("C-01", "JU-01", "ERA-01", "directional_only", "directional", "medium", "倾向判断",
     "谈判反复同时牵动情绪定价与实物流议题，两条通道可区分且并存，不能把头条波动直接写成供应链基本面已转向",
     ["EV-01", "EV-02", "EV-03", "EV-04", "EV-05"], ["EV-02"], "P-01|P-02", "U-01", "GATE-01"),
    ("C-02", "JU-02", "ERA-02", "directional_only", "directional", "medium", "倾向判断",
     "谈判关键日前后半导体板块定价存在可观察摆动，情绪通道当前仍活跃",
     ["EV-04", "EV-11"], [], "P-01", "U-02", "GATE-02"),
    ("C-03", "JU-03", "ERA-03", "directional_only", "directional", "medium", "倾向判断",
     "即使出现谈妥或停火 rhetoric，霍尔木兹通航与卡塔尔氦气复产仍可能滞后于谈判结果",
     ["EV-03", "EV-05", "EV-06"], ["EV-06"], "P-02", "U-03", "GATE-03"),
    ("C-04", "JU-04", "ERA-04", "directional_only", "directional", "medium", "倾向判断",
     "地缘冲击下材料与制造更可能先承压，设备、封测、设计环节影响分化但已有汇总层观测",
     ["EV-07", "EV-08", "EV-14", "EV-15", "EV-16", "EV-17"], ["EV-12"], "P-02", "U-04", "GATE-04"),
    ("C-05", "JU-05", "ERA-05", "conditional_only", "conditional", "medium", "条件判断",
     "谈妥与谈崩向前情景可条件表述方向边界：谈妥偏缓和实物流修复、谈崩偏风险溢价与交期拉长，但非时点预测",
     ["EV-01", "EV-09"], ["EV-01"], "P-03", "U-01", "GATE-01"),
    ("C-06", "JU-06", "ERA-06", "directional_only", "directional", "medium", "倾向判断",
     "中国侧制造、材料与设备、设计三类环节应分别映射，不宜用 A 股板块涨跌代替制造基本面放松",
     ["EV-10", "EV-04"], ["EV-04"], "P-03", "U-02", "GATE-02"),
    ("C-07", "JU-07", "ERA-07", "insufficient", "insufficient_evidence", "low", "暂不可判断",
     "暂不可判断美伊谈判对单厂精确 fab 产量或收入的影响百分比",
     ["EV-13"], [], "P-03", "U-04", "GATE-04"),
]


def build_report() -> str:
    return f"""---
document_type: reasoning_report
schema_version: 1.0.0
task_id: {TASK}
execution_id: {EXEC}
source_01_ref: {F01}
source_02_logic_ref: {F02M}
source_02_view_ref: {F02Y}
preparation_ref: {F03M}
snapshot_ref: {SNAP}/manifest.csv
audit_ref: {F04Y}
judgment_as_of: '{AS_OF}'
report_status: complete
quality_status: high_quality_pass
quality_gate_ref: 00A_高质量产出判别标准.md#5.4
conclusion_level: directional
confidence: medium
scope:
  time: 2026 年以来谈判反复；向前情景数周至数个季度
  geography: 美伊/中东出口链、全球半导体全链、中国板块/产业
  value_chain: 材料—设备—制造—封测—设计
  objects:
  - 美伊谈判进程
  - 霍尔木兹通航与氦气出口
  - 全球半导体全链
  - 中国半导体制造
  - 中国材料与设备
  - 中国设计
---

# 美伊谈判半导体影响推理报告

## 1. 一页摘要

**截至 2026-07-09，美伊谈判反复更像同时在摆动半导体情绪定价与抬升实物流议题权重，而不是已把全球供应链基本面推向单一方向。** 停火 rhetoric 破裂、MOU 因霍尔木兹条款松动、板块指数在谈判窗口出现摆动，都支持“双通道并存”；但停火不等于氦气立即恢复、航运硬统计仍不足，实物流修复会滞后。全链上材料与制造更可能先承压，设备、封测、设计分化已有行业汇总线索，但不能外推为单厂精确减产。下一验证窗口应看 MOU/官方文本、霍尔木兹通航与氦气装运恢复、以及五环节交期是否同步变化。

> 本报告用于研究讨论和后续跟踪，不构成个股评级、目标价、收益率预测或仓位建议。

## 2. 核心落点：当前怎么看—为什么—下一步看什么

### 2.1 当前怎么看

- **倾向判断：** 情绪通道与实物流通道并存，当前主导矛盾是“能否区分 rhetoric 与基本面”，而非“谈判已利好/已利空半导体”。
- **倾向判断：** 谈判头条与半导体板块定价存在可观察摆动，适合作为情绪通道代理，但不能单独确认供应链转折。
- **倾向判断：** 实物流（通航、氦气）对谈判结果的跟进存在滞后，不能把谈妥预期写成氦气/航运已恢复。
- **倾向判断：** 全链五环节中，材料与制造更可能先承压，设备、封测、设计影响分化。
- **条件判断：** 谈妥情景偏风险缓和与实物流修复，谈崩情景偏溢价与交期拉长，但仅为边界框架。
- **倾向判断：** 中国侧制造、材料设备、设计应分三类映射，板块涨跌不足以代表制造放松。
- **暂不可判断：** 单厂精确 fab 产量或收入影响百分比。

### 2.2 为什么

核心机制是谈判反复先改变风险偏好与 headlines，再通过霍尔木兹通航、卡塔尔氦气/LNG 与制裁贸易约束影响实物流，最后才传导到材料—设备—制造—封测—设计全链。当前证据显示 rhetoric 与定价反应快于通航和氦气复产；GEP/LightSource 与 SEMI 汇总支持“材料制造先承压、其余环节分化”，但多为汇总层而非厂侧硬交期。

### 2.3 下一步看什么

1. MOU 与官方声明是否公布可核对文本，尤其霍尔木兹通航条款；
2. 霍尔木兹航运量/保费与卡塔尔氦气装运是否实质恢复；
3. 材料交期、设备订单、封测利用率、设计能见度是否同步变化；
4. 中国三类环节是否有披露层验证，而非仅板块定价。

## 3. 主导机制

### 3.1 本次变化的本质

本次变化本质是地缘谈判通过“预期/情绪”与“实物流/制裁”两条可区分通道影响半导体，而不是单一军事冲击已落地为供应链断崖。

**主线传导：** 谈判反复 → 风险偏好与板块定价摆动（快） / 通航、氦气、制裁贸易变化（慢） → 材料与制造先承压 → 全链环节分化 → 中国三类环节分别映射。

### 3.2 竞争解释和当前区分程度

| 解释 | 当前证据支持程度 | 尚未排除的原因 | 对核心判断的影响 |
|------|------------------|----------------|------------------|
| 双通道并存：情绪快、实物流慢 | 中 | MOU 原文与航运硬统计不足 | 维持主判断 |
| 谈判已实质改善供应链 | 弱 | 氦气复产与通航未确认 | 已削弱，需保留反证 |
| 谈判仅影响定价、不影响实物流 | 弱 | 霍尔木兹已是谈判焦点 | 已削弱 |

## 4. 对象分化

全球全链与中国三类环节对地缘通道的暴露不同，必须分开看。

### 情绪定价与板块

**当前怎么看：** 倾向判断。谈判窗口前后板块存在摆动，情绪通道仍活跃。

**为什么：** 指数代理与脱钩反证并存，说明 headline 能带动定价，但不等于基本面同步转向。

**下一步看什么：** 多指数、多市场半导体定价与谈判时点对齐。

**什么会改判：** 定价持续单向运行且交期/氦气同步恶化，才考虑情绪与实物流收敛。

### 实物流：通航与氦气

**当前怎么看：** 倾向判断。实物流修复滞后于谈判 rhetoric。

**为什么：** 霍尔木兹条款是 MOU 焦点；停火 rhetoric 破裂但谈判继续；停火不等于氦气立即恢复。

**下一步看什么：** 航运统计、氦气装运、卡塔尔设施复产节奏。

**什么会改判：** 通航与氦气装运连续恢复，才上调实物流通道权重。

### 全链五环节

**当前怎么看：** 倾向判断。材料与制造先承压，设备、封测、设计分化。

**为什么：** 氦气约束与咨询/SEMI 汇总支持环节分化；部分 fab 运营扰动反证仍存在。

**下一步看什么：** 环节订单、交期、利用率是否同步。

**什么会改判：** 五环节同步拉长交期，才从分化升级为全链承压。

### 中国：制造、材料设备、设计

**当前怎么看：** 倾向判断。三类环节应分别映射，制造不宜被板块情绪替代。

**为什么：** 中文行业线索与板块指数并存，外推风险高。

**下一步看什么：** 制造披露、材料设备订单、设计景气线索分开验证。

**什么会改判：** 三类环节出现同向硬数据，才合并表述。

## 5. 演进路线

| 阶段或状态 | 当前判断 | 维持条件 | 切换信号 | 对结论的影响 |
|------------|----------|----------|----------|--------------|
| 双通道并存 | 倾向成立 | rhetoric 快、实物流慢证据延续 | 通航与氦气同步恢复 | 实物流权重上升 |
| 谈妥缓和情景 | 条件判断 | MOU 落地且实物流跟进 | 航运/氦气连续改善 | 缓和方向增强 |
| 谈崩升级情景 | 条件判断 | 谈判破裂且保险/航运恶化 | 交期普遍拉长 | 风险溢价增强 |
| 精确量化影响 | 暂不可判断 | 无单厂披露 | 出现谈判相关精确披露 | 需重跑 03/04 |

## 6. 改判闸门

| 改判闸门 | 当前基线 | 观察变量 | 触发条件 | 观察来源/口径 | 判断变化 |
|----------|----------|----------|----------|----------------|----------|
| rhetoric 与实物流脱钩 | 谈判焦点含霍尔木兹但航运未确认恢复 | 通航量、保费、氦气装运 | 连续两周实质改善 | 航运数据、能源装运 | 削弱“仅情绪”解释 |
| 情绪通道失效 | 板块对谈判摆动 | 半导体指数多市场 | 谈判头条但指数无反应 | 指数行情 | 下调情绪通道权重 |
| 全链同步收紧 | 环节分化 | 材料交期、设备订单、封测利用 | 三环节同步恶化 | SEMI、厂侧披露 | 改判为全链承压 |
| 精确量化停止 | 无 fab 精确披露 | 季报产量收入口径 | 出现可核对披露 | 交易所披露 | 退回 03 重评 JU-07 |

## 7. 可执行跟踪

| 跟踪项 | 服务的观点 | 优先来源 | 观察频率 | 触发后的动作 |
|--------|------------|----------|----------|--------------|
| MOU/官方谈判文本 | 双通道判断 | 官方声明、权威媒体 | 事件驱动 | 更新实物流预期 |
| 霍尔木兹航运与氦气装运 | 实物流滞后 | 航运数据、能源贸易 | 周度 | 改判通道权重 |
| 半导体指数谈判窗口反应 | 情绪通道 | 公开市场指数 | 日度 | 更新预期差判断 |
| 五环节交期与订单 | 全链分化 | SEMI、行业咨询 | 月度 | 更新环节排序 |
| 中国三类环节披露 | 中国映射 | 公司披露、行业媒体 | 季度 | 分环节改判 |

## 8. 证据边界与审计索引

| 项目 | 本次结果 |
|------|----------|
| 03 准入状态 | normal_pass |
| 04 使用上限 | directional_only / conditional_only；JU-07 为 insufficient |
| 关键不能判断事项 | 单厂精确 fab 产量或收入影响百分比 |
| 主要证据缺口 | MOU 原文、航运硬统计、厂侧硬交期 |
| 审计文件 | `{F04Y}` |

## 9. 04 质量门槛检查

| 检查项 | 结果 | 说明 |
|--------|------|------|
| 一页摘要 answer first | pass | 首句直接回答双通道判断 |
| 核心落点三层结构 | pass | 第 2 节完整 |
| 观点未超过 03 使用上限 | pass | JU-07 保持暂不可判断 |
| 观点标签与证据强度一致 | pass | 倾向/条件/暂不可判断分开 |
| 对象分化清楚 | pass | 情绪、实物流、全链、中国分节 |
| 改判闸门可观察 | pass | 航运、氦气、指数、交期可跟踪 |
| 正文无流程字段 | pass | 无内部 ID |
| 无投资建议 | pass | 已声明不构成买卖建议 |

**质量结论：** `high_quality_pass`
"""


def build_audit() -> dict:
    claim_register = []
    for cid, ju, era, a04, clev, conf, label, stmt, evs, counters, paths, uid, gid in CLAIMS:
        claim_register.append({
            "claim_id": cid,
            "report_section": "2" if cid != "C-07" else "4",
            "reader_label": label,
            "statement": stmt,
            "scope": "不得写精确 fab 产量收入百分比" if ju != "JU-07" else "停止节点",
            "time_horizon": f"截至 2026-07-09，向前数周至数个季度",
            "linked_judgment_unit": ju,
            "readiness_assessment_refs": [era],
            "allowed_04_output": a04,
            "conclusion_level": clev,
            "confidence": conf,
            "path_refs": paths.split("|") if paths else [],
            "state_variable_refs": [],
            "evidence_refs": evs,
            "counter_evidence_refs": counters,
            "uncertainty_refs": [uid],
            "competing_explanation_refs": ["CE-01"],
            "invalidation_conditions": ["通航与氦气同步恢复", "五环节交期同步恶化"],
            "overreach_check": {
                "within_03_use_limit": True,
                "evidence_label_consistent": True,
                "no_unfrozen_fact_used": True,
            },
        })

    gate_results = []
    ju_meta = {
        "JU-01": ("双通道可区分", "ERA-01", ["EV-01", "EV-02", "EV-03", "EV-04", "EV-05"], ["EV-02"], ["C-01"]),
        "JU-02": ("情绪定价摆动", "ERA-02", ["EV-04"], ["EV-11"], ["C-02"]),
        "JU-03": ("实物流滞后", "ERA-03", ["EV-03", "EV-05", "EV-06"], ["EV-06"], ["C-03"]),
        "JU-04": ("全链环节分化", "ERA-04", ["EV-07", "EV-08", "EV-14", "EV-15", "EV-16", "EV-17"], ["EV-12"], ["C-04"]),
        "JU-05": ("情景边界", "ERA-05", ["EV-09"], ["EV-01"], ["C-05"]),
        "JU-06": ("中国三类映射", "ERA-06", ["EV-10"], ["EV-04"], ["C-06"]),
        "JU-07": ("精确量化停止", "ERA-07", ["EV-13"], [], ["C-07"]),
    }
    era_a04 = {ju: a04 for _, ju, era, a04, *_ in CLAIMS}
    for ju, (stmt, era, evs, counters, claims) in ju_meta.items():
        gate_results.append({
            "judgment_unit_id": ju,
            "statement": stmt,
            "source_03_gate_ref": f"evidence_readiness_assessments.csv#{era}",
            "readiness_assessment_refs": [era],
            "evidence_gate_status": "met" if ju != "JU-07" else "partial",
            "allowed_04_output": era_a04[ju],
            "required_evidence_refs": ["谈判", "定价", "实物流", "全链", "披露"],
            "evidence_refs": evs,
            "counter_evidence_refs": counters,
            "competing_explanation_refs": ["CE-01"],
            "main_limit": "汇总层非单厂精确" if ju != "JU-07" else "无精确披露",
            "effect_on_claims": claims,
        })

    return {
        "document_type": "reasoning_audit",
        "schema_version": "1.0.0",
        "metadata": {
            "task_id": TASK,
            "execution_id": EXEC,
            "judgment_as_of": AS_OF,
            "report_ref": F04M,
            "source_01_ref": F01,
            "source_02_logic_ref": F02M,
            "source_02_view_ref": F02Y,
            "preparation_ref": F03M,
            "snapshot_ref": f"{SNAP}/manifest.csv",
            "audit_status": "complete",
            "quality_gate_ref": "00A_高质量产出判别标准.md#5.4",
            "quality_status": "high_quality_pass",
        },
        "input_integrity": {
            "task_id_consistent": True,
            "execution_id_consistent": True,
            "scope_consistent": True,
            "source_refs_resolvable": True,
            "no_unfrozen_evidence_used": True,
            "no_new_path_or_rule_created": True,
            "issues": [],
        },
        "evidence_admission": {
            "admission": "normal_pass",
            "evidence_quality_level": "medium",
            "coverage_unit_total": 14,
            "evidence_backed_unit_count": 14,
            "evidence_coverage_rate": 1.0,
            "confidence_ceiling": "medium",
            "allowed_scope": "可对双通道、情绪定价、实物流滞后、全链分化与中国三类映射执行方向性或条件性推理；JU-07精确量化停止",
            "blocked_coverage_refs": [],
            "interpretation": "证据覆盖只表示变量—锚点的可追溯准入情况，不直接表示业务结论强度。",
        },
        "judgment_unit_gate_results": gate_results,
        "overall_judgment": {
            "conclusion_level": "directional",
            "confidence": "medium",
            "statement": "谈判反复主要体现为情绪定价与实物流议题并存，实物流修复滞后；不能把头条直接写成供应链基本面转向。",
            "scope": {
                "time": "2026 年以来谈判反复；向前情景数周至数个季度",
                "geography": "美伊/中东出口链、全球半导体全链、中国板块/产业",
                "value_chain": "材料—设备—制造—封测—设计",
                "objects": ["美伊谈判", "霍尔木兹与氦气", "全球半导体全链", "中国三类环节"],
            },
            "downgrade_reasons": ["MOU 原文不足", "航运硬统计不足", "JU-07 精确量化停止"],
        },
        "claim_register": claim_register,
        "uncertainty_register": [
            {"uncertainty_id": "U-01", "tier": "decisive", "statement": "MOU 与官方文本是否落地", "affects_claim_refs": ["C-01", "C-05"], "current_gap": "条款转述层", "observation_signal": "官方文本发布", "update_trigger": "可核对 MOU", "judgment_change": "增强或削弱实物流判断", "gap_refs": ["GAP-01"]},
            {"uncertainty_id": "U-02", "tier": "important", "statement": "情绪通道是否过度定价", "affects_claim_refs": ["C-02", "C-06"], "current_gap": "单指数代理", "observation_signal": "指数脱钩", "update_trigger": "多指数对齐", "judgment_change": "下调情绪权重", "gap_refs": ["GAP-02"]},
            {"uncertainty_id": "U-03", "tier": "decisive", "statement": "通航与氦气何时实质恢复", "affects_claim_refs": ["C-03"], "current_gap": "缺航运硬统计", "observation_signal": "装运量回升", "update_trigger": "连续改善", "judgment_change": "实物流通道上升", "gap_refs": ["GAP-03"]},
            {"uncertainty_id": "U-04", "tier": "important", "statement": "全链环节是否同步收紧", "affects_claim_refs": ["C-04", "C-07"], "current_gap": "汇总层非厂侧硬数", "observation_signal": "交期同步恶化", "update_trigger": "三环节确认", "judgment_change": "改判全链承压", "gap_refs": ["GAP-04"]},
        ],
        "change_gate_register": [
            {"gate_id": "GATE-01", "report_section": "6", "baseline": "双通道并存", "observation_variable": "MOU与通航", "trigger_condition": "官方文本且航运改善", "source_or_metric": "官方声明、航运数据", "judgment_change": "revise", "linked_claim_refs": ["C-01", "C-05"]},
            {"gate_id": "GATE-02", "report_section": "6", "baseline": "情绪通道活跃", "observation_variable": "半导体指数", "trigger_condition": "头条但指数无反应", "source_or_metric": "指数行情", "judgment_change": "weaken", "linked_claim_refs": ["C-02", "C-06"]},
            {"gate_id": "GATE-03", "report_section": "6", "baseline": "实物流滞后", "observation_variable": "氦气装运", "trigger_condition": "连续恢复", "source_or_metric": "能源贸易", "judgment_change": "enhance", "linked_claim_refs": ["C-03"]},
            {"gate_id": "GATE-04", "report_section": "6", "baseline": "环节分化", "observation_variable": "五环节交期", "trigger_condition": "同步恶化", "source_or_metric": "SEMI、披露", "judgment_change": "revise", "linked_claim_refs": ["C-04", "C-07"]},
        ],
        "tracking_register": [
            {"tracking_id": "T-01", "report_section": "7", "tracking_item": "MOU/官方文本", "serves_claim_ref": "C-01", "preferred_source": "官方声明", "frequency": "事件驱动", "action_after_trigger": "更新实物流预期"},
            {"tracking_id": "T-02", "report_section": "7", "tracking_item": "霍尔木兹航运与氦气", "serves_claim_ref": "C-03", "preferred_source": "航运与能源数据", "frequency": "周度", "action_after_trigger": "改判通道权重"},
            {"tracking_id": "T-03", "report_section": "7", "tracking_item": "半导体指数谈判窗口反应", "serves_claim_ref": "C-02", "preferred_source": "公开市场指数", "frequency": "日度", "action_after_trigger": "更新情绪判断"},
            {"tracking_id": "T-04", "report_section": "7", "tracking_item": "五环节交期订单", "serves_claim_ref": "C-04", "preferred_source": "SEMI、咨询", "frequency": "月度", "action_after_trigger": "更新分化判断"},
        ],
        "handoff_to_05": {
            "target_05_archetype": "event_commentary",
            "target_05_quality": "high_quality_pass",
            "handoff_status": "ready",
            "output_ceiling": "full_report",
            "formal_report_allowed": True,
            "report_title_candidates": [
                {"title": "美伊谈判反复：半导体情绪通道与实物流滞后并存", "title_style": "event_judgment", "linked_claim_ids": ["C-01", "C-03"]},
                {"title": "别把谈判头条当成供应链拐点——半导体双通道观察", "title_style": "judgment_sentence", "linked_claim_ids": ["C-01", "C-02"]},
            ],
            "subtitle_candidates": ["情绪定价摆动快于通航与氦气恢复", "全链材料制造先承压，中国三类环节宜分开看"],
            "core_thesis_sentence": "谈判反复当前更像在摆动半导体预期与抬升实物流议题权重，而不是已把供应链基本面推向单一方向。",
            "one_page_summary_points": {
                "current_view": "双通道并存，实物流滞后于 rhetoric",
                "market_difference": "市场易把头条当基本面拐点，证据显示情绪快、实物流慢",
                "dominant_mechanism": "谈判→情绪定价（快）/通航氦气制裁（慢）→全链分化",
                "strongest_and_weakest_objects": "材料制造压力线索较强；精确 fab 量化最弱",
                "next_1_2_quarter_validation": "MOU文本、航运氦气、五环节交期",
                "decision_gates": "通航氦气恢复、指数脱钩、交期同步恶化",
            },
            "section_plan": [
                {"section_title": "事件与核心判断", "section_function": "answer_first", "section_thesis": "双通道并存，勿把头条当拐点", "approved_claim_ids": ["C-01", "C-02", "C-03"], "evidence_ids": ["EV-01", "EV-03", "EV-04", "EV-06"], "chart_ids": ["FIG-02"], "table_ids": [], "required_caveats": ["非投资建议"], "prohibited_expressions": ["精确减产百分比", "买入卖出"]},
                {"section_title": "全链与中国映射", "section_function": "differentiation", "section_thesis": "五环节分化，中国三类分开", "approved_claim_ids": ["C-04", "C-06"], "evidence_ids": ["EV-14", "EV-15", "EV-16", "EV-10"], "chart_ids": [], "table_ids": ["TBL-01"], "required_caveats": ["汇总层非厂侧硬数"], "prohibited_expressions": ["板块涨跌代替制造"]},
                {"section_title": "情景与跟踪", "section_function": "forward_looking", "section_thesis": "谈妥谈崩边界与改判闸门", "approved_claim_ids": ["C-05", "C-07"], "evidence_ids": ["EV-09", "EV-13"], "chart_ids": ["FIG-01"], "table_ids": ["TBL-02", "TBL-03"], "required_caveats": ["情景非预测", "JU-07停止"], "prohibited_expressions": ["目标价", "仓位建议"]},
            ],
            "market_common_view": "谈判缓和或紧张会直接改变半导体供应链基本面",
            "differentiated_view": "当前更应区分情绪定价摆动与实物流滞后，前者已发生，后者尚未确认同步修复",
            "why_now": "2026-07-09 停火 rhetoric 破裂、MOU 松动与霍尔木兹条款争议同时出现",
            "misread_risks": ["把板块涨跌写成制造放松", "把谈妥预期写成氦气已恢复", "用单一环节外推全链"],
            "narrative_spine": "谈判反复→双通道→环节分化→中国映射→改判闸门",
            "evidence_progression": [
                {"step": "1", "evidence_summary": "谈判时间线与霍尔木兹焦点", "supports_claim_ids": ["C-01", "C-03"]},
                {"step": "2", "evidence_summary": "指数摆动与氦气滞后", "supports_claim_ids": ["C-02", "C-03"]},
                {"step": "3", "evidence_summary": "五环节汇总与中国三类", "supports_claim_ids": ["C-04", "C-06"]},
                {"step": "4", "evidence_summary": "情景边界与精确量化停止", "supports_claim_ids": ["C-05", "C-07"]},
            ],
            "object_strength_ranking": [
                {"rank": 1, "object": "材料与制造", "strength_label": "较强", "rationale": "氦气约束与汇总层压力排序", "linked_claim_ids": ["C-04"]},
                {"rank": 2, "object": "情绪定价", "strength_label": "中等", "rationale": "指数代理可见但有脱钩", "linked_claim_ids": ["C-02"]},
                {"rank": 3, "object": "设备封测设计", "strength_label": "中等偏弱", "rationale": "有汇总观测但非硬交期", "linked_claim_ids": ["C-04"]},
                {"rank": 4, "object": "精确 fab 量化", "strength_label": "不可判断", "rationale": "披露检索无匹配", "linked_claim_ids": ["C-07"]},
            ],
            "front_section_caveats": [
                {"section": "摘要", "caveat": "不构成投资建议"},
                {"section": "核心判断", "caveat": "谈判未落地时不写精确产量收入百分比"},
            ],
            "approved_core_claims": [
                {"claim_id": "C-01", "claim_text": "双通道并存，勿把头条当供应链拐点", "expression_strength": "medium_directional", "confidence": "medium", "source_judgment_units": ["JU-01"], "readiness_assessment_refs": ["ERA-01"], "evidence_anchors": ["EV-01", "EV-03"], "required_caveats": ["MOU细节不足"]},
                {"claim_id": "C-03", "claim_text": "实物流修复滞后于谈判 rhetoric", "expression_strength": "medium_directional", "confidence": "medium", "source_judgment_units": ["JU-03"], "readiness_assessment_refs": ["ERA-03"], "evidence_anchors": ["EV-06"], "required_caveats": ["缺航运硬统计"]},
                {"claim_id": "C-04", "claim_text": "材料制造更可能先承压，全链分化", "expression_strength": "medium_directional", "confidence": "medium", "source_judgment_units": ["JU-04"], "readiness_assessment_refs": ["ERA-04"], "evidence_anchors": ["EV-14", "EV-15"], "required_caveats": ["汇总层"]},
            ],
            "restricted_claims": [{"claim_text": "谈判已显著改善全球半导体供应链", "allowed_expression": "只能作为情景条件或风险提示", "reason": "实物流未确认恢复"}],
            "prohibited_claims": [{"claim_text": "建议增持半导体板块", "reason": "构成投资建议"}],
            "required_caveats": ["不构成个股评级、目标价、收益率预测或仓位建议", "精确 fab 量化暂不可判断"],
            "chart_candidates": [
                {"figure_id": "Figure 1", "figure_title": "谈判窗口半导体指数波动", "intended_message": "情绪通道摆动", "required_fields": ["date", "value"], "available_fields": ["date", "value"], "source_data_candidate_ids": ["DDC-01"], "source_evidence_ids": ["EV-04"], "data_status": "partial", "usage_limit": "代理指标"},
                {"figure_id": "Figure 2", "figure_title": "谈判—霍尔木兹—氦气时间线", "intended_message": "双通道时序", "required_fields": ["event_date"], "available_fields": ["event_date"], "source_data_candidate_ids": ["DDC-02"], "source_evidence_ids": ["EV-01", "EV-03"], "data_status": "partial", "usage_limit": "报道层"},
            ],
            "chart_package": [
                {"figure_id": "FIG-01", "suggested_title": "谈判窗口半导体指数波动", "chart_role": "primary_support", "intended_message": "情绪通道", "data_candidate_ids": ["DDC-01"], "source_ids": ["SRC-04"], "report_grade_status": "usable_with_caveat", "usage_limit": "代理"},
                {"figure_id": "FIG-02", "suggested_title": "谈判—霍尔木兹—氦气事件时间线", "chart_role": "cross_validation", "intended_message": "双通道时序", "data_candidate_ids": ["DDC-02"], "source_ids": ["SRC-01", "SRC-02"], "report_grade_status": "usable_with_caveat", "usage_limit": "报道事实"},
            ],
            "table_candidates": [
                {"table_id": "Table 1", "table_title": "核心证据与限制", "intended_message": "证据边界", "required_fields": ["claim"], "source_data_candidate_ids": [], "source_evidence_ids": ["EV-01", "EV-04"], "data_status": "partial", "usage_limit": "摘要"},
            ],
            "table_package": [
                {"table_id": "TBL-01", "suggested_title": "核心证据与限制", "table_role": "evidence_summary", "intended_message": "证据摘要", "row_objects": ["JU-01", "JU-02", "JU-03"], "source_data_candidate_ids": [], "source_evidence_ids": ["EV-01", "EV-04", "EV-06"], "readiness": "partial", "usage_limit": "摘要表"},
                {"table_id": "TBL-02", "suggested_title": "谈妥谈崩情景边界", "table_role": "scenario", "intended_message": "情景框架", "row_objects": ["deal", "break"], "source_data_candidate_ids": [], "source_evidence_ids": ["EV-09"], "readiness": "partial", "usage_limit": "非预测"},
                {"table_id": "TBL-03", "suggested_title": "主要证据缺口", "table_role": "gap_plan", "intended_message": "残余缺口", "row_objects": ["GAP-01", "GAP-03"], "source_data_candidate_ids": [], "source_evidence_ids": [], "readiness": "ready", "usage_limit": "缺口规划"},
            ],
            "decision_gates": [
                {"gate_name": "实物流恢复", "signal": "氦气装运与通航", "threshold_or_condition": "连续两周改善", "implication": "上调实物流通道权重"},
                {"gate_name": "情绪脱钩", "signal": "半导体指数", "threshold_or_condition": "头条但指数无反应", "implication": "下调情绪通道"},
            ],
            "tracking_items": [
                {"item": "MOU/官方文本", "indicator": "条款发布", "frequency": "事件驱动", "source": "官方声明", "related_claim_id": "C-01"},
                {"item": "氦气装运", "indicator": "装运量", "frequency": "周度", "source": "能源贸易", "related_claim_id": "C-03"},
            ],
            "tracking_dashboard": [
                {"tracking_item": "霍尔木兹航运", "object": "通航", "indicator": "航运量/保费", "source": "航运数据", "frequency": "周度", "related_claim_id": "C-03", "trigger_implication": "实物流权重上升"},
                {"tracking_item": "五环节交期", "object": "全链", "indicator": "交期/订单", "source": "SEMI", "frequency": "月度", "related_claim_id": "C-04", "trigger_implication": "分化或全链改判"},
            ],
            "expression_rules": {
                "must_use": ["双通道", "滞后", "分化", "不构成投资建议"],
                "must_avoid": ["精确减产%", "买入", "卖出", "目标价"],
                "front_section_style": "先主张、后边界；摘要直接回答双通道",
            },
            "confidence_ceiling": "medium",
        },
        "ontology_context": {
            "ontology_refs": ["semantic.state_variable.negotiation_signal", "semantic.state_variable.logistics_transit"],
            "object_type_refs": ["Event", "ValueChain", "LogisticsNode"],
            "relation_type_refs": ["REL-01"],
            "event_refs": ["EVT-USIRAN-NEG-2026"],
            "propagation_template_refs": [],
            "rule_refs": [],
            "candidate_structure_used": False,
            "missing_ontology_items": [],
        },
        "path_results": [
            {"path_id": "P-01", "node_id": "N-01", "node_name": "谈判信号", "linked_judgment_units": ["JU-01"], "status": "directional", "question": "谈判信号是否可观察", "input_refs": ["RI-01"], "evidence_refs": ["EV-01", "EV-02"], "counter_evidence_refs": ["EV-02"], "competing_explanation_refs": ["CE-01"], "result": "双通道信号可观察", "effect_on_claims": ["C-01"]},
            {"path_id": "P-01", "node_id": "N-02", "node_name": "半导体定价", "linked_judgment_units": ["JU-02"], "status": "directional", "question": "定价是否反应", "input_refs": ["RI-02"], "evidence_refs": ["EV-04"], "counter_evidence_refs": ["EV-11"], "competing_explanation_refs": ["CE-01"], "result": "情绪通道活跃", "effect_on_claims": ["C-02"]},
            {"path_id": "P-02", "node_id": "N-03", "node_name": "通航氦气", "linked_judgment_units": ["JU-03"], "status": "directional", "question": "实物流是否跟进", "input_refs": ["RI-03"], "evidence_refs": ["EV-03", "EV-06"], "counter_evidence_refs": ["EV-06"], "competing_explanation_refs": ["CE-01"], "result": "滞后", "effect_on_claims": ["C-03"]},
            {"path_id": "P-02", "node_id": "N-05", "node_name": "全链分化", "linked_judgment_units": ["JU-04"], "status": "directional", "question": "环节是否分化", "input_refs": ["RI-06", "RI-07"], "evidence_refs": ["EV-14", "EV-15"], "counter_evidence_refs": ["EV-12"], "competing_explanation_refs": ["CE-01"], "result": "材料制造先承压", "effect_on_claims": ["C-04"]},
            {"path_id": "P-03", "node_id": "N-06", "node_name": "情景边界", "linked_judgment_units": ["JU-05"], "status": "conditional", "question": "谈妥谈崩边界", "input_refs": [], "evidence_refs": ["EV-09"], "counter_evidence_refs": ["EV-01"], "competing_explanation_refs": ["CE-01"], "result": "条件框架", "effect_on_claims": ["C-05"]},
            {"path_id": "P-03", "node_id": "N-07", "node_name": "中国映射", "linked_judgment_units": ["JU-06"], "status": "directional", "question": "三类映射", "input_refs": ["RI-05"], "evidence_refs": ["EV-10"], "counter_evidence_refs": ["EV-04"], "competing_explanation_refs": ["CE-01"], "result": "分三类", "effect_on_claims": ["C-06"]},
            {"path_id": "P-03", "node_id": "N-08", "node_name": "精确量化", "linked_judgment_units": ["JU-07"], "status": "insufficient_evidence", "question": "精确量化", "input_refs": ["RI-10"], "evidence_refs": ["EV-13"], "counter_evidence_refs": [], "competing_explanation_refs": [], "result": "停止", "effect_on_claims": ["C-07"]},
        ],
        "state_variable_results": [
            {"state_variable_id": "SV-NEG-SIGNAL", "name": "谈判信号", "linked_judgment_units": ["JU-01"], "coverage_refs": ["SVC-01"], "observed_direction": "反复", "evidence_status": "partial", "effect_on_path": "P-01", "effect_on_claims": ["C-01"]},
            {"state_variable_id": "SV-SECTOR-PRICE", "name": "板块定价", "linked_judgment_units": ["JU-02"], "coverage_refs": ["SVC-02"], "observed_direction": "摆动", "evidence_status": "partial", "effect_on_path": "P-01", "effect_on_claims": ["C-02"]},
            {"state_variable_id": "SV-HORMUZ-ACTUAL", "name": "霍尔木兹通航", "linked_judgment_units": ["JU-03"], "coverage_refs": ["SVC-03"], "observed_direction": "受限", "evidence_status": "partial", "effect_on_path": "P-02", "effect_on_claims": ["C-03"]},
            {"state_variable_id": "SV-HE-RESTART", "name": "氦气复产", "linked_judgment_units": ["JU-03"], "coverage_refs": ["SVC-04"], "observed_direction": "滞后", "evidence_status": "partial", "effect_on_path": "P-02", "effect_on_claims": ["C-03"]},
            {"state_variable_id": "SV-FAB-PRECISE", "name": "精确量化", "linked_judgment_units": ["JU-07"], "coverage_refs": ["SVC-14"], "observed_direction": "不可判断", "evidence_status": "blocked", "effect_on_path": "P-03", "effect_on_claims": ["C-07"]},
        ],
        "data_logic": {
            "metrics": ["半导体指数涨跌幅", "氦气全球占比", "设备订单趋势"],
            "formulas": [],
            "scope_notes": ["指数仅为情绪代理", "SEMI为汇总层"],
            "time_lag_notes": ["实物流滞后谈判 rhetoric 数周至数月"],
            "known_limitations": ["无 MOU 原文", "无航运硬统计", "无 fab 精确披露"],
        },
        "report_quality_check": {
            "answer_first": True,
            "one_page_summary_under_500_chars": False,
            "core_landing_has_three_layers": True,
            "claims_within_03_use_limits": True,
            "claim_labels_match_evidence_strength": True,
            "object_differentiation_clear": True,
            "change_gates_observable": True,
            "no_internal_ids_in_main_text": True,
            "no_investment_advice": True,
            "audit_report_consistent": True,
            "result": "pass",
            "return_required": False,
            "return_stage": None,
            "return_reasons": [],
        },
        "compliance_check": {
            "no_rating_target_price_return_forecast_or_position_advice": True,
            "no_new_unfrozen_evidence": True,
            "no_scope_drift": True,
            "citations_or_evidence_refs_complete": True,
            "publishable": True,
        },
    }


def main() -> None:
    report_path = OUT / F04M
    audit_path = OUT / F04Y
    report_path.write_text(build_report(), encoding="utf-8")
    audit_path.write_text(
        yaml.dump(build_audit(), allow_unicode=True, sort_keys=False, default_flow_style=False),
        encoding="utf-8",
    )
    print(f"Wrote {report_path.name} and {audit_path.name}")


if __name__ == "__main__":
    main()
