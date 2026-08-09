---
framework_id: IF-PKG-01
name: 封装测试与异构集成框架
library: industry_semiconductor
version: 6.2.0
status: core
framework_type: value_chain_main
validation_status: pending_two_tasks
validated_case_refs: []
updated_at: 2026-07-14
---

# 封装测试与异构集成框架

## 研究员先看什么：瓶颈—责任—利润池三者常分离

```text
合格 die/wafer × 工序能力 × 配套 × 级联良率 × 测试/热管理 × 认证
= 合格系统交付
```

价值量升≠利润池升。关键洞见：

> 瓶颈控制者、良率损失承担者、增量价值捕获者可能不是同一主体。

负责：系统合格交付与瓶颈迁移。不负责：前段良率、终端总量。前段读 FAB。

## 1. 适用边界与核心分歧

适用于传统封测、先进封装、Chiplet、2.5D/3D、HBM 配套。固定路线、代际、工序边界、产能单位与交付口径。候选：`bottleneck_location`；`qualified_system_output` 单点/试产/受限/爬坡/稳定；`profit_pool_readiness` 须同时考虑控制权、损失承担与捕获者。

状态变量（非新增 registry gate）：`bottleneck_controller`、`yield_loss_bearer`、`incremental_value_captor`。

## 2. 特有机制、关键环节与关键时钟

| 阶段门 | 关键机制 | 典型误判 |
|---|---|---|
| 工序与配套 | 节拍可串联；基板/材料/人员可阻断 | 单看键合名义产能 |
| 级联良率 | 多 die 放大单步损失 | 单步良率=系统良率 |
| 测试与散热 | 决定可交付 | 封装完=系统合格 |
| 客户认证 | 代际变更重认证 | 工艺可用=采用 |
| 责任与捕获 | 谁控瓶颈、谁扛报废、谁涨价 | 价值量归封装厂 |

## 3. 洞见层：领先关系、组合预测与利润池

| 信号组合 | 更可能路径 | 暂不能说明 |
|---|---|---|
| 主工序扩产、交期仍紧 | 瓶颈已迁移（基板/测试/热/人员） | 原瓶颈仍是约束 |
| 价值量↑、封装厂良率责任重、客户议价强 | 收入增利润不增 | 封装厂利润池扩张 |
| 设备/材料掌控真正稀缺 | 上游捕获增量 | OSAT 份额故事 |
| 代际切换、旧路线利用率掉 | 原瓶颈价值下降 | 长期溢价 |

领先：瓶颈工序 WIP/交期、配套交期；滞后：系统合格交付、认证复购。利润池：分别标注控制者/损失承担者/捕获者再交 EE。反常：利用率满但系统交付不增。

最低证据：两道相邻工序；配套供给；级联良率；认证交付；合同中的良率责任与定价条款。

## 4. 竞争解释、候选反证与停止条件

| 解释 | 区分预测 | 主要候选反证 |
|---|---|---|
| 主解释：最窄瓶颈限制交付 | 瓶颈 WIP 高、他处等待 | 多工序满载且交付正常 |
| 竞争解释：良率问题非产能 | 名义产能在、报废升 | 良率稳、单工序交期独长 |
| 竞争解释：瓶颈已迁移 | 原瓶颈缓解交付仍差 | 配套与交付同步改善 |
| 竞争解释：价值未入利润池 | 收入增、责任/议价吃掉 | 单位经济与资本回报改善 |

单位不可比、无法定位瓶颈或责任边界时停止。裁决由 04 / EE。

## 5. 本框架特有输出

以下为系统登记，研究员可不读。

```yaml
framework_layer: mechanism
output_gate_refs: [IF-PKG-01.bottleneck_location, IF-PKG-01.qualified_system_output, IF-PKG-01.profit_pool_readiness]
judgment_types: [state_measurement, mechanism_validation, transmission_path, causal_attribution]
state_variable_candidates: [step_capacity, substrate_supply, cascaded_yield, bottleneck_controller, yield_loss_bearer, incremental_value_captor, qualified_output]
signal_candidates: [bottleneck_utilization, wip, substrate_delivery, system_yield, customer_qualification, pricing_power]
output_objects: [narrowest_bottleneck, bottleneck_migration, qualified_system_output, value_capture_map]
evidence_requirements: [分工序节拍, 配套, 级联良率, 认证交付, 良率责任与定价]
falsification_conditions: [nameplate_only, bottleneck_shift, yield_loss, value_without_profit]
scenarios: [capacity_bottleneck, bottleneck_migration, value_capture_mismatch]
```

组合方式见框架库 README「怎样选用」；系统核对见文末登记说明。需要核对进入条件与可写到哪一层时，见根目录依赖说明。

## 6. 组合、裁剪与真实任务验证

- `SCN-PKG-BTL`；HBM 加 `SCN-MEM-HBM`。EQP/MAT 仅候选瓶颈时调用。
- 需验证瓶颈定位成立 + 扩产后迁移失败两类。`尚待两次真实任务验证`。
