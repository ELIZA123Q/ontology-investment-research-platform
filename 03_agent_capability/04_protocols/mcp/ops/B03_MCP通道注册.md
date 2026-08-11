# B03 MCP通道注册

> MCP、API、数据库终端和 AI 工具是获取通道，不是来源生产者。——03规范 2.5节

## 权威来源

**通道的机器可读权威定义为 [`mcp_channels.yaml`](../mcp_channels.yaml)**。
代码（`mcp_registry.ts` 的 `EVIDENCE_MCP_CHANNELS` 和 `CHANNEL_META`）和本文档都从此派生。
新增/移除/修改通道时只改这一个文件。

通道到来源类别的映射见取证方法库 [B01 通用来源速查](../../../02_skills/evidence_research/references/B01_通用来源速查.md) 和 [B02 半导体来源速查](../../../02_skills/evidence_research/references/domains/semiconductor/B02_半导体来源速查.md)。本文件只维护通道本身，不在来源速查表里反向绑定 Tool 名。

## 通道速查（18个证据通道）

| 类别 | 通道 | 传输 | 上游 |
|------|------|------|------|
| 法定披露 | `cninfo` | stdio | 巨潮资讯网 |
| 法定披露 | `china-policy` | stdio | 中央政策数据库 |
| 金融数据 | `datayes-stock-info-mcp` | HTTP | 通联数据 |
| 金融数据 | `datayes-stock-finoper-mcp` | HTTP | 通联数据 |
| 金融数据 | `datayes-stock-mkt-mcp` | HTTP | 通联数据 |
| 金融数据 | `datayes-stock-eqhld-mcp` | HTTP | 通联数据 |
| 金融数据 | `datayes-stock-event-mcp` | HTTP | 通联数据 |
| 金融数据 | `datayes-macro-mcp` | HTTP | 通联数据 |
| 金融数据 | `datayes-index-info-mcp` | HTTP | 通联数据 |
| 金融数据 | `datayes-index-mktanl-mcp` | HTTP | 通联数据 |
| 金融数据 | `datayes-fund-master-mcp` | HTTP | 通联数据 |
| 金融数据 | `datayes-fund-perf-mcp` | HTTP | 通联数据 |
| 金融数据 | `datayes-fund-holding-mcp` | HTTP | 通联数据 |
| 金融数据 | `datayes-fund-fincap-mcp` | HTTP | 通联数据 |
| 金融数据 | `datayes-fund-analytics-mcp` | HTTP | 通联数据 |
| 研报资讯 | `htsc_research_mcp` | HTTP | 华泰证券研究所 |
| 研报资讯 | `caixin-news` | SSE | 财新传媒 |
| 研报资讯 | `jina-reader` | HTTP | —（网页工具） |

完整信息（能取什么、不能取什么、工具名、回退路径、OPS参考）见 [`mcp_channels.yaml`](../mcp_channels.yaml)。

## 来源角色对照

每个 MCP 作为获取通道，映射到 [B00 来源角色](../../../02_skills/evidence_research/references/B00_来源选择与使用边界.md)：

| MCP通道 | 最适合充当的来源角色 | 不能充当的来源角色 |
|---------|--------------------|--------------------|
| `cninfo` | **责任主体原文** | 专业直接测量、市场预期 |
| `china-policy` | **责任主体原文** | 产业影响评估 |
| `datayes-stock-finoper-mcp` | **责任主体原文**（结构化财务字段） | 专业解释/研究 |
| `datayes-stock-mkt-mcp` | **专业直接测量**（行情） | 公司公告、财务事实 |
| `datayes-macro-mcp` | **专业直接测量** | 责任主体原文（政策）、公司层面事实 |
| `datayes-stock-info-mcp` | **责任主体原文**（公司基本信息） | 财务细节、行情 |
| `datayes-stock-eqhld-mcp` | **专业直接测量**（持仓） | 行情、财务 |
| `datayes-stock-event-mcp` | **新闻/公开叙事**（事件摘要） | 法定公告原文 |
| `datayes-index-*-mcp` | **专业直接测量**（指数） | 个股层面判断 |
| `datayes-fund-*-mcp` | **专业直接测量**（基金） | 个股数据、宏观 |
| `htsc_research_mcp` | **专业解释/研究**；行业景气度只作二手测量 | 关键硬事实的唯一证据、法定披露或独立一手测量 |
| `caixin-news` | **新闻/公开叙事** | 政策/财务/行业状态唯一证据 |
| `jina-reader` | **搜索/AI摘要**（获取通道） | 任何正式证据 |

