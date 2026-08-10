---
framework_id: IF-LOC-01
name: 外部约束、国产替代与供应链韧性框架
library: industry_semiconductor
version: 6.2.1
status: core
framework_type: horizontal_constraint
validation_status: pending_two_tasks
validated_case_refs: [04_context_state/03_workspace/02_V3样例/02_us-controls-localization-run-002/02_structure.yaml]
updated_at: 2026-07-14
---

# 外部约束、国产替代与供应链韧性框架

## 研究员先看什么：问约束改变了什么，而不是重做认证阶梯

```text
正式约束与执行 → 缓冲是否被穿透 → 相对无约束反事实的增量变化
→ 替代是否加速/主供份额是否变 → 残存核心依赖 → 韧性是否改善
```

负责：约束效应、替代加速、残存依赖、韧性变化。不负责：EQP/MAT/DES 自身认证阶梯（只读取其阶段作输入）。份额升≠韧性升。凡引用国产化率/份额，须同时标注 `环节 × 统计口径（采购额/台数/WFE）× 节点或客户`；缺一不得进入 `resilience_state`。

## 1. 适用边界与核心分歧

适用于管制、许可、制裁、地缘、国产替代、双源。必须固定物项、法域、客户、工艺位置与生效时间。

registry 门保持：`constraint_path` / `localization_stage` / `resilience_state`。语义收窄为：

| gate | 本框架自产含义 |
|---|---|
| `constraint_path` | 约束是否真实穿透（叙事/被缓冲/实质/加深/缓解） |
| `localization_stage` | **替代加速度**：相对反事实，验证/主供/复购是否因约束而加快（读取下游阶段，不自建阶梯） |
| `resilience_state` | 集中度、双源、恢复时间、残存依赖是否改善 |

## 2. 特有机制、关键环节与关键时钟

| 阶段门 | 关键问题 | 失败方式 |
|---|---|---|
| 约束事实 | 规则是否适用并执行 | 舆论强于正式规则 |
| 缓冲穿透 | 库存/许可/合同能撑多久 | 起点成立中介无变 |
| 替代加速 | 约束是否提高验证/主供速度 | 把读取阶段当成 LOC 产出 |
| 残存依赖 | 替代后还剩哪些单点 | 整机国产掩盖上游依赖 |
| 韧性变化 | 集中度/双源/恢复时间 | 单一本土替代单一海外；混用无口径份额 |

## 3. 洞见层：领先关系、组合预测与利润池

| 信号组合 | 更可能路径 | 暂不能说明 |
|---|---|---|
| 约束穿透、缓冲耗尽、下游验证加速 | 替代窗口打开 | 利润归属 |
| 份额↑、双源↓或新单点↑ | 假性韧性 | 供应安全改善 |
| 份额↑、总需求/投片↓ | 蛋糕变小的份额游戏 | 产业繁荣 |
| 约束缓解、缓冲重建 | 紧迫感回落 | 本土方案立即退出 |

领先：许可/执法、缓冲消耗；滞后：复购复制、集中度指标。利润池：真正降依赖且能主供的环节；纯政策备份订单往往利润弱。反常：国产份额新闻多、核心部件进口依赖不变。

最低证据：正式约束与执行；缓冲状态；下游采用阶段（读）；双源/集中度/恢复时间。

## 4. 竞争解释、候选反证与停止条件

| 解释 | 区分预测 | 主要候选反证 |
|---|---|---|
| 主解释：约束推动可持续替代且韧性升 | 加速验证+复购+依赖下降 | 仅首单，核心部件不可得 |
| 竞争解释：政策性备份份额 | 订单有、利用复购弱 | 主供扩大并复购 |
| 竞争解释：约束压需求 | 份额升总量降 | 总量稳且净增量明确 |
| 竞争解释：替换未降风险 | 集中度/恢复时间不降 | 双源与依赖同步改善 |

物项法域不清、无法读下游阶段、依赖不可穿透、或以无口径国产化率推韧性时停止。裁决由 04。

## 5. 本框架特有输出

以下为系统登记，研究员可不读。

```yaml
framework_layer: mechanism
output_gate_refs: [IF-LOC-01.constraint_path, IF-LOC-01.localization_stage, IF-LOC-01.resilience_state]
judgment_types: [mechanism_validation, transmission_path, object_differentiation, impact_realization]
state_variable_candidates: [constraint_effect, buffer_duration, substitution_acceleration, residual_dependency, dependency_concentration, alternate_supply]
signal_candidates: [license, inventory_runoff, repurchase_read, concentration_change, recovery_time]
output_objects: [constraint_path, substitution_acceleration, residual_dependency, resilience_change]
evidence_requirements: [约束执行, 缓冲穿透, 下游阶段读取, 残存依赖, 双源与恢复时间]
falsification_conditions: [license_relief, no_acceleration, new_single_source, demand_destruction, dependency_not_reduced]
scenarios: [constraint_absorbed, accelerated_localization, substitution_without_resilience]
```

组合方式见框架库 README「怎样选用」；系统核对见文末登记说明。需要核对进入条件与可写到哪一层时，见根目录依赖说明。

## 6. 组合、裁剪与真实任务验证

- 设备：`SCN-LOC-EQP + IF-EQP`；材料：`SCN-LOC-MAT + IF-MAT`；地缘：`SCN-GEO`（市场通道交预期差/估值基础框架）。
- 成立案例：[`04_context_state/03_workspace/02_V3样例/02_us-controls-localization-run-002/...`](../../../../../04_context_state/03_workspace/02_V3样例/02_us-controls-localization-run-002/02_structure.yaml)。尚需失败案（份额升+新单点依赖）。`尚待两次真实任务验证`。
