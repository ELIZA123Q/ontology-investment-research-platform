---
framework_id: IF-EDAIP-01
name: EDA、IP与设计服务生态框架
library: industry_semiconductor
version: 1.0.0
builds_on: [BF-BM-01, BF-IC-01, BF-EE-01]
---

# EDA、IP与设计服务生态框架

## 1. 适用问题与边界

用于 EDA 工具、半导体 IP、设计服务、验证平台和流片服务的技术覆盖、生态、商业化、替代和收入质量研究。必须按设计流程、芯片类型、工艺节点、foundry认证和客户项目拆分；软件安装、采购合同和项目实际使用不能混写。

## 2. 核心判断任务与关键口径

- EDA按前端设计、验证、物理实现、签核、制造/封装协同等流程覆盖。
- IP按处理器、接口、存储、模拟、互连和基础单元等类型及工艺认证拆分。
- 商业化区分试用、采购、生产项目使用、流片、复购和企业级扩张。
- 收入区分许可、订阅、版税、服务和一次性定制，并检查递延与现金。

## 3. 核心问题树

1. 产品覆盖设计流程中的哪个环节，能否形成闭环？
2. 支持哪些芯片类型、节点、PDK、foundry和封装路线？
3. 精度、容量、性能、易用性和互操作是否达到生产要求？
4. 客户是试用、采购还是用于真实量产项目？
5. 工具/IP切换成本、数据格式、人才和生态壁垒多高？
6. 授权、订阅、版税和服务如何形成收入与现金？
7. 国产替代是否从点工具扩展到流程、项目和企业级部署？

## 4. 分析模块与传导机制

| 模块 | 源变量 → 目标变量 | 方向/非线性 | 信号 | 窗口 | 失效边界 |
|---|---|---|---|---|---|
| EDA-M1 流程覆盖 | 工具能力 → 可服务流程 | 单点工具不等于全流程 | 版本/适配领先 | 多年 | 功能列表替代生产使用 |
| EDA-M2 工艺认证 | PDK/foundry → `technology_competitiveness` | 签核类要求阈值高 | 认证领先、流片滞后 | 两至十季度 | 合作协议等同认证 |
| EDA-M3 项目采用 | 试用/采购 → `adoption_penetration` | 生产项目跨越关键阈值 | 项目使用领先、复购滞后 | 一至八季度 | license数等同活跃使用 |
| EDA-M4 生态切换 | 数据/人才/流程 → `customer_switching_cost` | 网络与锁定效应 | 培训/迁移领先 | 一至四年 | 政策意愿等同切换 |
| EDA-M5 商业模式 | 许可/版税/服务 → 收入质量 | 版税随客户出货波动 | backlog领先、现金滞后 | 一至八季度 | 合同额等同经常性收入 |
| EDA-M6 本地替代 | 覆盖/认证/采用 → `localization_substitution_progress` | 点替代到流程替代非线性 | 多项目复购滞后 | 一至三年 | 单项目外推行业份额 |

## 5. 最低证据与交叉验证

- 工具/IP功能、节点/PDK/foundry认证、真实生产项目、流片结果和客户复购。
- 客户采用至少区分测试授权与活跃生产使用，最好有客户侧或项目侧交叉。
- 收入按许可/订阅/版税/服务拆分，核对递延收入、应收和经营现金。
- 替代判断覆盖互操作、数据迁移、人才、技术支持和长期维护。

## 6. 竞争解释、阻断与停止条件

竞争解释包括采购后低使用率、政策性试用、单点工具仍依赖海外主流程、IP一次性授权、客户流片失败、人才与生态不足。没有生产项目/流片证据时停止“可替代”结论；合同结构不可辨时不判断经常性收入。

## 7. 情景设置

- **点工具突破**：特定流程生产可用，生态范围有限。
- **流程扩张**：多工具互操作和多项目复购形成平台能力。
- **IP放量**：认证、设计导入、客户芯片出货带动版税。
- **采购低用**：合同增长但活跃项目、复购和现金偏弱。
- **生态阻断**：PDK、foundry、格式、人才或支持限制替代。

## 8. 本体映射

**一级正式本体**：`Product`、`Company`、`ProcessStep`、`Application`、`Event`、`Observation`、`Signal`、`Judgment`。

**领域扩展可选项**：`TechnologyRoute`、`eda_and_ip`、`eda_provider`、`ip_provider`、`design_service_provider`；变量 `technology_competitiveness`、`adoption_penetration`、`customer_switching_cost`、`design_win_visibility`、`localization_substitution_progress`；模板 `competitiveness_to_substitution`、`design_win_to_order_pipeline`、`localization_to_resilience`。

**任务候选或本体缺口**：流程覆盖率、生产项目数、活跃席位、PDK覆盖、版税基数和工具互操作性作为任务观测。

## 9. 组合与裁剪

- 芯片设计项目接 IF-DES-01；先进工艺协同接 IF-APC-01。
- 国产化接 IF-LOC-01；商业模式和收入质量接 BF-BM-01/BF-FQ-01。
- IP研究可裁掉全流程EDA，但必须保留工艺认证、设计导入和客户出货。

## 10. 权威依据卡

| 项目 | 内容 |
|---|---|
| 主要来源 | [全国集成电路标准化技术委员会](https://www.samr.gov.cn/bzjss/sjdt/gzdt/art/2022/art_11b126af4ed64a5893d31ce37b591363.html)；[CSIA设计分会](https://web.csia.net.cn/jcdlsjfh)；[CSIA开放服务平台](https://web.csia.net.cn/xhkfptjj)；[SEMI电子设计市场](https://www.semi.org/en/products-services/market-intelligence) |
| 采用内容 | EDA/IP国家标准范围、中国设计公共服务、MPW验证和电子设计生态分类 |
| 本地化改写 | 建立采购—生产使用—流片—复购，以及点工具—流程—企业级替代阶梯 |
| 未采用内容 | 不以采购金额、授权数量或政策目标直接代表实际使用率 |
| 证据等级 | 多来源方法论候选；访问核验日 2026-07-03 |

## 11. 框架自检

- [ ] EDA按设计流程、IP按类型和工艺认证拆分。
- [ ] 试用、采购、生产使用、流片和复购已区分。
- [ ] PDK、foundry和互操作生态已检查。
- [ ] 授权、订阅、版税和服务收入已分开。
- [ ] 点工具替代没有外推为全流程替代。