## MCP 获取留痕要求

依据 [03附录2 第5节](../../../02_skills/evidence_research/references/OPS_证据获取留痕手册.md)，每次通过 MCP 获取的材料必须记录：

| 字段 | 内容 | 示例 |
|------|------|------|
| Connector名称 | MCP服务名 | `cninfo`、`datayes-stock-finoper-mcp` |
| 上游来源 | MCP 访问的原始生产者 | 巨潮资讯网、通联数据 |
| 查询参数 | 完整调用参数 | 证券代码、报表期、指标代码、查询条件 |
| 原始响应 | 私密冻结原始 JSON/结构化响应；Artifact、Event、前端和模型只见元数据 | Runtime 私密响应库 + 内容指纹 |
| 字段血缘 | 关键字段到原始响应字段路径的映射 | `revenue` → `response.data.income[0].total_revenue` |
| 权限范围 | 公开/授权/内部 | API 密钥不写入快照，只记访问级别 |
| 回放能力 | 同一参数同一天是否可复现 | `replayable` / `time_sensitive` / `non_replayable` |

缺少以上任一字段时，该 MCP 获取的材料只能作为线索，不得进入关键证据计数。

### 无公开 URL 的结构化响应

结构化数据不强制伪造网页 URL。Runtime 可将单次 MCP 响应冻结为
`mcp://<connector>/<response_fingerprint>` 快照，但只有同时满足以下条件时，
才能与网页逐字引文一样进入证据质量门：

1. Connector 已绑定 active DataMappingProfile；
2. 工具名、完整查询参数、响应指纹和字段血缘齐全；
3. 原始响应已在 `connector_response_blobs` 私密库冻结并计算内容哈希；Artifact、Event、前端和模型不得包含原文，只暴露指纹、许可、字节数、回放属性和风险限制；
4. 能从响应中确定业务时间或发布时间，并通过研究截止时间检查；
5. 来源等级仍按上游生产者判定，不能因为经过 MCP 而升档。

任一条件缺失时，快照保持 `limited` 并登记 gap。`quote_verified` 在该场景表示
"规范化观测已通过字段血缘与私密冻结响应对齐"，不表示网页原文存在，也不授予原始响应的再分发权，更不替代字段口径审查。

## 回退规则

MCP 通道不可用时，按以下优先级回退：

```text
MCP通道正常 → 通过MCP获取 → 完整留痕
  ↓ 故障
同源换通道（如通联MCP → 通联Web API）
  ↓ 仍不可用
跨源回退（见 mcp_channels.yaml 对应通道的 fallback 字段 → 对应OPS手册的QP-*条目）
  ↓ 仍不可用
代理指标（A09）+ 完备度降级
```

回退后的证据完备度上限需在每条 EvidenceAssessment 中注明。

## 安装状态

MCP credentials/config 由 Runtime / Harness 环境提供，项目仓库不保存凭证。
接入状态以 `registry.yaml` 的 `adapter_status` 为准（当前：`htsc_industry_sentiment_mapping_live`）。华泰半导体行业景气度已完成真实 MCP 调用，Runtime 映射仍必须保留授权与风险揭示。

18 个证据通道的机器权威清单为 [`mcp_channels.yaml`](../mcp_channels.yaml)；它必须与 `01_semantic_knowledge/01_ontology/contracts/ontology_data_mapping_profiles.yaml` 的 `required_connectors` 和 active Profile 一致。MCP 故障时，当前 Evidence 节点按通道回退提示转向可核验原文或公开网页，并诚实登记 gap。
