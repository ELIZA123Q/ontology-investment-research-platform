---
framework_id: IF-EQP-01
name: 半导体设备需求、验证与放量框架
library: industry_semiconductor
version: 6.2.0
status: core
framework_type: value_chain_main
validation_status: pending_two_tasks
validated_case_refs: [示例2/02-美国管制与国产设备替代研究逻辑-20260710-1.md]
updated_at: 2026-07-14
---

# 半导体设备需求、验证与放量框架

## 研究员先看什么：进入客户 ≠ 进入主工艺

```text
Fab需求 → 招标订单 → 交付安装 → 量产线验证 → 验收
→ 工序位置（备份/非关键/主工艺）→ 主供份额 → 跨线复制 → 服务备件
```

负责：需求、验证、验收与工艺位置升级。不负责：法域判断（LOC）、利润确认（EE）、合格晶圆产出（FAB）。

## 1. 适用边界与核心分歧

固定设备类别、工序、节点/尺寸、客户设施与项目时间。候选：`tool_demand`；`validation_stage`；`order_to_acceptance_readiness`。工艺位置状态变量：`process_position` = 试用 / 备份或非关键 / 量产稳定 / 主工艺关键层 / 主供 / 跨线跨厂。

## 2. 特有机制、阶段门与关键时钟

| 阶段门 | 必须回答 | 失败点 |
|---|---|---|
| 工艺需求 | 工序、步数、强度 | TAM 重复、项目延期 |
| 交付安装 | 软硬件与服务就绪 | 发货未上线 |
| 量产线验证 | 多批稳定与良率影响 | 实试验外推量产 |
| 工艺位置 | 备份还是主工艺/关键层 | “进客户”当成主供 |
| 验收复购复制 | 合同验收与跨线 | 首台无复购 |

## 3. 洞见层：领先关系、组合预测与利润池

| 信号组合 | 更可能路径 | 暂不能说明 |
|---|---|---|
| 验证过、无复购 | 单点导入或项目延期 | 平台化放量 |
| 复购有、无跨线、仅非关键层 | 客户特定/边缘方案 | 改变客户工艺依赖 |
| 进入主工艺、服务弱 | 规模扩张受阻 | 可持续份额 |
| 主工艺+主供+跨线+服务同步 | 平台化放量候选 | 利润率（交 EE） |
| 订单大、安装验收后移 | 集中采购挂账 | 当年收入 |

领先：验证线位置、工艺结果；滞后：复购、主供份额、跨厂复制。利润池：主工艺主供+服务备件；备份设备订单利润通常弱。反常：名单进客户但工艺位置仍是备用。

最低证据：项目工艺需求；线位置与工艺结果；验收条款；复购/跨线；服务与核心部件。

## 4. 竞争解释、候选反证与停止条件

| 解释 | 区分预测 | 主要候选反证 |
|---|---|---|
| 主解释：主工艺验证推动主供与复制 | 位置升级→复购→跨线 | 仅样机/首台/备份 |
| 竞争解释：项目采购延期 | 订单在验收后移 | 按期验收投产 |
| 竞争解释：低价导入无竞争力 | 份额升复购/评价弱 | 复购与经济性改善 |
| 竞争解释：部件服务卡脖子 | 验证过交付能力不足 | 多客户稳定运行 |

类别不清、线位置未知、仅首单自述时停止。裁决由 04。

## 5. 本框架特有输出

```yaml
framework_layer: company_realization
output_gate_refs: [IF-EQP-01.tool_demand, IF-EQP-01.validation_stage, IF-EQP-01.order_to_acceptance_readiness]
judgment_types: [state_measurement, mechanism_transmission, object_comparison]
state_variable_candidates: [fab_project, tool_intensity, validation_stage, process_position, acceptance, repeat_order, cross_line_replication]
signal_candidates: [tender, move_in, line_validation, critical_layer_adoption, acceptance, repeat_order]
output_objects: [tool_demand_bridge, process_position_gate, order_to_acceptance_bridge]
evidence_requirements: [工艺需求, 线位置与工艺结果, 验收, 复购跨线, 服务部件]
falsification_conditions: [backup_only, project_delay, validation_failure, no_repeat_order, service_constraint]
scenarios: [backup_not_main_process, validation_without_repurchase, platform_scale]
```

使用时字段见[README](../../../README.md#4-依赖登记与输出合同)，精确门槛读[依赖登记表](../../../00_framework_dependency_registry.yaml)。

## 6. 组合、裁剪与真实任务验证

- `SCN-LOC-EQP + IF-LOC`：EQP 判工艺位置与复购，LOC 判约束增量。封装设备用 `SCN-PKG-BTL`。
- 成立案例：[`示例2/...`](../../../../示例2/02-美国管制与国产设备替代研究逻辑-20260710-1.md)。尚需首台强但未主工艺/未复购失败案。`pending_two_tasks`。
