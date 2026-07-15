---
framework_id: IF-APP-01
name: 应用需求与半导体内容量框架
library: industry_semiconductor
version: 6.2.0
status: core
framework_type: value_chain_main
validation_status: pending_two_tasks
validated_case_refs: []
updated_at: 2026-07-14
---

# 应用需求与半导体内容量框架

## 研究员先看什么：收窄到净内容量桥，场景再补时钟

```text
终端数量 × 实际采用配置 × 渗透率 × 单位半导体净内容量
－ 替代与效率抵消
= 理论新增消耗候选
```

部署、利用、SOP/装车、激活/渠道、更新周期等**不是**通用必经门；按场景增量调用：AI→部署与利用；汽车→SOP/装车；消费电子→激活与渠道；工业→设备投资与更新。采购/库存/周期确认交 IF-SC-01。

负责：终端→净内容量与真实消耗候选。不负责：周期阶段、份额、公司利润。

## 1. 适用边界与核心分歧

适用于各终端向芯片、存储、功率、模拟、光电子的需求映射。必须固定终端口径、配置代际、系统边界、地域与时间；不得把旗舰 SKU 外推全市场。

核心分歧：配置是否真实采用并扩散；净内容量是否被替代/效率抵消；场景时钟是否已用对。候选：`theoretical_content` 未建立 / 路线图 / 实际配置 / 可比净内容量；`realized_consumption` 未采用 / 采用未扩散 / 净消耗增长 / 分化；`demand_transmission` 增强 / 稳定 / 减弱 / 分化。

## 2. 特有机制、关键环节与关键时钟

| 阶段门 | 必须回答 | 常见错位 |
|---|---|---|
| 终端与配置 | 实际产量/装机与真实 SKU 配置 | 路线图当采用 |
| 渗透扩散 | 配置覆盖范围而非样板 | 旗舰外推整体 |
| 净内容量 | 单位净半导体用量扣替代/效率 | 单项 BOM 增=系统价值增 |
| 场景时钟（可选） | 部署/利用、SOP、激活等是否必要时才加 | 通端强行套利用率 |

## 3. 洞见层：领先关系、组合预测与利润池

| 信号组合 | 更可能路径 | 暂不能说明 |
|---|---|---|
| 配置进入量产 SKU、渗透上升、净内容量不减 | 真实新增消耗候选 | 采购是否立即跟随（交 SC） |
| 规格升、渗透窄或仅旗舰 | 叙事内容量 / 未兑现 | 全市场放量 |
| 采购升、配置/渗透不动 | 补库或抢货 | 真实消耗增长 |
| 净内容量升、系统总预算/旧器件同步砍 | 替代抵消 | 净行业增量 |

领先：实际配置采用、渗透范围；滞后：可比系统净 BOM、分应用芯片出货。利润池提示：系统瓶颈环节（封装/网络/电力）常拿走增量，芯片厂未必。反常：规格声量大、净内容量不升。

最低证据：同口径终端序列；实际配置/客户采用；渗透范围；替代前后可比 BOM。AI/车规等场景最低证据由对应场景卡追加。

## 4. 竞争解释、候选反证与停止条件

| 解释 | 区分预测 | 主要候选反证 |
|---|---|---|
| 主解释：采用扩散推动净消耗 | 配置、渗透、净内容量同向 | 采购升而渗透不动 |
| 竞争解释：规格未扩散 | 旗舰强、整体渗透弱 | 跨 SKU 渗透扩大 |
| 竞争解释：替代/效率抵消 | 单项升、系统净价值不升 | 可比净 BOM 增加 |
| 竞争解释：用了错误场景时钟 | 通用利用率套在一次性芯片上 | 按场景删冗余时钟后仍成立 |

路线图-only、边界不清、净内容量不可比时停止。裁决由 04。

## 5. 本框架特有输出

以下为系统登记，研究员可不读。

```yaml
framework_layer: mechanism
output_gate_refs: [IF-APP-01.theoretical_content, IF-APP-01.realized_consumption, IF-APP-01.demand_transmission]
judgment_types: [mechanism_validation, transmission_path, causal_attribution, trend_direction]
state_variable_candidates: [terminal_units, configuration_content, penetration, net_content, substitution, efficiency_offset]
signal_candidates: [sku_adoption, penetration_spread, net_bom_change, component_shipment]
output_objects: [terminal_to_net_content_bridge, theoretical_content, realized_consumption]
evidence_requirements: [终端数量, 实际配置, 渗透范围, 净内容量与替代]
falsification_conditions: [specification_without_adoption, narrow_penetration, substitution_offset, wrong_scene_clock]
scenarios: [config_without_spread, net_content_growth, substitution_offset]
```

组合方式见框架库 README「怎样选用」；系统核对见文末登记说明。需要核对进入条件与可写到哪一层时，见根目录依赖说明。

## 6. 组合、裁剪与真实任务验证

- AI：`SCN-AI` 追加部署/利用；车规：`SCN-AUTO` 默认接 DES，内容量问题再加本框架；光/SiC 用对应卡。
- 周期确认交 IF-SC-01；财务交 BF-EE-01。
- 需验证：净内容量成立案例；规格升但未扩散/被抵消的失败案例。保持 `尚待两次真实任务验证`。
