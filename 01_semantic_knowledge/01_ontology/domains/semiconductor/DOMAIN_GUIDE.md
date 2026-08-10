# 半导体领域研究原则

本文件只保留 YAML 不容易表达、但对研究至关重要的边界原则。机器权威仍在：

- 正式类型 / 关系 / 事件：`ontology_extension.yaml`
- 状态变量与领域知识：`parameters/*` → 生成 `business_instances.yaml`

---

## 一、语义边界

### 对象身份

领域实例必须保留稳定 ID、名称、别名和生命周期。同一设施更换运营主体时保留设施身份，通过有时间有效期的运营关系变化，不新建「同名公司式工厂」。

设施、公司、产品和状态严格分离：

- 公司 ≠ 制造设施 ≠ 产线
- 设备、材料和芯片是产品类型；产能、良率是指标，不是产品属性文本
- 制程节点和技术路线是稳定技术；成熟度、渗透率和替代进展是状态变量
- 扩产、投产、认证通过是事件，不是稳定关系

### 关键属性口径

- `ManufacturingFacility` 必须有设施类别、地区和生命周期阶段。
- `WaferFab` 记录晶圆尺寸与可支持制程节点，不把名义产能写入身份属性。
- `CapacityMetric` 必须冻结单位、时间口径、晶圆尺寸、制程或产品范围，以及名义/有效/认证/可用口径。
- `YieldMetric` 必须冻结产品、制程、样品/试产/量产批次和时间口径。
- `TechnologyRoute` 必须说明路线类别；替代关系必须填写适用范围。

### 禁止用法

- 不把晶圆厂同时建成 `Company` 和 `WaferFab` 而不建立运营关系。
- 不把扩产公告写成有效产能已经增加。
- 不把送样、认证、定点、试产、量产和复购混成一个「已导入」状态。
- 不把工艺路线替代直接等同于商业份额替代。
- 不用整条产业链关系代替具体设施、产品、时间和口径。

---

## 二、推理边界

### 状态变量与事件

状态变量是稳定「观察什么」的定义，不是某次观测值。任务中的具体读数进入 `Observation`；状态更新形成 `StateChange`，并使相关 EvidenceAssessment、EvidenceBasket、RuleEvaluation 和 Judgment 失效或重算。

半导体事件类型由 `ontology_extension.yaml` 的 `event_taxonomy` 扩展 `Event.event_type`。公告扩产不等于产能状态已经变化；只有设备搬入、试产、认证、良率和有效产出等观测才能更新产能或量产状态。

### PropagationTemplate

`PropagationTemplate` 只是候选路径，不是已执行推理，也不能直接形成 Judgment。

一次研究必须经过：

```text
ResearchQuestion → JudgmentUnit → StateVariable / Event
→ EvidenceRequirement → EvidenceFact / Observation
→ Signal → Hypothesis + CompetingExplanation / BlockingFactor
→ RuleEvaluation + MethodApplication → Judgment → ReasoningTrace
```

传导模板只能帮助建路径、取证、检查中间节点；任何未被证据接通的节点都必须停止向下游外推。

### 商业化阶段

设备、材料和产品导入统一使用九阶段：概念、样品、客户评估、认证、定点、试产、量产、复购、规模采用。

判断强度不得超过证据已确认阶段：

```text
送样 ≠ 认证
认证 ≠ 量产
量产 ≠ 规模采用
```

送样不能支持量产；认证通过不能自动支持收入确认；单次采购不能自动支持规模采用。

### 更新与失效

新证据先更新 EvidenceFact/Assessment，再更新 Observation 或 Signal；只有受正式关系图影响的下游对象进入 stale。若出现新对象、新关系或新判断路径，返回结构阶段；仅新增既有路径证据时，从取证开始局部重算。

---

## 三、证据边界

### 证据链

半导体证据复用通用 `SourceDocument → EvidenceClaim → EvidenceFact → EvidenceAssessment / EvidenceBasket`。证据事实只能支撑 Observation、Event、Signal、Hypothesis 或 JudgmentUnit 的输入，不得绕过信号和假设直接生成最终 Judgment。

EvidenceProfile 是取证配置，不是证据本身。

### 三条领域稳定约束

1. `semiconductor_proxy_disclosure`：代理指标必须披露滞后、适用范围和不可替代的直接证据。
2. `semiconductor_qualification_stage_alignment`：商业化阶段、产品规格、客户和设施范围必须一致。
3. `semiconductor_capacity_yield_scope_alignment`：产能和良率必须对齐设施、尺寸、制程/产品、批次、单位和业务时间。

这些是稳定证据约束；具体取证步骤仍由方法库决定。

### 代理指标局限

| 代理 | 目标状态 | 主要限制 |
|---|---|---|
| 现货/合约价格 | 库存周期位置 | 会受停产、成本、汇率和投机影响 |
| 设备或产品交期 | 产能紧张度 | 会受物流、报价策略和产品切换影响 |
| 招标、中标 | 国产替代进展 | 入围和中标 ≠ 验收、复购或收入 |
| 贸易流量 | 区域供给可得性 | 编码、转口、库存和产品组合会扭曲 |
| 晶圆厂稼动率 | 终端需求强度 | 会受检修、爬坡、良率和提前备货影响 |

每个 ProxyIndicator 必须记录 `expectedTimeLag`、有效条件、失效条件、置信折扣、不可替代材料和披露要求。

### 时间与范围

- 政策证据区分发布、正式生效和执法执行时间。
- 扩产证据区分公告、建设、设备搬入、试产、认证和有效产出：公告扩产 ≠ 有效产能提升。
- 认证证据区分样品、规格、客户、设施、量产批次和复购。
- 订单、交期和价格通常领先收入；财务数据通常滞后经营状态。
- 代理指标的领先/滞后方向不能跨周期固定使用，必须在本次 Assessment 中重新确认。

### 冲突与降级

来源数量不能替代独立性。多个转载同一公告只算一个原始来源。冲突证据必须保留并指向同一目标问题，不得被多数来源覆盖；无法解释时，状态为 contested 或降级。决定性反证命中关键前提时，相关路径和判断进入 blocked/invalidated，不得通过增加一般性支持材料抵消。
