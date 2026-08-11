# 半导体领域本体 — 半导体行业的概念和关系定义

> 上级目录：[`01_ontology/`](../README.md) | 根目录：[`README.md`](../../../../README.md)

这里定义半导体行业专属的概念、关系和事件。好比半导体行业的名词字典——系统在这里认识什么是晶圆厂、什么是制程节点、什么是产能指标。

## 里面有什么

| 文件 | 一句话说明 |
|------|-----------|
| `ontology_extension.yaml` | **正式扩展**：半导体独有的对象类型、关系和事件 |
| `parameters/` | **预置参数**：状态变量、证据画像、传导模板（人工维护） |
| `business_instances.yaml` | **生成 Bundle**：由脚本自动汇总，勿手改 |
| `build_business_instances.py` | **构建脚本**：把参数源编译成 Runtime 只读 Bundle |
| `domain_registry.yaml` | **领域登记**：机器入口 |
| `DOMAIN_GUIDE.md` | **研究原则**：语义/推理/证据边界说明 |

## 三层不要混

| 层 | 是什么 | 在哪 |
|----|--------|------|
| **正式扩展** | 能进类型系统的东西（如 `WaferFab`、`CapacityMetric`） | `ontology_extension.yaml` |
| **领域参数** | 研究中「通常怎么看」的预置知识 | `parameters/` |
| **方法资产** | 怎么取证、怎么裁决 | [`03_agent_capability/02_skills/`](../../../../03_agent_capability/02_skills/README.md) |

> 正式扩展依赖五个通用 Model，不能重定义核心 ID。方法资产不能写回正式本体。

## 领域边界

**纳入**：半导体设计、设备、材料、晶圆制造、封装测试、技术路线、制造设施、产能、良率、认证导入、供应依赖和政策冲击。

**不展开**：显示面板、光伏、PCB 与整机只作为相邻行业或下游应用。

> 具体公司、工厂、型号、实时价格、某期收入、新闻事件、研究判断和买卖建议都是**实例或运行产物**，不是类型定义。

## 怎么维护

1. 改正式类型 → 改 `ontology_extension.yaml`
2. 改预置参数 → 改 `parameters/` 下对应文件
3. 参数改完必须重新生成 Bundle：
   ```bash
   python3 01_semantic_knowledge/01_ontology/domains/semiconductor/build_business_instances.py
   ```
4. 跑本体校验：
   ```bash
   python3 05_control_evaluation/04_verifiers/ontology/validate_ontology.py
   ```

---

## 技术附录（给开发维护者）

### 正式新增对象

| 对象 | 核心投影 | 作用 |
|------|---------|------|
| `TechnologyRoute` | `Technology` | 制程、器件、封装、互连和系统集成路线 |
| `ManufacturingFacility` | `Asset` | 具有位置、运营主体、能力和生命周期的制造设施 |
| `WaferFab` | 经 `ManufacturingFacility` 投影到 `Asset` | 晶圆制造设施 |
| `ProductionLine` | `Asset`（PART-OF 设施） | 设施内独立生产单元 |
| `SemiconductorEquipment` | `Product` | 半导体专用设备 |
| `SemiconductorMaterial` | `Material` | 半导体专用材料 |
| `Chip` | `Product` | 芯片产品 |
| `ProcessNode` | `Technology` | 制程代际 |
| `CapacityMetric` | `Metric` | 带尺寸、制程、单位、时间和有效性口径的产能指标 |
| `YieldMetric` | `Metric` | 带产品、批次、时间和合格标准的良率指标 |

`WaferFab` 是设施，不再与 `Company` 混为同一对象；通过 `facilityOperatedBy` 连接运营公司。`ProductionLine` 是设施内生产单元（`facilityContainsLine`），直接投影到 `Asset`。

### 领域能力

正式关系覆盖设施运营与所在地、设施—产线、设施—工艺、设施—产品、设备/材料导入、技术路线依赖与替代、公司下游应用暴露。关系若不能安全映射到核心关系，必须使用 `subproperty_of: null` 并说明独立语义。

事件分类真实扩展 `Event.event_type`，覆盖扩产、投产、认证、出口限制、制裁、供应中断、库存转折、制程切换、国产化份额变化、稼动率和良率异常等。

### 冻结条件

只有同时满足以下条件才视为领域冻结：

1. 正式对象最终可投影到核心对象且继承无环
2. 子关系端点与核心父关系兼容，独立关系有理由
3. 事件扩展与 `Event.event_type` 接通且两个事件清单一致
4. `parameters/*` 源文件与生成 Bundle 的所有 anchor 都能解析到正式对象
5. 状态变量、传导模板、证据画像、代理指标之间没有悬空引用
6. 商业化阶段、方法版本和证据约束在三层之间一致
7. 本体冻结门和参数权威校验均通过
