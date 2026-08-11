# 半导体领域本体

## 1. 唯一权威

半导体领域采用「正式扩展 + 业务参数 + 方法资产」三层：

- 正式类型、关系、事件扩展和稳定证据约束：[`ontology_extension.yaml`](ontology_extension.yaml)
- 领域参数源文件：[`parameters/`](parameters/)（StateVariable / Evidence / Reasoning / Scenario）
- Runtime 只读汇总 Bundle：[`business_instances.yaml`](business_instances.yaml)（由 `build_business_instances.py` 生成）
- 领域登记：[`domain_registry.yaml`](domain_registry.yaml)
- 取证与裁决方法：[`../../../../03_agent_capability/02_skills`](../../../../03_agent_capability/02_skills/README.md)

研究原则与禁止混用（语义 / 推理 / 证据边界）：[`DOMAIN_GUIDE.md`](DOMAIN_GUIDE.md)

正式扩展依赖五个通用 Model，不能重定义核心 ID；业务参数必须引用正式对象；方法资产不能写回正式本体。场景类型目录属于 [`02_scenario_task/02_scenarios/types.yaml`](../../../../02_scenario_task/02_scenarios/types.yaml)，不是本领域正式 Model dependency。

## 2. 领域边界

纳入半导体设计、设备、材料、晶圆制造、封装测试、技术路线、制造设施、产能、良率、认证导入、供应依赖和政策冲击。显示面板、光伏、PCB 与整机只作为相邻行业或下游应用，不展开其内部完整本体。

具体公司、工厂、型号、实时价格、某期收入、新闻事件、研究判断和买卖建议都是实例或运行产物，不是类型定义。

## 3. 正式新增对象

| 对象 | 核心投影 | 作用 |
|---|---|---|
| `TechnologyRoute` | `Technology` | 制程、器件、封装、互连和系统集成路线 |
| `ManufacturingFacility` | `Asset` | 具有位置、运营主体、能力和生命周期的制造设施 |
| `WaferFab` | 经 `ManufacturingFacility` 投影到 `Asset` | 晶圆制造设施 |
| `ProductionLine` | `Asset`（PART-OF 设施，非 IS-A 设施） | 设施内独立生产单元 |
| `SemiconductorEquipment` | `Product` | 半导体专用设备 |
| `SemiconductorMaterial` | `Material` | 半导体专用材料 |
| `Chip` | `Product` | 芯片产品 |
| `ProcessNode` | `Technology` | 制程代际 |
| `CapacityMetric` | `Metric` | 带尺寸、制程、单位、时间和有效性口径的产能指标 |
| `YieldMetric` | `Metric` | 带产品、批次、时间和合格标准的良率指标 |

`WaferFab` 是设施，不再与 `Company` 混为同一对象；通过 `facilityOperatedBy` 连接运营公司。`ProductionLine` 是设施内生产单元（`facilityContainsLine`），直接投影到 `Asset`，不再 `extends: ManufacturingFacility`。

## 4. 领域能力

正式关系覆盖设施运营与所在地、设施—产线、设施—工艺、设施—产品、设备/材料导入、技术路线依赖与替代、公司下游应用暴露。关系若不能安全映射到核心关系，必须使用 `subproperty_of: null` 并说明独立语义，禁止为了形式完整而使用错误父关系。

事件分类真实扩展 `Event.event_type`，覆盖扩产、投产、认证、出口限制、制裁、供应中断、库存转折、制程切换、国产化份额变化、稼动率和良率异常等。

## 5. 冻结条件

只有同时满足以下条件才视为领域冻结：

1. 正式对象最终可投影到核心对象且继承无环；
2. 子关系端点与核心父关系兼容，独立关系有理由；
3. 事件扩展与 `Event.event_type` 接通且两个事件清单一致；
4. `parameters/*` 源文件与生成 Bundle 的所有 anchor 都能解析到正式对象；
5. 状态变量、传导模板、证据画像、代理指标之间没有悬空引用；
6. 商业化阶段、方法版本和证据约束在三层之间一致；
7. 本体冻结门和参数权威校验均通过。

## 6. 目录结构

```text
domains/semiconductor/
├── README.md                 # 本文件：入口与权威边界
├── DOMAIN_GUIDE.md           # 语义 / 推理 / 证据研究原则
├── domain_registry.yaml      # Domain 机器入口
├── ontology_extension.yaml   # 正式 Object / Relation / Event
├── parameters/               # 人工维护参数源
├── build_business_instances.py
└── business_instances.yaml   # 生成物，勿手改
```
