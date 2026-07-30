# B03 MCP通道注册

> MCP、API、数据库终端和 AI 工具是获取通道，不是来源生产者。——03规范 2.5节

## 注册说明

每行注册一个已安装的 MCP 通道，映射到 [B01 通用来源速查](B01_通用来源速查.md) 和 [B02 半导体来源速查](B02_半导体来源速查.md) 中"要找什么"的来源类别。每次 MCP 调用必须按 [03附录2第5节](../../workflow/stages/03_证据/03_附录2_取数留痕与材料处理操作手册.md) 记录留痕。

本注册表由 `~/.workbuddy/mcp.json` 驱动，项目级不存储密钥。MCP 不可用时回退到现有 OPS 手册的 Web 查询路径。

## 通道速查

### 法定披露

| MCP通道 | 类型 | 上游生产者 | 覆盖 B01/B02 来源类别 | 能取到什么 | 不能取到什么 | OPS参考 |
|---------|------|-----------|----------------------|-----------|-------------|---------|
| `cninfo` | stdio/npx | 巨潮资讯网 | A股公司事实与财务、公司财务兑现 | 法定公告列表、定期报告、临时公告、问询函 | 行业数据、市场行情、估值数据 | [QP-MCP-01](OPS_MCP查询快速参考.md) |
| `china-policy` | stdio/npx | 中央政策数据库 | 中国法律、行政法规与产业政策 | 中央政策原文、发文机关、发布日期 | 地方细则、执行评估、产业影响 | [QP-MCP-03](OPS_MCP查询快速参考.md) |

### 金融数据（通联数据 DataYes 全系列）

| MCP通道 | 类型 | 上游生产者 | 覆盖 B01/B02 来源类别 | 能取到什么 | 不能取到什么 | OPS参考 |
|---------|------|-----------|----------------------|-----------|-------------|---------|
| `datayes-stock-info-mcp` | streamablehttp | 通联数据 | A股公司事实与财务 | 公司基本信息、股东概况、机构持仓概况 | 详细财务数据、行情序列 | [QP-MCP-06](OPS_MCP查询快速参考.md) |
| `datayes-stock-finoper-mcp` | streamablehttp | 通联数据 | A股公司事实与财务、公司财务兑现 | 利润表、资产负债表、现金流量表（多期） | 行情数据、公告原文 | [QP-MCP-07](OPS_MCP查询快速参考.md) |
| `datayes-stock-mkt-mcp` | streamablehttp | 通联数据 | 股票、债券和市场行情、市场预期 | A股行情、K线、技术指标、估值指标 | 基本面数据、公告 | [QP-MCP-08](OPS_MCP查询快速参考.md) |
| `datayes-stock-eqhld-mcp` | streamablehttp | 通联数据 | A股公司事实与财务（股东） | 机构持仓明细、股东变动 | 行情、财务报表 | [QP-MCP-09](OPS_MCP查询快速参考.md) |
| `datayes-stock-event-mcp` | streamablehttp | 通联数据 | A股公司事实（事件） | 公司事件摘要、时间线 | 原始公告全文（需 cninfo） | [QP-MCP-10](OPS_MCP查询快速参考.md) |
| `datayes-macro-mcp` | streamablehttp | 通联数据 | 中国宏观与海关、全球宏观、中国产业运行与贸易 | 宏观指标：GDP、CPI、PMI、贸易、工业产出等 | 公司级微观数据、产业细分 | [QP-MCP-11](OPS_MCP查询快速参考.md) |
| `datayes-index-info-mcp` | streamablehttp | 通联数据 | 股票、债券和市场行情 | 指数成分、权重、编制规则 | 行情K线序列 | [QP-MCP-12](OPS_MCP查询快速参考.md) |
| `datayes-index-mktanl-mcp` | streamablehttp | 通联数据 | 股票、债券和市场行情、一致预期和估值 | 指数行情、估值、分析指标 | 成分股个股详情 | [QP-MCP-13](OPS_MCP查询快速参考.md) |
| `datayes-fund-master-mcp` | streamablehttp | 通联数据 | （基金数据辅助） | 基金基本信息、基金经理 | 基金业绩、基金持仓 | [QP-MCP-14](OPS_MCP查询快速参考.md) |
| `datayes-fund-perf-mcp` | streamablehttp | 通联数据 | （基金数据辅助） | 基金净值、业绩指标 | 基金持仓明细 | [QP-MCP-14](OPS_MCP查询快速参考.md) |
| `datayes-fund-holding-mcp` | streamablehttp | 通联数据 | （基金数据辅助） | 基金持仓明细、行业配置 | 基金经理信息 | [QP-MCP-14](OPS_MCP查询快速参考.md) |
| `datayes-fund-fincap-mcp` | streamablehttp | 通联数据 | （基金数据辅助） | 基金财务数据 | 基金业绩指标 | [QP-MCP-14](OPS_MCP查询快速参考.md) |
| `datayes-fund-analytics-mcp` | streamablehttp | 通联数据 | （基金数据辅助） | 基金分析指标 | 原始净值序列 | [QP-MCP-14](OPS_MCP查询快速参考.md) |

