---
framework_id: IF-MAT-01
name: 半导体材料需求、认证与放量框架
library: industry_semiconductor
version: 6.0.0
status: core
framework_type: value_chain_main
validation_status: pending_two_tasks
validated_case_refs: []
updated_at: 2026-07-13
---

# 半导体材料需求、认证与放量框架

## 研究员先看什么：耗用、认证与稳定供应缺一不可

```text
投片/封装产出 × 工艺步骤 × 单位耗用 ×（1－回收率）
→ 规格适配 → 产线认证 → 批量供应 → 复购 → 跨厂复制
```

送样、实验室参数或客户名单不能证明放量。批次一致性、微量缺陷、变更控制、保质物流和上游原料都可能使名义吨产能无法转化为合格供应。

## 1. 适用边界与核心分歧

适用于硅片/衬底、光刻胶、电子气体、湿电子化学品、前驱体、靶材、CMP、工艺耗材和封装材料。必须固定材料等级、工艺步骤、节点/尺寸、客户产线、包装物流和时间。

核心分歧是实际耗用量如何形成、材料处于哪级认证、质量和供应能否支持批量与复购，以及单厂采用能否跨线/跨厂复制。公司收入、利润和现金由 BF-EE-01 承接。

## 2. 特有机制、阶段门与关键时钟

| 阶段门 | 必须回答 | 特有失败点 |
|---|---|---|
| 消耗需求 | 投片/产出、步骤、耗用和回收如何组合 | 用 capex 直接代替材料需求 |
| 规格适配 | 纯度、缺陷、配方和工艺结果是否匹配 | 实验室指标无法稳定上产线 |
| 产线认证 | 送样、小批、单线、批量停在哪一级 | 变更控制或良率风险阻断 |
| 稳定供应 | 原料、质量、产能、库存、包装物流 | 名义吨产能不是合格产能 |
| 复购复制 | 重复订单、跨线/跨厂是否需重认证 | 单厂采用长期不能复制 |

材料消耗需求与认证阶段可以独立判断；只有二者同时满足，才进入 `volume_release_readiness`。

## 3. 决胜变量、区分信号与最低证据

| 决胜变量 | 区分信号 | 最低证据 |
|---|---|---|
| 投片/封装产出 | 实际生产而非扩产计划 | 投片、产出或可靠代理 |
| 单位耗用与回收 | 工艺步骤、配方、回收率和利用效率 | 工艺关系 + 耗用区间 |
| 质量与一致性 | 纯度、缺陷、多批稳定性、良率影响 | 产线测试或客户质量结果 |
| 认证层级 | 送样、小批、单线、批量、复购 | 阶段对应的客户/订单证据 |
| 合格供应 | 原料依赖、合格产能、库存、物流 | 上游原料 + 批量交付交叉 |
| 跨厂复制 | 不同工艺重新验证、客户变更控制 | 复购和跨线/跨厂采用 |

价格必须按等级、客户、合同和时间对齐；跨纯度或规格的吨价比较不构成最低证据。

## 4. 竞争解释、候选反证与停止条件

| 解释 | 区分预测 | 主要候选反证 |
|---|---|---|
| 主解释：产线认证与稳定供应推动放量 | 批量、复购、跨厂复制和产能利用依次出现 | 只有送样、小批或单厂采用 |
| 竞争解释：需求增长来自投片而非替代份额 | 全行业材料需求增，本土份额/客户数不变 | 同客户同工艺份额和复购提升 |
| 竞争解释：实验室参数达标但批次不稳定 | 小批测试通过，量产良率或退货恶化 | 多批稳定和持续复购 |
| 竞争解释：上游原料/物流限制合格供应 | 订单在而交期、批次或库存恶化 | 原料双源和稳定批量交付 |
| 竞争解释：效率/回收抵消工艺耗用增长 | 步骤增但单位净耗用不升 | 实际净耗用与产出同步增长 |

材料等级或工艺不清、只有 capex/名义产能、认证阶段不可区分、批次质量和复购缺失时，停止放量判断。裁决动作由 04 决定。

## 5. 本框架特有输出

```yaml
framework_layer: company_realization
output_gate_refs: [IF-MAT-01.consumption_demand, IF-MAT-01.qualification_stage, IF-MAT-01.volume_release_readiness]
judgment_types: [state_measurement, mechanism_transmission, object_comparison]
state_variable_candidates: [wafer_or_package_output, process_steps, unit_consumption, recovery_rate, qualification_stage, batch_supply, repurchase]
signal_candidates: [sample, pilot_batch, line_qualification, batch_order, repeat_order, cross_fab_copy]
output_objects: [consumption_model, qualification_gate, volume_release_path]
evidence_requirements: [投片或产出, 工艺步骤与净耗用, 批次质量, 产线认证, 批量供应, 复购复制]
falsification_conditions: [capex_proxy_only, sample_only, unstable_quality, qualification_failure, no_repeat_order, upstream_constraint]
scenarios: [demand_without_share_gain, qualification_without_stability, repeatable_volume_release]
```

使用时字段从[依赖登记表与输出要求](../../../../01_框架依赖与输出要求.md)解析。

## 6. 组合、裁剪与真实任务验证

- 国产材料：`SCN-LOC-MAT + IF-MAT-01 + IF-LOC-01`，区分认证进展与韧性结果。
- 封装材料：增加 IF-PKG-01，只保留目标封装路线中的实际耗用和瓶颈。
- SiC 等材料按场景卡限定衬底/外延/器件边界，不跨等级外推。
- 本框架尚无合格任务记录，保持 `pending_two_tasks`；财务兑现交给 BF-EE-01。
