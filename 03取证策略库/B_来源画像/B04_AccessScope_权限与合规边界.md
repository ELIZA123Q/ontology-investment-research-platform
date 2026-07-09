# B04_AccessScope_权限与合规边界

## 1. 定位

`AccessScope` 表示材料或数据的访问权限、使用边界、引用限制和合规要求。它回答：

```text
这份材料能不能使用；
能在什么范围内使用；
能否进入 04 推理和 05 成稿；
是否需要脱敏、降级或阻断。
```

权限边界不是来源权威性。内部数据可能很准，但可能不能写入正式报告；公开新闻可以自由访问，但未必能支持硬事实。

## 2. 标准字段

| 字段 | 说明 |
|---|---|
| `access_scope_id` | 稳定 ID |
| `access_level` | public / licensed / internal / confidential / restricted / unknown |
| `allowed_use` | 允许用途 |
| `forbidden_use` | 禁止用途 |
| `citation_policy` | 能否引用和如何引用 |
| `retention_policy` | 原始材料能否保存 |
| `sharing_boundary` | 能否外部分享或跨团队分享 |
| `redaction_required` | 是否需要脱敏 |
| `approval_required` | 是否需要审批 |
| `quality_effect` | 对证据等级和 04/05 使用的影响 |

## 3. 权限类型

### 3.1 `AS_PUBLIC` 公开可访问

| 项目 | 说明 |
|---|---|
| 示例 | 政策原文、交易所公告、公司官网、公开新闻 |
| 允许用途 | 可进入证据包，按来源质量决定用途 |
| 风险 | 公开不等于权威；网页可能失效；转载可能不独立 |
| 留痕 | URL、快照、发布时间、获取时间、原文位置 |

### 3.2 `AS_LICENSED` 授权使用

| 项目 | 说明 |
|---|---|
| 示例 | Wind、Bloomberg、FactSet、付费行业报告 |
| 允许用途 | 可用于内部分析和合规范围内引用 |
| 风险 | 授权限制、字段不可外传、引用格式限制 |
| 留痕 | 数据库、字段、权限、导出时间、查询参数、引用限制 |

### 3.3 `AS_INTERNAL` 内部可用

| 项目 | 说明 |
|---|---|
| 示例 | 内部数仓、业务系统、内部评审材料、会议纪要 |
| 允许用途 | 内部分析、内部推理输入，视权限决定是否可成稿 |
| 风险 | 数据权限、脱敏、外部表达限制、字段定义不公开 |
| 留痕 | 系统、字段、权限、脱敏规则、使用边界、审批状态 |

### 3.4 `AS_CONFIDENTIAL` 机密或敏感

| 项目 | 说明 |
|---|---|
| 示例 | 客户数据、未公开经营数据、保密访谈、敏感合同 |
| 允许用途 | 仅限授权范围；通常不能进入可外发报告 |
| 风险 | 泄露风险、合规限制、无法引用 |
| 留痕 | 权限审批、脱敏状态、使用目的、访问记录 |

### 3.5 `AS_RESTRICTED` 受限或不可用

| 项目 | 说明 |
|---|---|
| 示例 | 未授权数据库、未知来源文件、敏感凭据、未经许可转载 |
| 允许用途 | 不得进入正式证据包 |
| 风险 | 合规风险 |
| 处理 | 阻断或仅记录为获取失败 |

### 3.6 `AS_UNKNOWN` 权限未知

| 项目 | 说明 |
|---|---|
| 处理 | 不得进入正式证据计数；需补充权限说明 |
| 04 使用 | none 或 background_only |
| 05 使用 | 禁止引用 |

## 4. 权限对 04 和 05 的影响

| 权限状态 | 04 使用 | 05 使用 |
|---|---|---|
| public 且可追溯 | 可按质量等级使用 | 可引用或注释 |
| licensed | 可内部使用 | 按授权限制引用 |
| internal | 可内部推理 | 需判断是否可表达，通常需脱敏 |
| confidential | 仅授权范围内使用 | 通常不得直接成稿 |
| restricted / unknown | 不得使用 | 不得使用 |

## 5. 专项规则

1. 不得把账号、密钥、Cookie、token 或敏感凭据写入运行产物；
2. 内部数据进入证据包前必须说明用途边界；
3. 不能引用的材料可以作为内部推理输入，但 05 必须换成可引用表达或标注来源受限；
4. 权限不清时，宁可降级或阻断，不得默认可用；
5. 授权数据库的字段可以用于内部分析，但外部引用需遵守授权规则。

## 6. 输出到 03 快照

`source_snapshot.csv` 和 `acquisition_log.csv` 必须保留 `access_scope_id`。

`source_annotation_package.csv` 必须说明哪些来源可读、可引用、需脱敏或不可外发。

示例：

```csv
source_id,access_scope_id,allowed_04_use,allowed_05_use,citation_policy,redaction_required
SRC-001,AS_LICENSED,internal_reasoning,summary_only,do_not_republish_raw_field,false
SRC-002,AS_INTERNAL,internal_reasoning,redacted_summary,internal_only,true
```
