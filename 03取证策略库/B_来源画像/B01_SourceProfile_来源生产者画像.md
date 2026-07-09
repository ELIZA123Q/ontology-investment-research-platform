# B01_SourceProfile_来源生产者画像

## 1. 定位

`SourceProfile` 表示来源生产者、发布者或数据提供方的画像。它回答：

```text
这份材料或数据是谁生产的？
该来源通常能支持什么类型的主张？
它的默认权威边界在哪里？
它有哪些常见偏差和使用限制？
它是否能作为正式证据来源？
```

`SourceProfile` 不等于具体材料。具体材料在单次运行中登记为 `SourceDocument`。

## 2. 与其他来源维度的区别

| 概念 | 回答的问题 | 示例 |
|---|---|---|
| SourceProfile | 谁生产或发布 | 交易所、上市公司、Wind、TrendForce、内部数仓 |
| ContentDomain | 数据描述什么 | 金融市场、公司财务、行业供需、政策监管 |
| AcquisitionChannel | 怎么取得 | 官网、数据库终端、API、MCP、人工上传 |
| AccessScope | 能不能用 | public、licensed、internal、confidential |
| ArtifactType | 拿到什么形态 | PDF、HTML、CSV、API response、数据库字段 |

错误写法：

```text
SourceProfile = MCP
SourceProfile = 金融市场
SourceProfile = 内部数据
```

正确写法：

```text
SourceProfile = Wind
ContentDomain = 金融市场数据
AcquisitionChannel = MCP Connector
AccessScope = licensed
ArtifactType = API response
```

## 3. SourceProfile 标准字段

建议字段如下：

| 字段 | 说明 |
|---|---|
| `source_profile_id` | 稳定 ID |
| `source_name` | 来源名称 |
| `source_authority_type` | 来源权威类型 |
| `publisher_or_provider` | 发布者或提供方 |
| `default_authority_level` | 默认权威等级 |
| `typical_claim_types` | 通常可支持的主张类型 |
| `allowed_claim_types` | 可正式支持的主张类型 |
| `forbidden_claim_types` | 不得单独支持的主张类型 |
| `best_used_for` | 最适合用途 |
| `not_sufficient_for` | 不足以支持的用途 |
| `methodology_transparency` | 方法论透明度 |
| `update_frequency` | 更新频率 |
| `independence_group` | 独立来源组 |
| `common_bias_or_limit` | 常见偏差或限制 |
| `traceability_requirement` | 留痕要求 |
| `freshness_rule` | 新鲜度规则 |
| `permission_default` | 默认权限类型 |
| `preferred_acquisition_channels` | 常见获取通道 |
| `source_profile_status` | active / deprecated / restricted / candidate |

## 4. 来源权威类型

### 4.1 官方监管与政策来源

```yaml
source_authority_type: official_regulator
default_authority_level: high
best_used_for:
  - 政策事实
  - 监管要求
  - 生效时间
  - 适用范围
not_sufficient_for:
  - 实际产业影响
  - 公司财务影响
  - 市场预期
required_checks:
  - 官方原文定位
  - 修订/失效检查
  - 适用范围确认
```

适用来源示例：政府部门、监管机构、交易所、海关、财政、商务、央行、标准组织、法院或行政处罚机构等。

使用规则：

1. 可作为政策事实的一手证据；
2. 不能直接证明实际经营影响；
3. 必须检查生效时间、适用范围、过渡期、豁免和后续修订；
4. 新闻或研报对政策的转述不能替代官方原文。

### 4.2 交易所与法定披露平台

```yaml
source_authority_type: exchange_or_filing_platform
default_authority_level: high
best_used_for:
  - 上市公司公告
  - 年报/季报/招股书
  - 财务报表来源
  - 重大事项披露
not_sufficient_for:
  - 行业总体结论
  - 未披露经营事实
required_checks:
  - 文件版本
  - 披露日期
  - 报告期
  - 页码/表格/段落定位
```

使用规则：

1. 可作为上市公司正式披露事实的一手来源；
2. 报告期和披露日期必须区分；
3. 公司自身披露不能自动代表行业整体；
4. 问询回复、补充公告可能替代或修正旧公告。

### 4.3 公司正式披露来源

