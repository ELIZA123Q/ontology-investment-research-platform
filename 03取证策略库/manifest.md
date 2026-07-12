# 03取证策略库 manifest

> 本文件是系统目录索引，不是研究员操作手册。研究员入口为 [00_研究员取证工作台](00_研究员取证工作台.md)。

更新日期：2026-07-12

## 文件清单

### 根目录

- `README.md`
- `00_研究员取证工作台.md`
- `00_取证策略库总览与调用规则.md`
- `00_能力模型与文件职责矩阵.md`
- `00_strategy_registry.yaml`
- `00_quality_gates.yaml`
- `00_source_registry.yaml`
- `validate_strategies.py`
- `manifest.md`

### C_Evidence_Recipe

- `00_证据配方使用说明.md`
- `01_核心判断证据配方.md`

### A_取证规则

- `A00_取证规则总览.md`
- `A01_事实确认取证规则.md`
- `A02_状态变量测量取证规则.md`
- `A03_趋势与阶段判断取证规则.md`
- `A04_机制传导验证取证规则.md`
- `A05_对象分化比较取证规则.md`
- `A06_财务影响测算取证规则.md`
- `A07_市场预期与定价取证规则.md`
- `A08_反证与竞争解释取证规则.md`
- `A09_代理指标使用规则.md`

### B_取证来源

- `README.md`
- `manifest.md`
- `B00_取证来源总览.md`
- `B01_来源分层与使用边界.md`
- `B02_通用来源清单与证据篮子映射.md`
- `B03_行业专用来源/B03-IND-SEMI_半导体取证来源清单.md`
- `B04_专题来源/B04-TOPIC-GEOPOLITICAL_地缘冲击取证来源清单.md`

### D_研究工作单

- `01_取证任务单.md`
- `02_来源与指标经验卡.md`
- `03_证据冲突处理单.md`
- `04_更新监测与改判表.md`
- `05_研究复盘与框架反馈.md`

## 当前完成状态

- 研究员工作台、A01—A09、B_取证来源、C_证据组合和 D_研究工作单已补齐为可执行版本。
- C 层提供 8 个核心配方和 3 个组合预设，先把 JudgmentUnit 转成证据组合，再进入来源映射。
- SourceProfile、SourceDocument、AcquisitionChannel、AccessScope、ArtifactType 和 ContentDomain 的对象与规则已归入一级通用本体证据域。
- B_取证来源保持“优先来源清单 + 分层使用边界 + 非白名单扩展”的设计，不按行业无限扩张。
- A01—A09 均增加了可复现执行协议、混杂因素与失败模式；C 层 8 个配方均具有完整门槛。
- B 层增加了来源计划、角色适配、独立组、失败回退、行业测量字典和专题事件状态机。
- D 层增加了取证任务、来源/指标经验、冲突处理、更新监测和框架反馈，使单次取证可以沉淀为下一次可复用的研究资产。
- 根注册表新增 Evidence Permission Matrix 与 JudgmentUnit 默认 Recipe 路由；D05 内嵌 Evidence Pattern Case，不扩展 A/B/C/D 文件数量。
