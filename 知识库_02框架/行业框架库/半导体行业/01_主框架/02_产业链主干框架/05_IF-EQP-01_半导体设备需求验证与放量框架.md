---
framework_id: IF-EQP-01
name: 半导体设备需求、验证与放量框架
library: industry_semiconductor
version: 6.0.0
status: core
framework_type: value_chain_main
validation_status: pending_two_tasks
validated_case_refs: [示例2/02-美国管制与国产设备替代研究逻辑-20260710-1.md]
updated_at: 2026-07-13
---

# 半导体设备需求、验证与放量框架

## 研究员先看什么：设备需求和公司收入之间有多道门

```text
Fab 投资/工艺需求 → 设备类别与强度 → 招标/订单 → 交付安装
→ 量产线验证 → 验收 → 复购/跨线复制 → 服务与备件
```

订单、发货、安装、验证、验收、收入确认和回款可能跨多个季度。设备“进入客户”只有在说明验证位置、工艺结果和下一阶段门时才有意义。

## 1. 适用边界与核心分歧

适用于前道、封装、测试、量测、厂务设备与核心零部件。必须固定设备类别、工序、节点/晶圆尺寸、客户设施和项目时间；半导体销售额同比不能直接替代设备需求。

核心分歧是 Fab 项目如何转为具体设备需求，验证是否达到量产线稳定运行，订单能否经过安装验收形成复购。收入、利润与现金由 BF-EE-01 承接。

## 2. 特有机制、阶段门与关键时钟

| 阶段门 | 必须回答 | 主要失败点 |
|---|---|---|
| 工艺需求 | 哪道工序、多少步、何种设备强度 | TAM 重复计算或项目延期 |
| 设备清单与份额 | 类别、节点和客户是否真实可服务 | 参数接近但工艺不适用 |
| 交付安装 | 产能、零部件、软件和现场服务是否就绪 | 发货后长期未上线 |
| 量产线验证 | 工艺结果、稳定性、产能和良率影响 | 实验室/中试结果外推量产 |
| 验收复购 | 合同验收、重复订单和跨线复制 | 首台低价导入后无复购 |

设备需求、验证阶段和订单至验收准备度可以分别输出；BF-VT-01 不再是进入本框架的整体硬前置。

## 3. 决胜变量、区分信号与最低证据

| 决胜变量 | 区分信号 | 最低证据 |
|---|---|---|
| Fab 项目与工艺 | 项目节点、产能、建设/扩产/升级类型 | 项目时间 + 工艺设备需求 |
| 设备强度与可服务份额 | 工序步数、设备数、节拍与适配范围 | 自下而上设备清单或可信代理 |
| 验证位置与结果 | 实验室/中试/量产线、多批次稳定性 | 客户上线、工艺结果或验收证据 |
| 核心部件与服务 | 软件、备件、驻场、供应保障 | BOM 依赖 + 交付/维护能力 |
| 订单至验收 | 订单、发货、安装、验证、验收分拆 | 合同条款 + 实际阶段观测 |
| 复购与复制 | 重复订单、跨线/跨厂、服务收入 | 首台之后的复购或复制证据 |

## 4. 竞争解释、候选反证与停止条件

| 解释 | 区分预测 | 主要候选反证 |
|---|---|---|
| 主解释：量产线验证推动复购与规模采用 | 多批稳定、验收、复购和跨线复制依次出现 | 只有样机、首台或一次性订单 |
| 竞争解释：订单来自项目集中采购但建设延迟 | 订单在而交付、安装、验收持续后移 | 项目按期投产并完成验收 |
| 竞争解释：低价导入未形成工艺竞争力 | 份额/订单升但复购、毛利或客户评价不跟随 | 复购扩大且单位经济改善 |
| 竞争解释：核心部件或服务限制规模化 | 验证通过但交付能力、开机率或维护不足 | 多客户稳定运行与及时服务 |

设备类别/工序不清、项目与订单无法对应、验证位置未知、只见首单或公司自述、验收口径缺失时，停止“突破”或放量判断。02 仅生成候选反证，04 裁决。

## 5. 本框架特有输出

```yaml
framework_layer: company_realization
output_gate_refs: [IF-EQP-01.tool_demand, IF-EQP-01.validation_stage, IF-EQP-01.order_to_acceptance_readiness]
judgment_types: [state_measurement, mechanism_transmission, object_comparison]
state_variable_candidates: [fab_project, tool_intensity, validation_stage, installation, acceptance, repeat_order, cross_line_replication]
signal_candidates: [tender, shipment, move_in, line_validation, acceptance, repeat_order]
output_objects: [fab_to_tool_demand_bridge, validation_gate, order_to_acceptance_bridge]
evidence_requirements: [Fab项目与工艺需求, 设备强度, 量产线验证, 安装验收, 复购复制, 核心部件服务]
falsification_conditions: [project_delay, sample_only, validation_failure, acceptance_delay, no_repeat_order, service_constraint]
scenarios: [order_without_installation, validation_without_repurchase, cross_line_scale]
```

使用时字段从[依赖登记表与输出要求](../../../../01_框架依赖与输出要求.md)解析。

## 6. 组合、裁剪与真实任务验证

- 国产设备：`SCN-LOC-EQP + IF-EQP-01 + IF-LOC-01`；本框架只判设备需求、验证与复购。
- 先进封装设备：`SCN-PKG-BTL + IF-EQP-01`，只选择瓶颈工序对应设备。
- 已记录案例：[`示例2/02-美国管制与国产设备替代研究逻辑-20260710-1.md`](../../../../../示例2/02-美国管制与国产设备替代研究逻辑-20260710-1.md)。尚缺第二个任务，保持 `pending_two_tasks`。
- 公司财务兑现统一交给 BF-EE-01，不以订单额直接生成收入利润结论。
