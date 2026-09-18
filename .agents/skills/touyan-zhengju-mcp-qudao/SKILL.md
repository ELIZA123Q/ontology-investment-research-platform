---
name: touyan-zhengju-mcp-qudao
description: 为 03 取证阶段选择金融数据与 MCP 通道并记录来源留痕；只处理证据获取，不裁决判断或撰写报告。
---

# 证据 MCP 通道

## 职责边界

本 Skill 只服务项目 `03` 取证阶段：确定要找的材料、选择 MCP 或回退通道、记录来源与字段血缘。它不负责判断结论强弱、不写战略建议、不替代 `04` 裁决或 `05` 表达。

MCP、API、数据库终端和 AI 工具只是获取通道，不是来源生产者。证据质量由原始来源决定；调用结果必须能回到公告、财报、交易所、统计机构、研究所或其他可核验原文。

## 使用流程

1. 先从 `methods/03_取证/B01_通用来源速查.md` 或 `methods/03_取证/B02_半导体来源速查.md` 明确材料类型和权威来源。
2. 再读 `methods/03_取证/B03_MCP通道注册.md`，选择与材料类型匹配的 MCP。
3. 获取数据后，按 `workflow/stages/03_证据/03_附录2_取数留痕与材料处理操作手册.md` 记录调用参数、来源、字段血缘和可复现性。
4. MCP 不可用时，按 `methods/03_取证/OPS_MCP查询快速参考.md` 的回退链使用公开网页或人工核验路径。
5. 只把证据状态交给后续阶段；不得把“已取到数据”写成“已经证明判断”。

## 通道选择

| 材料类型 | 首选通道 | 回退 |
|---|---|---|
| A 股公告 | 巨潮或公告 MCP | 交易所/公司官网原文 |
| A 股财务三表 | datayes-stock-finoper | 定期报告原文 |
| A 股行情与估值 | datayes-stock-mkt | 交易所或行情公开页 |
| 股东、质押、机构持仓 | datayes-stock-eqhld | 定期报告原文 |
| 宏观指标 | datayes-macro | 统计机构原文 |
| 指数行情 | datayes-index-mktanl | 指数公司或交易所原文 |
| 基金数据 | datayes-fund-* | 基金公司或托管报告 |
| 政策材料 | 政策 MCP 或官方网页 | 官方发布页 |
| 研究报告 | htsc_research_mcp | 研报原文 |
| 网页原文 | jina-reader 或浏览器 | 直接访问原页 |

## 留痕字段

每次取证至少记录：

```yaml
mcp_call_log:
  connector: ""
  upstream_source: ""
  query_params: {}
  raw_response_ref: ""
  field_lineage: {}
  access_scope: ""
  replay_capable: true
  obtained_at: ""
```
