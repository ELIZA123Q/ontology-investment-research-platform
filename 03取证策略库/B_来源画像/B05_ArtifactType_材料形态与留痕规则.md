# B05_ArtifactType_材料形态与留痕规则

## 1. 定位

`ArtifactType` 表示本次实际取得的材料形态。它回答：

```text
拿到的到底是什么；
应如何定位、保存、抽取、复核；
不同材料形态有哪些常见质量风险；
如何映射为 SourceDocument、EvidenceClaim 和 EvidenceFact。
```

材料形态不是来源，也不是内容领域。例如 PDF 可以来自公司公告、行业报告或内部文件；API response 可以来自 Wind、内部系统或 MCP connector。

## 2. 标准字段

| 字段 | 说明 |
|---|---|
| `artifact_type_id` | 稳定 ID |
| `artifact_type` | pdf / html / csv / xlsx / api_response / database_field / transcript / image / screenshot / note |
| `raw_artifact_required` | 是否必须保存原始材料 |
| `locator_rule` | 如何定位原文或字段 |
| `extraction_risk` | 抽取风险 |
| `verification_requirement` | 复核要求 |
| `content_hash_required` | 是否必须生成内容指纹 |
| `versioning_rule` | 版本记录规则 |
| `suitable_claim_types` | 适合抽取的主张类型 |
| `not_sufficient_for` | 不足以支持的用途 |

## 3. 主要材料形态

### 3.1 `AT_PDF` PDF / 报告文件

| 项目 | 说明 |
|---|---|
| 常见来源 | 公告、财报、政策原文、行业报告、卖方研报 |
| 必须留痕 | 文件名、标题、发布者、发布时间、页码、表格/段落、版本、hash |
| 抽取风险 | 表格误读、页码错位、扫描件文字错误、引用二手数据 |
| 复核要求 | 关键主张必须回到页码/表格/段落 |

### 3.2 `AT_HTML` 网页

| 项目 | 说明 |
|---|---|
| 常见来源 | 官网、监管网页、新闻、公告页面 |
| 必须留痕 | URL、标题、发布者、发布时间、获取时间、网页快照或 hash |
| 抽取风险 | 页面更新、动态加载、转载、广告和正文混淆 |
| 复核要求 | 重要网页应保存快照或可复核片段 |

### 3.3 `AT_CSV_XLSX` 表格文件

| 项目 | 说明 |
|---|---|
| 常见来源 | 数据库导出、内部系统、手工整理、统计表 |
| 必须留痕 | 文件名、字段名、单位、导出时间、查询条件、来源、版本 |
| 抽取风险 | 字段错位、单位错误、缺失值、重复行、手工修改 |
| 复核要求 | 关键字段必须有字段定义和来源链 |

### 3.4 `AT_API_RESPONSE` API / MCP 响应

| 项目 | 说明 |
|---|---|
| 常见来源 | 授权数据库、行情接口、内部系统、MCP connector |
| 必须留痕 | endpoint/connector、参数、接口版本、响应时间、原始响应或 hash、字段路径 |
| 抽取风险 | 版本变化、分页缺失、字段映射错误、权限过滤 |
| 复核要求 | 必须能复现查询或保留原始响应快照 |

### 3.5 `AT_DATABASE_FIELD` 数据库字段

| 项目 | 说明 |
|---|---|
| 常见来源 | Wind、Bloomberg、内部数仓、业务系统 |
| 必须留痕 | 数据库、表/字段、字段定义、查询条件、数据日期、导出时间 |
| 抽取风险 | 字段定义不清、口径变更、复权方式、样本调整 |
| 复核要求 | 字段说明和查询参数必须进入 acquisition_log |

### 3.6 `AT_TRANSCRIPT` 纪要 / 转录文本

| 项目 | 说明 |
|---|---|
| 常见来源 | 电话会、访谈、调研、内部会议、专家交流 |
| 必须留痕 | 时间、对象类型、记录人、权限、是否逐字、是否整理、业务时间 |
| 抽取风险 | 选择性记录、主观概括、样本偏差、权限限制 |
| 复核要求 | 事实、观点、预测、假设必须分开 |

### 3.7 `AT_IMAGE_SCREENSHOT` 图片 / 截图

| 项目 | 说明 |
|---|---|
| 常见来源 | 网页截图、公告截图、图表截图、系统截图 |
| 必须留痕 | 原始来源、截图时间、页面位置、图表标题、单位、来源注释 |
| 抽取风险 | 图表数值不可精确、截图裁剪、来源缺失 |
| 复核要求 | 不能只凭截图替代原始数据；需尽量回源 |

### 3.8 `AT_MANUAL_NOTE` 人工记录

| 项目 | 说明 |
|---|---|
| 常见来源 | 研究员笔记、调研摘要、判断记录、电话记录 |
| 必须留痕 | 记录人、记录时间、对象、样本、权限、原始表述和整理表述 |
| 抽取风险 | 主观判断混入事实、样本不可复核、记忆偏差 |
| 复核要求 | 只能按 statement_type 拆分，不能直接当事实 |

## 4. ArtifactType 对证据抽取的影响

| 材料形态 | 抽取规则 |
|---|---|
| PDF / HTML | 适合抽取 EvidenceClaim，必须有 locator |
| CSV / XLSX / database_field | 适合形成结构化数值事实，必须有字段定义 |
| API response | 适合机器复核，必须有参数和原始响应 |
| transcript / note | 适合观点、调研线索和主张，需严格区分事实与判断 |
| image / screenshot | 只作辅助，除非能回源和确认图表口径 |

## 5. 质量降级规则

| 问题 | 处理 |
|---|---|
| 无原始材料或 hash | 不得标记 Q4 |
| 无 locator | 不得进入正式 EvidenceClaim |
| 表格字段无定义 | 不得用于数值推理 |
| 截图不可回源 | 只能背景使用 |
| 纪要无样本说明 | 不得支撑行业结论 |
| API 响应无参数 | 不得复现，降级 |
| AI 抽取无回源 | 不得正式使用 |

## 6. 输出到 03 快照

`source_snapshot.csv` 应记录：

```csv
source_id,artifact_type_id,raw_artifact_ref,locator_rule,content_hash,version,access_scope_id
```

`evidence_records.csv` 应记录：

```csv
evidence_id,source_id,artifact_type_id,locator,raw_value,normalized_value,statement_type,business_time,confidence_limit
```

`source_annotation_package.csv` 应把不同材料形态转成 05 可读来源注释，不得让 05 直接引用不可复核截图、AI 摘要或权限不清材料。