```yaml
source_authority_type: company_disclosure
default_authority_level: high_for_self_disclosure
best_used_for:
  - 公司自身经营事实
  - 管理层指引
  - 产品和项目披露
  - 投资者日材料
not_sufficient_for:
  - 竞争对手事实
  - 行业总体事实
  - 未经审计的市场规模
required_checks:
  - statement_type 分离
  - 管理层观点与事实区分
  - 是否有选择性披露风险
```

使用规则：

1. 公司披露对公司自身事实权威性较高；
2. 管理层指引、目标和判断不能归一为已发生事实；
3. 对行业规模、客户需求、竞争对手情况应寻求独立交叉验证。

### 4.4 授权金融数据库

```yaml
source_authority_type: licensed_financial_database
default_authority_level: medium_high
best_used_for:
  - 市场价格
  - 财务数据
  - 一致预期
  - 估值倍数
  - 交易数据
not_sufficient_for:
  - 未结构化产业机制
  - 未披露订单或客户关系
required_checks:
  - 字段定义
  - 数据来源链
  - 查询参数
  - 数据截止时间
  - 授权边界
```

来源示例：Wind、Bloomberg、FactSet、Capital IQ、Refinitiv、iFinD 等。

使用规则：

1. 结构化金融数据优先使用授权数据库；
2. 必须记录字段名、查询条件、数据截止时点和导出时间；
3. 数据库字段不等于原始披露，关键事实需要追溯原始公告；
4. 一致预期是市场预期证据，不是公司实际经营事实。

### 4.5 行业专业数据库与研究机构

```yaml
source_authority_type: industry_data_provider
default_authority_level: medium_high
best_used_for:
  - 行业价格
  - 出货量
  - 产能
  - 库存
  - 市场份额
  - 供需统计
not_sufficient_for:
  - 单家公司未披露事实
  - 直接投资结论
required_checks:
  - 方法论透明度
  - 统计口径
  - 覆盖范围
  - 更新频率
  - 是否为预测
```

来源示例：SEMI、WSTS、SIA、TrendForce、Omdia、IDC、Gartner、Counterpoint 等。

使用规则：

1. 行业数据库适合行业供需和价格证据；
2. 必须说明统计范围、样本、产品口径和时间频率；
3. 预测、估算和实际统计必须分开；
4. 不同机构数据冲突时，保留冲突并说明方法口径差异。

### 4.6 内部系统与内部数据

```yaml
source_authority_type: internal_system
default_authority_level: depends_on_data_owner
best_used_for:
  - 内部经营数据
  - 客户行为数据
  - 业务流程记录
  - 内部销售或服务记录
not_sufficient_for:
  - 未授权外部表达
  - 未经定义的衍生指标
required_checks:
  - 数据 owner
  - 字段定义
  - 生成系统
  - 权限范围
  - 脱敏要求
  - 可引用边界
```

使用规则：

1. 内部数据可能非常有价值，但权限和表达边界更严格；
2. 必须说明数据 owner、字段定义、导出时间、脱敏状态和使用场景；
3. 不得把内部敏感数据直接写入公开或不匹配权限的 05；
4. 若无法说明字段定义和生成逻辑，只能受限使用。

### 4.7 一手调研与人工记录

```yaml
source_authority_type: primary_research
default_authority_level: medium
best_used_for:
  - 订单边际变化
  - 渠道反馈
  - 交期变化
  - 客户行为线索
  - 产业链短期信号
not_sufficient_for:
  - 全市场统计结论
  - 单独支撑强结论
required_checks:
  - 样本描述
  - 样本偏差
  - 记录时间
  - 业务时间
  - 是否可交叉验证
```

使用规则：

1. 调研适合捕捉边际变化和领先信号；
2. 样本偏差必须说明；
3. 调研主张不能自动扩展到全行业；
4. 关键判断应尽量与公开数据、公司披露或行业数据交叉验证。

### 4.8 卖方研报、专家观点与第三方研究

```yaml
source_authority_type: sellside_or_expert_research
default_authority_level: medium
best_used_for:
  - 市场预期
  - 逻辑线索
  - 竞争解释
  - 估算假设
  - 分歧观点
not_sufficient_for:
  - 已发生事实的唯一证据
  - 公司未披露经营数据
  - 政策事实
required_checks:
  - 原始来源追溯
  - 假设识别
  - 观点/事实分离
  - 是否引用二手数据
```

使用规则：

1. 卖方研报适合作为市场预期和观点分歧材料；
2. 研报引用的事实应尽量回到原始来源；
3. 研报预测不能替代实际观测；
4. 多篇研报引用同一原始来源，不构成独立交叉验证。

