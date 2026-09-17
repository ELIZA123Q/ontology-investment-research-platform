# 金融数据源策略变更

生效时间：2026-09-08  
变更授权：用户明确要求不再使用 Wind MCP，并默认采用免费的金融数据 MCP。

## 新默认

- 数据源：`akshare_mcp`
- 上游项目：`https://github.com/xiaozhozho/akshare-mcp`
- 固定提交：`9b6a22b6d83cce2a996a5072743bb06686040ce0`
- 兼容约束：`mcp<2`
- 协议：MCP stdio
- 凭据：默认不需要 API Key
- 权威配置：`研究能力/data_sources.yaml`

规划器会把此数据源写入新的 `PlanProposal` 和 `acquire_evidence` 节点参数。固定提交已完成实际安装和启动测试。原研究 bundle 中此前数据源访问失败的记录属于追加式历史审计，不覆盖、不删除，但不再作为后续运行的默认路径。

正式财务事实仍须回溯到交易所、公司公告或政府来源；MCP 返回数据不自动获得正式事实资格。
