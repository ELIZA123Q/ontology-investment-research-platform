---
framework_id: IF-MAT-01
name: 半导体材料需求、认证与放量框架
library: industry_semiconductor
version: 6.2.0
status: core
framework_type: value_chain_main
validation_status: pending_two_tasks
validated_case_refs: []
updated_at: 2026-07-14
---

# 半导体材料需求、认证与放量框架

## 研究员先看什么：先选材料族，再走认证与放量

```text
净消耗 = 实际产出 × 工艺步骤 × 单位耗用 ×（1－回收率）
再 × 规格适配 × 族特有认证 × 批次稳定 × 合格供应 × 复购复制
```

进入条件：`material_family` = 晶圆衬底外延 | 化学品气体前驱体 | 靶材CMP耗材 | 封装材料。禁止四族共用同一认证周期叙事。负责：净耗用、认证、稳定批量与复制。不负责：capex 推收入、法域判断。

## 1. 适用边界与核心分歧

固定等级、步骤、节点/尺寸、产线、物流与时间。候选：`consumption_demand`；`qualification_stage`；`volume_release_readiness`。

## 2. 四材料族子路径（机制分支）

| 材料族 | 核心机制与决胜点 | 典型失败 |
|---|---|---|
| 晶圆/衬底/外延 | 缺陷、晶体质量、尺寸、客户平台良率 | 尺寸扩产但缺陷不达标 |
| 化学品/气体/前驱体 | 纯度、配方、批次连续供应 | 小批过、连续供应断 |
| 靶材/CMP/工艺耗材 | 工艺窗口、寿命、消耗率、良率影响 | 寿命短抵消份额 |
| 封装材料 | 工艺适配、可靠性、热机械、封装路线认证 | 路线切换整族重认证 |

通用阶段门：净消耗→规格适配→产线认证→批次稳定→合格供应→复购复制；**各门判据按上表换算，不得套用统一周数**。

## 3. 洞见层：领先关系、组合预测与利润池

| 信号组合 | 更可能路径 | 暂不能说明 |
|---|---|---|
| 送样/小批过、批次不稳 | 实验室成功 | 放量 |
| 单线批量、无跨厂、变更控制严 | 客户特定导入 | 行业份额 |
| 净消耗↑、份额不变 | 行业投片驱动 | 替代成功 |
| 复购+跨厂+原料双源 | 高质量放量候选 | 利润率（交 EE） |
| 效率/回收升、步骤增 | 净耗用被抵消 | 材料收入同步增 |

领先：产线批次质量、变更控制；滞后：复购、跨厂、份额。利润池：掌握规格与认证位势的材料；低价抢量常无利润。反常：吨产能新闻多、合格批次交不出。

最低证据：产出与净耗用关系；族对应质量指标；认证层级；批量交付；复购/跨厂；上游原料。

## 4. 竞争解释、候选反证与停止条件

| 解释 | 区分预测 | 主要候选反证 |
|---|---|---|
| 主解释：认证与稳定供应推动放量 | 批量复购跨厂同向 | 仅送样小批 |
| 竞争解释：投片驱动非份额 | 行业耗用增、份额不变 | 同工艺份额升 |
| 竞争解释：批次不稳 | 量产良率/退货恶化 | 多批稳定复购 |
| 竞争解释：上游/物流限制 | 订单在交期恶化 | 双源稳定交付 |

族或等级不清、仅 capex/名义吨产能、认证不可分时停止。裁决由 04。

## 5. 本框架特有输出

以下为系统登记，研究员可不读。

```yaml
framework_layer: company_realization
output_gate_refs: [IF-MAT-01.consumption_demand, IF-MAT-01.qualification_stage, IF-MAT-01.volume_release_readiness]
judgment_types: [state_measurement, mechanism_transmission, object_comparison]
state_variable_candidates: [material_family, wafer_or_package_output, unit_consumption, recovery_rate, qualification_stage, batch_supply, repurchase]
signal_candidates: [sample, pilot_batch, line_qualification, batch_order, repeat_order, cross_fab_copy]
output_objects: [consumption_model, family_specific_gate, volume_release_path]
evidence_requirements: [材料族, 净耗用, 族质量指标, 认证层级, 批量与复购]
falsification_conditions: [family_confusion, sample_only, unstable_quality, no_repeat_order, upstream_constraint]
scenarios: [pilot_without_batch, demand_without_share, repeatable_volume]
```

组合方式见框架库 README「怎样选用」；系统核对见文末登记说明。需要核对进入条件与可写到哪一层时，见根目录依赖说明。

## 6. 组合、裁剪与真实任务验证

- `SCN-LOC-MAT + IF-LOC`；封装材料 + IF-PKG；SiC 按场景卡限定衬底/外延/器件边界。
- 需验证放量成立案 + 送样小批过但批次/复购失败案。`尚待两次真实任务验证`。
