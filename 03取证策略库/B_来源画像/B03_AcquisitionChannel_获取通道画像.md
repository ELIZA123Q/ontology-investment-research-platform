# B03_AcquisitionChannel_获取通道画像

## 1. 定位

`AcquisitionChannel` 表示数据或材料是通过什么方式取得的。它回答：

```text
本次材料如何取得；
取数过程是否可重复；
查询参数、原始响应、字段血缘能否留痕；
取数方式对证据质量有什么限制。
```

获取通道不是来源。MCP、API、搜索、网页抓取、人工上传都不能替代 SourceProfile。

## 2. 标准字段

| 字段 | 说明 |
|---|---|
| `channel_id` | 稳定 ID |
| `channel_type` | web / database_terminal / api / mcp / file / manual / internal_system / ai_extraction |
| `tool_or_connector_name` | 工具、数据库、连接器或系统名称 |
| `provider` | 工具或系统提供方 |
| `auth_scope` | 权限范围 |
| `input_parameters` | 查询参数要求 |
| `query_reproducibility` | 查询可复现性 |
| `raw_output_retention` | 原始结果保留能力 |
| `field_lineage` | 字段血缘能力 |
| `versioning_support` | 版本保留能力 |
| `failure_modes` | 常见失败方式 |
| `fallback_channel` | 失败时可替代通道 |
| `auditability` | 审计能力 |

## 3. 主要获取通道

### 3.1 `CH_WEB` 官网 / 网页

| 项目 | 说明 |
|---|---|
| 适用 | 政策原文、公告、公司网页、公开报告、新闻线索 |
| 优点 | 可直接定位原文，适合公开材料 |
| 风险 | 页面变更、链接失效、转述页面、抓取不完整 |
| 必须留痕 | URL、标题、发布者、发布时间、获取时间、页码/段落、快照或内容指纹 |
| 降级规则 | 无原文定位则不得进入正式证据 |

### 3.2 `CH_DB_TERMINAL` 数据库终端

| 项目 | 说明 |
|---|---|
| 适用 | Wind、Bloomberg、FactSet、iFinD 等终端查询 |
| 优点 | 字段稳定，适合结构化金融数据 |
| 风险 | 字段定义不清、导出不可复现、权限限制、原始来源链断裂 |
| 必须留痕 | 数据库名称、字段名、查询条件、导出时间、数据截止时点、字段说明 |
| 降级规则 | 字段不可解释或无法复算时，不得用于强判断 |

### 3.3 `CH_API` 授权 API

| 项目 | 说明 |
|---|---|
| 适用 | 行情、财务、宏观、内部系统、结构化数据库 |
| 优点 | 可重复、参数清楚、自动化程度高 |
| 风险 | 接口版本变更、权限过期、字段映射错误、分页或缺失 |
| 必须留痕 | endpoint、参数、接口版本、响应时间、状态码、原始响应或 hash、字段血缘 |
| 降级规则 | 无参数和原始响应留痕，不得标为 Q4 |

### 3.4 `CH_MCP` MCP Connector

| 项目 | 说明 |
|---|---|
| 适用 | 连接授权数据库、文件库、内部系统、API 或网页工具 |
| 优点 | 便于工具化调用、参数留痕、原始输出保存、可审计 |
| 风险 | 容易把 connector 误当来源；底层来源权限和字段定义仍需单独记录 |
| 必须留痕 | connector 名称、底层 SourceProfile、调用参数、响应时间、原始输出或 hash、字段血缘、权限范围 |
| 降级规则 | 未记录底层 SourceProfile 时，MCP 输出不得作为正式证据 |

正确写法：

```text
SourceProfile = Wind
AcquisitionChannel = MCP Connector
ArtifactType = API response
```

错误写法：

```text
SourceProfile = MCP
```

### 3.5 `CH_FILE` 文件上传 / 文件库

| 项目 | 说明 |
|---|---|
| 适用 | PDF、Excel、CSV、PPT、访谈纪要、公告下载件 |
| 优点 | 原始材料可保存，适合复核和引用 |
| 风险 | 文件来源不明、版本混乱、上传时间替代发布时间 |
| 必须留痕 | 文件名、原始发布者、发布时间、上传时间、版本、页码/表格/字段位置 |
| 降级规则 | 文件来源不明则只能候选使用 |

### 3.6 `CH_MANUAL` 人工记录 / 调研

| 项目 | 说明 |
|---|---|
| 适用 | 渠道调研、专家访谈、内部会议纪要、客户反馈 |
| 优点 | 适合边际变化、订单、交期、真实经营感知 |
| 风险 | 样本偏差、不可复核、权限不清、主观表述混入事实 |
| 必须留痕 | 记录人、样本说明、记录时间、业务时间、访谈对象类型、权限边界 |
| 降级规则 | 单一样本不得支撑行业结论 |

### 3.7 `CH_INTERNAL_SYSTEM` 内部系统 / 数仓

| 项目 | 说明 |
|---|---|
| 适用 | 内部经营数据、客户数据、交易数据、业务日志、权限内数据资产 |
| 优点 | 数据粒度高、业务贴近、可追溯系统字段 |
| 风险 | 权限、脱敏、字段定义、对外表达限制、系统口径变化 |
| 必须留痕 | 系统名称、表名/字段、权限、数据日期、脱敏规则、字段定义、导出人或任务 |
| 降级规则 | 权限或用途不清不得进入正式材料 |

### 3.8 `CH_AI_EXTRACTION` AI 辅助抽取

| 项目 | 说明 |
|---|---|
| 适用 | 从长文本、PDF、网页、表格中抽取主张或字段 |
| 优点 | 提升处理效率，适合结构化预处理 |
| 风险 | 幻觉、漏抽、误读表格、无法替代原文 |
| 必须留痕 | 原文位置、模型/工具版本、抽取字段、人工或规则校验状态 |
| 降级规则 | AI 输出不能作为 SourceDocument；必须回源校验 |

## 4. 通道对质量的影响

| 通道问题 | 影响 |
|---|---|
| 无查询参数 | 不可复现，降低 traceability |
| 无原始响应 | 降低 auditability，不得 Q4 |
| 无字段血缘 | 无法确认字段含义，不得强判断 |
| 只保存摘要 | 不能替代原始材料 |
| 无权限说明 | 可能 blocked |
| 通道失败 | 必须记录失败原因和替代通道 |

## 5. 输出到 03 快照

`acquisition_log.csv` 至少记录：

```csv
acquisition_id,requirement_id,source_profile_id,content_domain_id,channel_id,query_parameters,access_scope,artifact_type,result_status,raw_artifact_ref,content_hash,failed_reason,fallback_channel,acquired_at
```

`source_snapshot.csv` 必须将通道与来源拆开，禁止只写“来源=MCP”。
