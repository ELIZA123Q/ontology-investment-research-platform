---
framework_id: IF-FAB-01
name: 晶圆制造、工艺平台与产能框架
library: industry_semiconductor
version: 6.0.0
status: core
framework_type: value_chain_main
validation_status: pending_two_tasks
validated_case_refs: []
updated_at: 2026-07-13
---

# 晶圆制造、工艺平台与产能框架

## 研究员先看什么：从名义产能折算到合格产出

```text
设施可用 × 设备到位 × 工艺成熟 × 投片 × 周期时间
× 良率 × 产品组合 × 客户认证 = 可交付合格产出
```

厂房完工、设备搬入或月产能目标都不是有效供给。最窄瓶颈、良率学习、产品切换和客户认证决定产能何时、以什么成本释放。

## 1. 适用边界与核心分歧

适用于晶圆代工、IDM 制造、特色工艺、先进节点、成熟节点与制造平台研究。必须固定厂区、晶圆尺寸、节点/工艺、产品组合、客户和统计单位。

核心分歧是名义产能能折算出多少合格产出、爬坡何时完成、利用率变化来自需求还是备货/低价抢单，以及制造经济性是否能承接折旧与良率成本。

## 2. 特有机制、阶段门与关键时钟

| 阶段门 | 关键机制 | 典型时钟 |
|---|---|---|
| 设施设备就绪 | 厂务、关键设备、配套工序形成闭环 | 搬入早于工艺就绪 |
| 工艺成熟 | 制程窗口、周期时间、缺陷和良率学习 | 投片早于合格产出 |
| 产品认证 | 产品组合与客户验证决定可售范围 | 工艺就绪早于客户采用 |
| 规模爬坡 | 瓶颈设备、WIP、良率与稼动共同约束 | 稼动变化早于成本改善 |
| 制造经济性 | ASP/组合、良率、折旧和单位成本 | 收入早于折旧充分吸收 |

有效产能可独立判断；只有解释爬坡与供需关系时才需要 BF-SD-01 的 `balance_state`。

## 3. 决胜变量、区分信号与最低证据

| 决胜变量 | 区分信号 | 最低证据 |
|---|---|---|
| 设备与瓶颈 | 关键设备到位率、瓶颈工序 WIP | 设施/设备状态 + 瓶颈证据 |
| 投片与周期时间 | wafer start、WIP、cycle time | 至少两个相邻制造环节观测 |
| 良率与成熟度 | 学习曲线、缺陷密度、多批稳定性 | 量产级良率或可信代理 |
| 产品组合与认证 | 可生产不等于可售，客户认证范围 | 产品/客户认证与实际出货 |
| 利用率来源 | 订单、备货、低价抢单或产品切换 | 稼动 + 价格/组合/库存交叉 |
| 单位成本 | 折旧、良率、材料、能源与维护 | 单位成本或毛利桥的可比信息 |

## 4. 竞争解释、候选反证与停止条件

| 解释 | 区分预测 | 主要候选反证 |
|---|---|---|
| 主解释：需求与工艺成熟共同推动有效产出 | 投片、良率、认证、出货和单位成本依次改善 | 只有设备搬入或稼动上升 |
| 竞争解释：名义扩产尚未形成供给 | 设备/工艺/认证至少一门长期未过 | 合格出货和客户采用持续增加 |
| 竞争解释：利用率上升来自备货或低价抢单 | 库存增、实现价/组合弱、现金不改善 | 库存去化且价格组合稳定 |
| 竞争解释：产品切换造成短期良率扰动 | 新旧产品 WIP 与良率分化 | 多产品、多个季度同步恶化 |

无法统一产能单位、只见厂房或设备目标、良率/产品组合/认证缺失、利用率来源不可区分时，停止有效供给或爬坡判断。02 提候选反证，04 执行裁决。

## 5. 本框架特有输出

```yaml
framework_layer: mechanism
output_gate_refs: [IF-FAB-01.effective_capacity, IF-FAB-01.ramp_timing, IF-FAB-01.manufacturing_economics_readiness]
judgment_types: [state_measurement, mechanism_transmission, trend_or_phase]
state_variable_candidates: [installed_capacity, tool_readiness, wafer_start, cycle_time, yield, product_mix, qualified_output]
signal_candidates: [tool_move_in, pilot_run, wip, yield_ramp, utilization, customer_qualification]
output_objects: [nominal_to_effective_capacity_bridge, process_platform, supply_release_timing, manufacturing_economics_readiness]
evidence_requirements: [设施与瓶颈设备, 投片周期, 良率成熟, 产品组合, 客户认证, 单位成本]
falsification_conditions: [nameplate_only, yield_failure, bottleneck, qualification_delay, utilization_without_economics]
scenarios: [equipment_ready_process_not_ready, qualified_ramp, utilization_without_demand]
```

使用时字段从[依赖登记表与输出要求](../../../../01_框架依赖与输出要求.md)解析。

## 6. 组合、裁剪与真实任务验证

- 周期供给释放：IF-FAB-01 + IF-SC-01；只保留影响目标产品的工艺和产能。
- 先进封装或材料/设备问题分别接 IF-PKG、IF-MAT 或 IF-EQP，不展开全厂清单。
- 制造经济性只输出承接准备度，收入、利润和现金交给 BF-EE-01。
- 本框架尚无合格任务记录，保持 `pending_two_tasks`。