### 研报、新闻与网页

| MCP通道 | 类型 | 上游生产者 | 覆盖 B01/B02 来源类别 | 能取到什么 | 不能取到什么 | OPS参考 |
|---------|------|-----------|----------------------|-----------|-------------|---------|
| `htsc_research_mcp` | streamablehttp | 华泰证券研究所 | 一致预期和估值（卖方参考）、专业解释/研究 | 华泰研报原文、行业观点、个股研究、估值模型 | 不能替代法定披露、不能作为独立测量 | [QP-MCP-02](OPS_MCP查询快速参考.md) |
| `caixin-news` | SSE | 财新传媒 | （新闻线索） | 财新新闻原文 | 政策/财务/行业状态唯一证据 | [QP-MCP-04](OPS_MCP查询快速参考.md) |
| `jina-reader` | streamablehttp | —（网页获取工具） | （网页获取/搜索辅助） | 网页原文提取、联网搜索 | 不产生原始内容，不是来源生产者 | [QP-MCP-05](OPS_MCP查询快速参考.md) |

### 工具辅助

| MCP通道 | 类型 | 上游生产者 | 覆盖 B01/B02 来源类别 | 能取到什么 | 不能取到什么 | OPS参考 |
|---------|------|-----------|----------------------|-----------|-------------|---------|
| `paperclip` | stdio/python | Paperclip | （文件处理辅助） | 文件格式处理、转换 | 金融数据 | [QP-MCP-15](OPS_MCP查询快速参考.md) |
| `hermes-docs` | streamablehttp | Hermes | （文档辅助） | 文档检索和管理 | 金融数据 | [QP-MCP-16](OPS_MCP查询快速参考.md) |

## 来源角色对照

每个 MCP 作为获取通道，映射到 [B00 来源角色](B00_来源选择与使用边界.md)：

| MCP通道 | 最适合充当的来源角色 | 不能充当的来源角色 | 说明 |
|---------|--------------------|--------------------|------|
| `cninfo` | **责任主体原文** | 专业直接测量、市场预期 | 公司法定披露原文，一手的责任主体材料 |
| `china-policy` | **责任主体原文** | 产业影响评估 | 中央政策原文，不得由AI解读政策影响 |
| `datayes-stock-finoper-mcp` | **责任主体原文**（结构化财务字段） | 专业解释/研究 | 财务数据字段来自法定披露，但非公告原文 |
| `datayes-stock-mkt-mcp` | **专业直接测量**（行情） | 公司公告、财务事实 | 交易所行情为专业直接测量 |
| `datayes-macro-mcp` | **专业直接测量** | 责任主体原文（政策）、公司层面事实 | 统计局/央行等官方统计 |
| `datayes-stock-info-mcp` | **责任主体原文**（公司基本信息） | 财务细节、行情 | 公司注册/分类信息 |
| `datayes-stock-eqhld-mcp` | **专业直接测量**（持仓） | 行情、财务 | 第三方机构持仓统计 |
| `datayes-stock-event-mcp` | **新闻/公开叙事**（事件摘要） | 法定公告原文 | 事件摘要不等于公告原文 |
| `datayes-index-*-mcp` | **专业直接测量**（指数） | 个股层面判断 | 指数层面的专业测量 |
| `datayes-fund-*-mcp` | **专业直接测量**（基金） | 个股数据、宏观 | 基金层面的专业测量 |
| `htsc_research_mcp` | **专业解释/研究** | 关键硬事实的唯一证据 | 卖方研究，不能替代原始数据 |
| `caixin-news` | **新闻/公开叙事** | 政策/财务/行业状态唯一证据 | 新闻媒体的报道和叙事 |
| `jina-reader` | **搜索/AI摘要**（获取通道） | 任何正式证据 | 纯获取通道，不作任何证据角色 |
| `paperclip` | — | 任何证据角色 | 纯工具 |
| `hermes-docs` | — | 任何证据角色 | 纯工具 |

## MCP 获取留痕要求

依据 [03附录2 第5节](../../workflow/stages/03_证据/03_附录2_取数留痕与材料处理操作手册.md)，每次通过 MCP 获取的材料必须记录：

| 字段 | 内容 | 示例 |
|------|------|------|
| Connector名称 | MCP服务名 | `cninfo`、`datayes-stock-finoper-mcp` |
| 上游来源 | MCP 访问的原始生产者 | 巨潮资讯网、通联数据 |
| 查询参数 | 完整调用参数 | 证券代码、报表期、指标代码、查询条件 |
| 原始响应 | 保存或定位原始 JSON/结构化响应 | 文件路径或内容指纹 |
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
3. 原始响应已冻结并计算内容哈希，`source_quote` 是冻结响应的逐字内容；
4. 能从响应中确定业务时间或发布时间，并通过研究截止时间检查；
5. 来源等级仍按上游生产者判定，不能因为经过 MCP 而升档。

