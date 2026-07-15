---
framework_id: IF-DES-01
name: 芯片设计、IP与产品商业化框架
library: industry_semiconductor
version: 6.2.0
status: core
framework_type: value_chain_main
validation_status: pending_two_tasks
validated_case_refs: []
updated_at: 2026-07-14
---

# 芯片设计、IP与产品商业化框架

## 研究员先看什么：先固定路线，再用分支表判断

进入条件（非 registry gate）：`commercialization_route` = `chip_product` | `ip_license` | `eda_subscription` | `custom_asic`。路线未定禁止用统一阶段词混写。负责：阶段是否真实跨越、采用可否持续复制。不负责：晶圆爬坡、公司财务。

## 1. 适用边界与核心分歧

适用于 Fabless、IDM 设计端、IP、EDA、ASIC。必须固定路线、代际、客户应用、节点与供应方案。候选：`commercialization_stage` 概念验证→客户评估→项目导入→商业签约→量产/持续使用→复购/续费→可复制扩展；`commercial_quality` 一次性 / 单客户 / 高定制多客户 / 平台可复制 / 单位经济弱。

## 2. 三路线机制分支（不得合并写证据）

### 路线 A：标准芯片

```text
产品定义 → 流片/回片 → 客户验证 → design win → 量产份额 → 复购 → 平台代际
```

决胜点：design win 质量、量产份额、平台代际、库存与价格。归零：定点取消、无复购、单位经济恶化。

### 路线 B：IP / EDA

| 子类 | 主线 | 决胜点 |
|---|---|---|
| IP | 可用→评估→导入→授权→客户流片量产→版税→跨节点复用 | 客户芯片量产、版税基数、跨节点复用 |
| EDA | 可用→评估→主流程席位→模块渗透→续费→迁移成本锁定 | 进入主设计流程、席位扩张、续费、迁移成本 |

### 路线 C：定制 ASIC

```text
需求与NRE → 联合设计 → 流片 → 系统验证 → 项目量产 → 代际/多客户复制
```

决胜点：NRE、项目生命周期、客户集中、后续代际复制。归零：单项目结束无复制。

要谈商业模式质量时再读 BF-BM-01 / BF-IC-01。

## 3. 洞见层：领先关系、组合预测与利润池

| 路线×组合 | 更可能路径 | 暂不能说明 |
|---|---|---|
| A：design win↑、量产/复购缺 | 项目锁定未兑现 | 收入规模 |
| A：量产↑、复购与ASP弱 | 出货无质量 | 平台化成功 |
| B：授权/席位↑、客户未量产或续费率低 | 试用导入 | 可持续软件/IP收入 |
| C：NRE强、无二代/多客户 | 单项目工具链 | 可复制平台 |
| 任意：生态强+供应稳+复购 | 平台化放量候选 | 具体利润率（交 EE） |

领先：客户主流程导入、量产装机/续费；滞后：版税基数、跨客户复制。利润池：标准芯片看份额与代际定价权；IP看版税与节点覆盖；EDA看席位与迁移成本；定制看客户黏性与 NRE 摊销。反常：签约金额大但无活跃使用。

最低证据：路线口径；阶段里程碑；客户采用；供应可交付；复购/续费。

## 4. 竞争解释、候选反证与停止条件

| 解释 | 区分预测 | 主要候选反证 |
|---|---|---|
| 主解释：阶段门跨越并持续采用 | 验证→签约→使用→复购依次 | 仅定点/试用 |
| 竞争解释：签约误作规模收入 | 份额/量产/续费不确定 | 可追产出货或续费 |
| 竞争解释：生态或迁移阻断 | 参数过但主流程不采用 | 主流程导入 |
| 竞争解释：单客户不可复制 | 下一客户完整重做 | 跨客户复用 |

路线混用、仅自述、评估与量产不可分时停止。裁决由 04。

## 5. 本框架特有输出

以下为系统登记，研究员可不读。

```yaml
framework_layer: company_realization
output_gate_refs: [IF-DES-01.commercialization_stage, IF-DES-01.commercial_quality, IF-DES-01.realization_readiness]
judgment_types: [state_measurement, mechanism_transmission, object_comparison]
state_variable_candidates: [commercialization_route, development_stage, design_win_or_license, mass_production_or_active_use, repeat_order_or_renewal, royalty_base, seat_penetration, ecosystem_readiness]
signal_candidates: [tapeout, customer_test, design_win, license, shipment, renewal, repeat_order]
output_objects: [commercialization_stage, commercial_quality, realization_readiness, route_specific_gate]
evidence_requirements: [商业化路线, 阶段里程碑, 客户采用, 供应交付, 复购续费]
falsification_conditions: [route_confusion, stage_confusion, no_active_use, no_repeat_or_renewal, poor_unit_economics]
scenarios: [design_win_without_volume, license_without_royalty, repeatable_platform]
```

组合方式见框架库 README「怎样选用」；系统核对见文末登记说明。需要核对进入条件与可写到哪一层时，见根目录依赖说明。

## 6. 组合、裁剪与真实任务验证

- 车规默认：`SCN-AUTO + IF-DES-01`；应用量再加 APP。AI/Fab 问题分别加场景卡或 FAB。财务交 BF-EE-01。
- 需验证芯片量产复购成立案 + design win/授权未兑现失败案；IP/EDA 任务增多后再考虑拆库。`尚待两次真实任务验证`。
