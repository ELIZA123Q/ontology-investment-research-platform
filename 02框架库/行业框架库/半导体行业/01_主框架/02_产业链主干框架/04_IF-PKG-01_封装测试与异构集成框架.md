---
framework_id: IF-PKG-01
name: 封装测试与异构集成框架
library: industry_semiconductor
version: 6.0.0
status: core
framework_type: value_chain_main
validation_status: pending_two_tasks
validated_case_refs: []
updated_at: 2026-07-13
---

# 封装测试与异构集成框架

## 研究员先看什么：系统合格交付由最窄瓶颈决定

中介层/基板、凸点或键合、TSV、组装、测试、热管理、级联良率、设备材料与客户认证共同决定系统合格产出。某一道工序的名义产能不能代表整条封装链能力，瓶颈还会随产品代际迁移。

封装价值量提升也不自动等于利润池提升；资本强度、良率责任、返工报废、客户议价与配套成本可能吸收增量。

## 1. 适用边界与核心分歧

适用于传统封测、先进封装、Chiplet、2.5D/3D、HBM 配套、测试与异构集成。必须固定封装路线、产品代际、工序边界、产能单位、客户认证和交付口径。

核心分歧是瓶颈究竟位于产能、配套材料、良率、测试/热管理还是认证；瓶颈缓解时间；以及合格系统产出和利润池由谁获得。

## 2. 特有机制、阶段门与关键时钟

```text
分工序名义产能 → 配套材料/设备 → WIP 与周期时间
→ 各步良率级联 → 测试与热管理 → 客户认证 → 合格系统交付
```

| 阶段门 | 关键机制 | 典型误判 |
|---|---|---|
| 工序产能 | 各工序单位和节拍必须可串联 | 单看 CoWoS/键合名义产能 |
| 配套完整性 | 基板、设备、材料和熟练人员任一可阻断 | 主工序扩产等同系统扩产 |
| 级联良率 | 多 die、多层互连放大单步损失 | 单步良率代替系统良率 |
| 测试与散热 | 测试覆盖、功耗与热设计决定可交付 | 封装完成等同系统合格 |
| 客户认证 | 产品代际和客户变更需重新验证 | 工艺可用等同客户采用 |

## 3. 决胜变量、区分信号与最低证据

| 决胜变量 | 区分信号 | 最低证据 |
|---|---|---|
| 分工序能力 | 节拍、WIP、周期时间、瓶颈利用率 | 至少两道相邻关键工序数据 |
| 基板/材料/设备 | 交期、合格率、设备到位与维护 | 配套供给 + 实际生产交叉 |
| 级联良率 | 单步与系统良率、返工和报废 | 多批次良率或客户质量信息 |
| 测试与热管理 | 测试时间、覆盖率、热设计变更 | 测试/散热验证或交付结果 |
| 客户认证与代际 | 认证完成、产品切换、复购 | 客户采用和实际合格交付 |
| 利润池 | 定价、良率责任、资本强度、议价 | 收费/成本责任或可比毛利资本回报 |

## 4. 竞争解释、候选反证与停止条件

| 解释 | 区分预测 | 主要候选反证 |
|---|---|---|
| 主解释：最窄瓶颈限制合格系统交付 | 瓶颈工序 WIP/交期高，其他工序有闲置或等待 | 多工序同步满载且系统交付正常 |
| 竞争解释：问题来自良率而非产能 | 名义产能在，但报废/返工和系统良率恶化 | 良率稳定、单一工序交期显著拉长 |
| 竞争解释：瓶颈已迁移到基板/测试/散热 | 原瓶颈缓解，系统交付仍未改善 | 配套与系统交付同步改善 |
| 竞争解释：价值量提升未进入利润池 | 收入增而良率损失、折旧或议价抵消 | 单位经济和资本回报持续改善 |

工序和产能单位不可比、只见单点扩产、级联良率或客户认证缺失、无法定位瓶颈时，停止系统供给判断。利润裁决交给 BF-EE-01/04。

## 5. 本框架特有输出

```yaml
framework_layer: mechanism
output_gate_refs: [IF-PKG-01.bottleneck_location, IF-PKG-01.qualified_system_output, IF-PKG-01.profit_pool_readiness]
judgment_types: [state_measurement, mechanism_transmission, causal_attribution]
state_variable_candidates: [step_capacity, substrate_supply, bonding, test_time, thermal_limit, cascaded_yield, qualified_output]
signal_candidates: [bottleneck_utilization, wip, substrate_delivery, cycle_time, system_yield, customer_qualification]
output_objects: [packaging_flow, narrowest_bottleneck, bottleneck_migration, qualified_system_output]
evidence_requirements: [分工序产能与节拍, 配套材料设备, 级联良率, 测试热管理, 客户认证, 利润责任]
falsification_conditions: [nameplate_only, bottleneck_shift, yield_loss, missing_component, value_without_profit]
scenarios: [capacity_bottleneck, yield_bottleneck, bottleneck_migration]
```

运行时字段从[依赖 registry 与输出协议](../../../../01_框架依赖图与输出协议.md)解析。

## 6. 组合、裁剪与真实任务验证

- 先进封装瓶颈：`SCN-PKG-BTL + IF-PKG-01`，只选择目标封装路线的关键工序。
- HBM：增加 `SCN-MEM-HBM`，区分存储供给与封装配套供给。
- 设备或材料只在其成为候选瓶颈时接 IF-EQP/IF-MAT，不复制完整框架。
- 本框架尚无合格任务记录，保持 `pending_two_tasks`；公司利润由 BF-EE-01 承接。
