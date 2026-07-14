---
framework_id: IF-FAB-01
name: 晶圆制造、工艺平台与产能框架
library: industry_semiconductor
version: 6.2.0
status: core
framework_type: value_chain_main
validation_status: pending_two_tasks
validated_case_refs: []
updated_at: 2026-07-14
---

# 晶圆制造、工艺平台与产能框架

## 研究员先看什么：名义产能×生产率→合格产出

```text
单位名义产能的有效产出 ≈ 投片 × 周期时间折损 × 良率
× 产品组合 × 晶圆面积效率 × 客户可售认证范围
```

厂房/设备到位≠有效供给。先进工艺、HBM、功率、特色工艺尤忌只比 wpm。负责：名义→合格晶圆。不负责：后段系统交付、公司利润展开。后段交 PKG；财务只给准备度再交 BF-EE-01。

## 1. 适用边界与核心分歧

固定厂区、尺寸、节点/工艺、产品组合、客户与统计单位。候选：`effective_capacity` 名义/设施/试运行/认证中/合格产出/稳定有效；`ramp_timing` 未开始/延期/学习/加速/稳定/回退。`manufacturing_economics_readiness` 只问：良率能否经济生产、利用率能否吸收固定成本、组合是否支撑合理 ASP——不展开毛利折旧桥。

## 2. 特有机制、阶段门与关键时钟

| 阶段门 | 关键机制 | 典型时钟 |
|---|---|---|
| 设施设备就绪 | 厂务与瓶颈设备闭环 | 搬入早于工艺 |
| 工艺与生产率 | 周期、缺陷、面积效率、学习曲线 | 投片早于合格产出 |
| 产品认证 | 可生产≠可售 | 工艺就绪早于客户 |
| 规模爬坡 | 瓶颈 WIP、良率、稼动 | 稼动早于成本改善 |
| 经济生产准备度 | 良率门槛、利用率、组合 ASP | 不替代 EE 利润桥 |

## 3. 洞见层：领先关系、组合预测与利润池

| 信号组合 | 更可能路径 | 暂不能说明 |
|---|---|---|
| 设备到位、良率/认证未过 | 名义产能空转 | 供给释放 |
| 稼动↑、价格/组合弱、库存↑ | 备货或低价抢单 | 需求驱动复苏 |
| 投片↑、生产率↑、订单能见度稳 | 合格供给释放候选 | 价格是否守得住 |
| 良率过经济门槛、利用率吸收折旧、组合 ASP 稳 | 经济生产准备就绪 | 公司利润（交 EE） |

领先：瓶颈设备、周期时间、良率学习；滞后：客户认证出货、单位成本稳定。利润池提示：谁掌握瓶颈设备/节点与产品组合权；代工 vs IDM 归属不同。反常：稼动创新高而合格产出或 ASP 不跟。

最低证据：瓶颈设备；投片与周期；量产良率；认证与出货；稼动来源交叉。

## 4. 竞争解释、候选反证与停止条件

| 解释 | 区分预测 | 主要候选反证 |
|---|---|---|
| 主解释：工艺成熟+需求推动有效产出 | 投片良率认证出货同向 | 仅设备搬入 |
| 竞争解释：名义扩产未形成供给 | 生产率/认证长期未过 | 合格出货持续增 |
| 竞争解释：利用率来自备货/抢单 | 库存增、价组合弱 | 库存去化价稳 |
| 竞争解释：产品切换扰动良率 | 新旧 WIP 分化 | 多产品同步恶化 |

单位不可比、缺良率认证、利用率来源不清时停止。裁决由 04。

## 5. 本框架特有输出

```yaml
framework_layer: mechanism
output_gate_refs: [IF-FAB-01.effective_capacity, IF-FAB-01.ramp_timing, IF-FAB-01.manufacturing_economics_readiness]
judgment_types: [state_measurement, mechanism_transmission, trend_or_phase]
state_variable_candidates: [installed_capacity, capacity_productivity, wafer_start, cycle_time, yield, product_mix, area_efficiency, qualified_output]
signal_candidates: [tool_move_in, yield_ramp, utilization, customer_qualification, mix_shift]
output_objects: [nominal_to_effective_bridge, capacity_productivity, supply_release_timing, economics_readiness]
evidence_requirements: [瓶颈设备, 投片周期, 良率, 认证出货, 稼动来源]
falsification_conditions: [nameplate_only, low_productivity, yield_failure, utilization_without_demand]
scenarios: [tool_ready_process_not, qualified_ramp, utilization_without_demand]
```

使用时字段见[README](../../../README.md#4-依赖登记与输出合同)，精确门槛读[依赖登记表](../../../00_framework_dependency_registry.yaml)。

## 6. 组合、裁剪与真实任务验证

- 周期供给：+ IF-SC；后段：+ IF-PKG。EQP/MAT 仅当成为爬坡瓶颈。财务交 BF-EE-01。
- 需验证合格爬坡成立案 + 稼动来自备货/抢单失败案。`pending_two_tasks`。