任一条件缺失时，快照保持 `limited` 并登记 gap。`quote_verified` 在该场景表示
“逐字响应已与冻结的结构化快照对齐”，不表示网页原文存在，也不替代字段口径审查。

## 回退规则

MCP 通道不可用时，按以下优先级回退：

```text
MCP通道正常 → 通过MCP获取 → 完整留痕
  ↓ 故障
同源换通道（如通联MCP → 通联Web API）
  ↓ 仍不可用
跨源回退（见对应QP-MCP卡片的回退字段 → 对应OPS通用手册的QP-*条目）
  ↓ 仍不可用
代理指标（A09）+ 完备度降级
```

回退后的证据完备度上限需在每条 EvidenceAssessment 中注明。

## 安装状态

| MCP通道 | 配置位置 | 安装状态 | Runtime worker | 备注 |
|---------|---------|----------|----------------|------|
| `cninfo` | `~/.workbuddy/mcp.json` | ✅ 已安装 | ✅ 已接（`query_cninfo`） | stdio/npx；Stage03 工具链 |
| `china-policy` | `~/.workbuddy/mcp.json` | ✅ 已安装 | ✅ 已接（`query_china_policy`） | stdio/npx；Stage03 工具链 |
| `htsc_research_mcp` | `~/.workbuddy/mcp.json` | ✅ 已安装 | ✅ 已接 | streamablehttp；Stage03 工具链 |
| `caixin-news` | `~/.workbuddy/mcp.json` | ✅ 已安装 | ✅ 已接 | SSE；Stage03 工具链 |
| `jina-reader` | `~/.workbuddy/mcp.json` | ✅ 已安装 | ✅ 已接 | streamablehttp；Stage03 工具链 |
| `datayes-stock-info-mcp` | `~/.workbuddy/mcp.json` | ✅ 已安装 | ✅ 已接 | streamablehttp；Stage03 工具链 |
| `datayes-stock-finoper-mcp` | `~/.workbuddy/mcp.json` | ✅ 已安装 | ✅ 已接（`query_datayes_finoper`） | streamablehttp；Stage03 工具链 |
| `datayes-stock-mkt-mcp` | `~/.workbuddy/mcp.json` | ✅ 已安装 | ✅ 已接 | streamablehttp；Stage03 工具链 |
| `datayes-stock-eqhld-mcp` | `~/.workbuddy/mcp.json` | ✅ 已安装 | ✅ 已接 | streamablehttp；Stage03 工具链 |
| `datayes-stock-event-mcp` | `~/.workbuddy/mcp.json` | ✅ 已安装 | ✅ 已接 | streamablehttp；Stage03 工具链 |
| `datayes-macro-mcp` | `~/.workbuddy/mcp.json` | ✅ 已安装 | ✅ 已接 | streamablehttp；Stage03 工具链 |
| `datayes-index-info-mcp` | `~/.workbuddy/mcp.json` | ✅ 已安装 | ✅ 已接 | streamablehttp；Stage03 工具链 |
| `datayes-index-mktanl-mcp` | `~/.workbuddy/mcp.json` | ✅ 已安装 | ✅ 已接 | streamablehttp；Stage03 工具链 |
| `datayes-fund-master-mcp` | `~/.workbuddy/mcp.json` | ✅ 已安装 | ✅ 已接 | streamablehttp；Stage03 工具链 |
| `datayes-fund-perf-mcp` | `~/.workbuddy/mcp.json` | ✅ 已安装 | ✅ 已接 | streamablehttp；Stage03 工具链 |
| `datayes-fund-holding-mcp` | `~/.workbuddy/mcp.json` | ✅ 已安装 | ✅ 已接 | streamablehttp；Stage03 工具链 |
| `datayes-fund-fincap-mcp` | `~/.workbuddy/mcp.json` | ✅ 已安装 | ✅ 已接 | streamablehttp；Stage03 工具链 |
| `datayes-fund-analytics-mcp` | `~/.workbuddy/mcp.json` | ✅ 已安装 | ✅ 已接 | streamablehttp；Stage03 工具链 |
| `paperclip` | `~/.workbuddy/mcp.json` | ✅ 已安装 | ❌ 未接 | stdio/python；工具辅助 |
| `hermes-docs` | `~/.workbuddy/mcp.json` | ✅ 已安装 | ❌ 未接 | streamablehttp；文档辅助 |

Runtime 适配层：`runtime/adapters/mcp_evidence.ts`（配置路径可用 `MCP_CONFIG_PATH` 覆盖）。18 个证据通道的机器权威清单为 `EVIDENCE_MCP_CHANNELS`；它必须与 `governance/02_合同/ontology_data_mapping_profiles.yaml` 的 `required_connectors` 和 active Profile 一致。MCP 故障时 Stage03 按通道回退提示转向可核验原文或公开网页，并诚实登记 gap。
