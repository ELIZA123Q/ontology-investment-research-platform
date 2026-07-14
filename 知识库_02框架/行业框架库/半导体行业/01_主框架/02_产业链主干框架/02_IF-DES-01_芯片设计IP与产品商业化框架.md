---
framework_id: IF-DES-01
name: 芯片设计、IP与产品商业化框架
library: industry_semiconductor
version: 6.0.0
status: core
framework_type: value_chain_main
validation_status: pending_two_tasks
validated_case_refs: []
updated_at: 2026-07-13
---

# 芯片设计、IP与产品商业化框架

## 研究员先看什么：每个商业化阶段都可能归零

```text
产品定义 → 架构/IP → 设计验证 → 流片/回片 → 客户验证
→ design win → 量产 → 复购 → 平台迭代
```

design win 不等于量产收入，量产也不等于良好经济性。研究员必须说明当前证据停在哪一级、下一阶段成功需要什么，以及失败后是否回到前一阶段或产品归零。

## 1. 适用边界与核心分歧

适用于无晶圆厂设计公司、IDM 设计端、IP/EDA、定制芯片与平台化产品的研发、验证和商业化。必须固定产品代际、目标客户、应用、工艺节点和供应链方案。

核心分歧是当前阶段是否被证据确认、技术可用能否转化为客户采用、商业模式和竞争边界是否支持可持续经济性。收入、利润和现金的实际兑现由 BF-EE-01 承接。

## 2. 特有机制、阶段门与关键时钟

| 阶段门 | 必要条件 | 可能归零点 |
|---|---|---|
| 产品与架构 | 需求定义、PPA/成本目标、IP/生态可得 | 目标变化或生态不兼容 |
| 流片与回片 | 设计签核、工艺可制造、样片功能 | 延期、功能缺陷、重流片 |
| 客户验证 | 系统适配、软件、可靠性、成本 | 测试失败或客户方案切换 |
| design win | 项目定点与量产计划 | 项目取消、份额或时间不确定 |
| 量产复购 | 供应、良率、交付、实际装机 | 良率/成本失控或无复购 |
| 平台迭代 | 复用、生态、客户迁移、代际节奏 | 新品蚕食旧品且无净增长 |

阶段状态可独立输出；商业质量才需要商业模式与竞争市场前置，不能把 BF-BM-01 当作进入本框架的总门槛。

## 3. 决胜变量、区分信号与最低证据

| 决胜变量 | 区分信号 | 最低证据 |
|---|---|---|
| 当前阶段 | 流片、样片、客户测试、定点、量产、复购 | 阶段对应的可追溯里程碑 |
| 软件与生态 | 工具链、开发者、系统适配和迁移成本 | 客户/生态侧采用或兼容证据 |
| 供应与良率 | 晶圆、封测、die size、良率和交期 | 供应安排 + 可交付性证据 |
| 客户质量 | 客户数量、集中度、项目生命周期 | 客户/项目口径订单或出货 |
| 单位经济 | ASP、晶圆封测成本、研发摊销、售后 | 同代际收入成本或可信代理 |
| 复购与平台化 | 重复订单、跨客户、跨代际迁移 | 首次量产后的实际复购 |

## 4. 竞争解释、候选反证与停止条件

| 解释 | 区分预测 | 主要候选反证 |
|---|---|---|
| 主解释：产品跨过阶段门并形成可持续采用 | 客户验证后出现量产、复购和跨客户扩展 | 只有定点或一次性备货 |
| 竞争解释：design win 被误写为收入 | 项目时间、份额和量产尚不确定 | 可追溯出货、装机与复购 |
| 竞争解释：技术成功但经济性差 | 出货增长而毛利/现金或单位成本恶化 | 规模增长伴随单位经济改善 |
| 竞争解释：单客户定制不可复制 | 收入集中且下一客户仍需完整重做 | 平台复用和跨客户采用出现 |

产品代际或客户边界不清、阶段只有公司自述、验证与量产无法区分、供应或软件生态不可确认时，停止商业化质量判断，最多保留阶段候选。裁决动作由 04 决定。

## 5. 本框架特有输出

```yaml
framework_layer: company_realization
output_gate_refs: [IF-DES-01.commercialization_stage, IF-DES-01.commercial_quality, IF-DES-01.realization_readiness]
judgment_types: [state_measurement, mechanism_transmission, object_comparison]
state_variable_candidates: [development_stage, tapeout, customer_validation, design_win, mass_production, repeat_order, ecosystem_readiness]
signal_candidates: [prototype, tapeout, customer_test, design_win, shipment, installation, repeat_order]
output_objects: [commercialization_stage, stage_gate, ecosystem_dependency, realization_readiness]
evidence_requirements: [阶段里程碑, 客户与生态验证, 供应良率, 量产装机, 复购与单位经济]
falsification_conditions: [stage_confusion, validation_failure, no_supply, poor_unit_economics, no_repeat_order]
scenarios: [design_win_without_volume, volume_without_economics, repeatable_platform_adoption]
```

使用时字段从[依赖登记表与输出要求](../../../../01_框架依赖与输出要求.md)解析。

## 6. 组合、裁剪与真实任务验证

- 应用牵引不确定时增加 IF-APP-01；只判断技术阶段时无需先加载完整商业模式框架。
- 判断商业化质量时读取 BF-BM-01 和 BF-IC-01 对应 output gate。
- 车规芯片优先叠加 `SCN-AUTO`；AI 芯片优先叠加 `SCN-AI`，不同时加载无关场景。
- 本框架尚无合格任务记录，保持 `pending_two_tasks`；公司兑现统一交给 BF-EE-01。