### 4.9 新闻媒体与公开网页

```yaml
source_authority_type: news_media
default_authority_level: low_to_medium
best_used_for:
  - 事件线索
  - 公开叙事
  - 市场关注点
  - 初步检索入口
not_sufficient_for:
  - 硬事实唯一证据
  - 政策事实
  - 公司未披露事实
required_checks:
  - 是否转述
  - 是否有原始来源
  - 发布时间
  - 事实/评论分离
```

使用规则：

1. 新闻适合发现线索；
2. 重大事实应回到官方、公司、交易所、监管或原始数据；
3. 同一新闻通稿被多家媒体转载，只算一个来源组；
4. 新闻标题不得替代正文主张。

### 4.10 AI 摘要、搜索结果和模型回答

```yaml
source_authority_type: ai_or_search_output
default_authority_level: not_formal_source
best_used_for:
  - 发现线索
  - 提示检索方向
  - 辅助抽取和归一
not_sufficient_for:
  - 正式证据
  - 事实确认
  - 数值确认
  - 方向性判断
required_checks:
  - 回到原始来源
  - 保存模型抽取说明
  - 关键字段复核
```

使用规则：

1. AI 摘要和搜索结果不是正式证据来源；
2. 任何模型抽取的事实、数值、引用都必须回源；
3. AI 生成内容不得作为 EvidenceFact 的直接支撑。

## 5. SourceProfile 质量评价

每个 SourceProfile 应给出默认质量画像，但最终证据质量仍取决于本次 SourceDocument、EvidenceClaim 和 EvidenceFact。

| 维度 | 说明 |
|---|---|
| 直接性 | 来源是否接近原始事实 |
| 权威性 | 来源在该事实类型下是否有正式发布权 |
| 方法论透明度 | 指标和数据如何产生是否清楚 |
| 独立性 | 是否与其他来源属于同一原始来源组 |
| 时效性 | 更新频率和业务时间是否匹配 |
| 可复核性 | 后续是否能重新读取、查询、定位或复算 |
| 权限合规 | 是否允许在本次场景使用 |
| 偏差风险 | 是否存在选择性披露、立场偏差、样本偏差或预测偏差 |

## 6. SourceProfile 到 SourceDocument 的关系

SourceProfile 是稳定画像；SourceDocument 是单次运行中的具体材料。

```text
SourceProfile: SRC_COMPANY_DISCLOSURE
→ SourceDocument: 某公司 2026 年一季报 PDF
→ EvidenceClaim: 公司披露某产品收入同比增长
→ EvidenceFact: 某产品在 2026Q1 收入同比增长的事实候选
```

SourceProfile 不直接支撑判断，必须通过 SourceDocument、EvidenceClaim 和 EvidenceFact 进入证据链。

## 7. 独立来源组

来源独立性以原始来源组判断，而不是按材料数量判断。

示例：

```text
三篇新闻都转述同一份公司公告，只算一个来源组。
两家数据库都抓取同一交易所公告中的同一字段，不能算作事实交叉验证。
一份公司公告 + 一个独立行业数据库 + 一个客户调研，才可能构成更强交叉验证。
```

## 8. 来源画像示例

```yaml
source_profile_id: SRC_WIND
source_name: Wind
authority_type: licensed_financial_database
default_authority_level: medium_high
best_used_for:
  - 市场数据
  - 财务数据
  - 一致预期
  - 估值
not_sufficient_for:
  - 未披露经营事实
  - 产业机制解释
preferred_acquisition_channels:
  - CH_DB_TERMINAL
  - CH_API
  - CH_MCP
required_trace:
  - field_name
  - query_condition
  - data_cutoff
  - export_time
  - permission_scope
```

```yaml
source_profile_id: SRC_COMPANY_FILINGS
source_name: 交易所公司公告
authority_type: exchange_or_filing_platform
default_authority_level: high
best_used_for:
  - 公司披露事实
  - 财务报表
  - 重大事项
not_sufficient_for:
  - 行业总体判断
preferred_acquisition_channels:
  - CH_WEB
  - CH_DB_TERMINAL
  - CH_MCP
required_trace:
  - title
  - published_at
  - report_period
  - page_or_table_locator
  - file_hash
```

## 9. 一句话原则

> SourceProfile 只说明来源的默认能力和边界；正式证据强度必须由本次具体材料、主张、事实候选、口径、时间和反证检查共同决定。
