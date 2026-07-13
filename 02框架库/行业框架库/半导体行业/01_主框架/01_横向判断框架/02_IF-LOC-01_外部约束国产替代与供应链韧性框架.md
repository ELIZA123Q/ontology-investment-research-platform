---
framework_id: IF-LOC-01
name: 外部约束、国产替代与供应链韧性框架
library: industry_semiconductor
version: 6.0.0
status: core
framework_type: horizontal_constraint
validation_status: pending_two_tasks
validated_case_refs: [示例2/02-美国管制与国产设备替代研究逻辑-20260710-1.md]
updated_at: 2026-07-13
---

# 外部约束、国产替代与供应链韧性框架

## 研究员先看什么：把“替代”拆成阶段

```text
替代意愿 → 技术可用 → 客户验证 → 产线导入 → 稳定量产
→ 复购/跨线复制 → 供应份额 → 双源与长期韧性
```

外部约束可能加快验证，也可能同时限制关键零部件、软件、服务或终端需求。国产份额提升与供应链韧性不是同义词：以单一国产供应商替代单一海外供应商，仍可能形成新的集中风险。

## 1. 适用边界与核心分歧

适用于出口管制、许可、制裁、地缘事件、国产替代、供应安全与双源策略。必须明确受限物项、法域、客户、工艺位置和生效时间；政策方向、企业名单和首单不能代替实际约束或量产结果。

核心分歧是：约束是否真正穿透库存和既有许可；本土方案处于哪一级采用阶段；替代是否降低了关键依赖、集中度与恢复时间。收入、利润和现金交给 BF-EE-01。

## 2. 特有机制、阶段门与关键时钟

| 阶段门 | 关键问题 | 特有失败方式 |
|---|---|---|
| 约束事实 | 权限、物项、对象、许可与时间是否适用 | 新闻叙事强于正式规则 |
| 约束传导 | 库存、替代路线、既有许可和客户调整能缓冲多久 | 起点成立但中介无变化 |
| 认证采用 | 实验室、产线、批量、复购、跨线复制停在哪一级 | 送样或首单长期不复购 |
| 韧性结果 | 关键部件、软件、原料、服务和双源是否真的改善 | 份额提高但单点依赖未降 |

政策时钟、库存缓冲时钟、认证时钟和复购时钟通常不同步。阶段必须按 registry 的 `constraint_path`、`localization_stage`、`resilience_state` 分别输出。

## 3. 决胜变量、区分信号与最低证据

| 决胜变量 | 区分信号 | 最低证据 |
|---|---|---|
| 约束强度与适用范围 | 许可批准/拒绝、执法、客户调整 | 正式文本 + 执行或许可事实 |
| 库存与替代缓冲 | 库存消耗、交期、替代路线启用 | 受限环节库存 + 实际交付变化 |
| 验证层级 | 量产线位置、多批次稳定性、良率 | 客户验证或可追溯工艺结果 |
| 复购与复制 | 重复订单、跨线/跨厂采用 | 首批之后的复购或复制证据 |
| 核心依赖与韧性 | 双源覆盖、集中度、恢复时间 | BOM/软件/原料/服务穿透信息 |

若只能获得公司自述，03 应优先寻找客户侧、许可/海关、交付、复购或供应链交叉证据，而不是扩充同类二手观点。

## 4. 竞争解释、候选反证与停止条件

| 解释 | 区分预测 | 主要候选反证 |
|---|---|---|
| 主解释：外部约束推动可持续本地替代 | 验证、批量、复购和跨线复制依次出现，关键依赖下降 | 只有意愿/首单，核心部件仍不可得 |
| 竞争解释：份额增长来自低价或政策性备份 | 订单有但利用、复购和毛利不跟随 | 客户主动扩大主供份额并持续复购 |
| 竞争解释：约束同时压低终端或产能需求 | 国产份额升但总需求、设备利用或投片下降 | 总需求稳定且本土方案净增量明确 |
| 竞争解释：供应商替换但韧性未改善 | 集中度、恢复时间或上游单点不降 | 双源覆盖和关键依赖同步改善 |

受限物项或法域不清、只有政策表态、采用阶段无法区分、核心依赖无法穿透时，停止替代或韧性结论。02 不规定降级等级，裁决由 04 执行。

## 5. 本框架特有输出

```yaml
framework_layer: mechanism
output_gate_refs: [IF-LOC-01.constraint_path, IF-LOC-01.localization_stage, IF-LOC-01.resilience_state]
judgment_types: [mechanism_transmission, object_comparison, risk_reassessment]
state_variable_candidates: [constraint_intensity, buffer_duration, qualification_stage, yield, batch_delivery, repurchase, dependency_concentration]
signal_candidates: [license, inventory_runoff, line_test, batch_order, repurchase, alternate_supply]
output_objects: [constraint_path, localization_stage, blocking_node, resilience_path]
evidence_requirements: [约束执行事实, 库存与许可缓冲, 量产线验证, 复购复制, 核心依赖与双源]
falsification_conditions: [license_relief, qualification_failure, no_repurchase, demand_destruction, dependency_not_reduced]
scenarios: [constraint_absorbed_by_buffer, localization_with_replication, substitution_without_resilience]
```

运行时字段和职责交接从[依赖 registry 与输出协议](../../../../01_框架依赖图与输出协议.md)解析。

## 6. 组合、裁剪与真实任务验证

- 国产设备：`SCN-LOC-EQP + IF-LOC-01 + IF-EQP-01`，本框架只补约束与韧性。
- 国产材料：`SCN-LOC-MAT + IF-LOC-01 + IF-MAT-01`，避免把送样写成替代完成。
- 地缘冲击：`SCN-GEO + IF-LOC-01`，按受限物项裁剪，不泛化到全产业链。
- 已记录案例：[`示例2/02-美国管制与国产设备替代研究逻辑-20260710-1.md`](../../../../../示例2/02-美国管制与国产设备替代研究逻辑-20260710-1.md)。尚缺第二个独立任务，保持 `pending_two_tasks`。
