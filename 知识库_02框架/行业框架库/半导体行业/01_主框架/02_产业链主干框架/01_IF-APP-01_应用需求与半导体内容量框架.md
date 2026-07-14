---
framework_id: IF-APP-01
name: 应用需求与半导体内容量框架
library: industry_semiconductor
version: 6.0.0
status: core
framework_type: value_chain_main
validation_status: pending_two_tasks
validated_case_refs: []
updated_at: 2026-07-13
---

# 应用需求与半导体内容量框架

## 研究员先看什么：理论内容量不等于真实消耗

半导体需求应拆为：

```text
终端数量 × 单机/单系统配置 × 渗透率 × 实际部署利用
× 半导体份额 × 库存与采购节奏
```

规格提升只改变理论内容量；只有配置落地、系统瓶颈解除、部署利用兑现并穿过库存层，才形成真实半导体消耗。

## 1. 适用边界与核心分歧

适用于 AI 服务器、汽车、工业、消费电子、通信、电力电子等终端向芯片、存储、功率、模拟和光电子需求的映射。必须固定终端口径、配置代际、系统边界、部署地域和时间。

核心分歧是理论内容量是否被采用、采用后是否实际使用、采购是否超前或滞后于消耗，以及新增器件是否替代旧器件或挤占其他系统预算。

## 2. 特有机制、阶段门与关键时钟

| 阶段门 | 关键机制 | 常见错位 |
|---|---|---|
| 理论内容量 | 终端数量 × 配置 × 渗透 | 路线图早于量产配置 |
| 部署兑现 | 出货 → 安装 → 上线 → 利用 | 采购早于部署，部署早于利用 |
| 系统约束 | 电力、网络、软件、封装、散热共同限制 | 单一芯片可得但系统不可交付 |
| 采购传导 | 消耗 → 客户库存 → 采购 → 芯片出货 | 补库或抢货掩盖真实消耗 |
| 替代挤占 | 新器件增量 − 旧器件替代 − 预算迁移 | 内容量增长但总预算不增 |

`theoretical_content`、`realized_consumption` 和 `demand_transmission` 是三个独立输出门槛，不得从 BOM 直接跳到芯片出货。

## 3. 决胜变量、区分信号与最低证据

| 决胜变量 | 区分信号 | 最低证据 |
|---|---|---|
| 终端数量 | 激活/装机/产量与渠道销量的差异 | 同口径终端或使用量序列 |
| 配置与渗透 | 实际 BOM、SKU、车型/服务器平台采用 | 产品配置或客户采用证据 |
| 部署与利用 | 安装、上线、工作负载、利用率 | 部署数据 + 使用侧代理交叉 |
| 系统瓶颈 | 电力、网络、封装、软件的交付状态 | 至少一个瓶颈节点的现实证据 |
| 库存与采购 | 采购、出货和库存是否同向 | 客户/渠道库存 + 芯片出货 |
| 替代与挤占 | 新旧器件用量和系统预算净变化 | 可比系统 BOM 或预算桥 |

## 4. 竞争解释、候选反证与停止条件

| 解释 | 区分预测 | 主要候选反证 |
|---|---|---|
| 主解释：终端采用与利用推动真实消耗 | 配置、部署、利用和芯片出货按时序跟随 | 采购增长但部署利用不动 |
| 竞争解释：渠道补库或重复采购 | 采购和出货先升，终端使用与库存去化不确认 | 终端使用持续增长且库存正常 |
| 竞争解释：规格升级被替代/预算挤占抵消 | 单项内容量升但系统总半导体价值量不升 | 可比系统净 BOM 明确增加 |
| 竞争解释：系统瓶颈推迟兑现 | 芯片订单在、整机部署和利用滞后 | 瓶颈解除后部署利用同步加速 |

只有路线图或理论 BOM、部署利用不可观察、系统边界不清、采购和消耗无法对齐时，停止真实需求传导判断。命中与裁决交由 04。

## 5. 本框架特有输出

```yaml
framework_layer: mechanism
output_gate_refs: [IF-APP-01.theoretical_content, IF-APP-01.realized_consumption, IF-APP-01.demand_transmission]
judgment_types: [mechanism_transmission, causal_attribution, trend_or_phase]
state_variable_candidates: [terminal_units, configuration_content, penetration, deployment, utilization, substitution, inventory]
signal_candidates: [sku_adoption, installation, workload_utilization, procurement, component_shipment]
output_objects: [terminal_to_content_bridge, theoretical_content, realized_consumption, net_content_after_substitution]
evidence_requirements: [终端数量, 实际配置, 渗透部署, 使用利用, 系统瓶颈, 采购库存]
falsification_conditions: [specification_without_adoption, deployment_delay, bottleneck, inventory_build, budget_displacement]
scenarios: [configuration_without_deployment, utilization_led_consumption, substitution_offset]
```

使用时字段从[依赖登记表与输出要求](../../../../01_框架依赖与输出要求.md)解析。

## 6. 组合、裁剪与真实任务验证

- AI 系统：`SCN-AI + IF-APP-01`，只保留与目标芯片相关的配置、部署和瓶颈。
- 车规应用：`SCN-AUTO + IF-APP-01`，配置采用与 SOP/装车必须分开。
- SiC 或光电子：分别增加对应场景卡，优先验证系统经济性和替代项。
- 公司收入、利润和现金统一交给 BF-EE-01。本框架尚无合格任务记录，保持 `pending_two_tasks`，不得以目录完整度替代验证。
