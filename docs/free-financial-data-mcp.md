# 免费金融数据 MCP 选型与默认策略

## 默认选择

项目默认金融数据入口为 [`xiaozhozho/akshare-mcp`](https://github.com/xiaozhozho/akshare-mcp)，固定到提交 `9b6a22b6d83cce2a996a5072743bb06686040ce0`，通过 stdio MCP 调用，不要求 API Key。运行合同额外锁定 `mcp<2`，因为该版本使用 MCP Python SDK 1.x 的 `FastMCP` API。

选择原因：

- 覆盖 AKShare 的 1,000 多个接口，并按 A 股行情、A 股基本面、指数、宏观、基金、债券、期货等 13 类工具分组，适合跨行业投研。
- `akshare_stock_fundamental` 覆盖财务报表、预测、股东、分红等基本面接口；`akshare_index` 和 `akshare_stock_board_flow` 可用于行业成分和板块数据。
- 提供 `akshare_discover`，运行时先发现当前 AKShare 方法，减少把上游函数名写死在业务逻辑中的风险。
- 对 DataFrame 截断、NaN/NaT/无穷值、异常和参数合并有独立测试，错误以结构化结果返回。
- Apache-2.0 许可；外部进程运行，不 fork、不复制源码，不让供应商类型进入业务代码。
- 已以固定提交和 `mcp<2` 约束完成实际安装与启动测试。

## 备选比较

| 项目 | 优点 | 本次未选为默认的原因 |
|---|---|---|
| `CharmYue/ashare-mcp` | A 股工具边界和可靠性说明较好 | 当前固定提交的 `pyproject.toml` 无法由 Hatchling 构建，启动测试失败，因此不作为默认 |
| `ccq1/cn-financial-mcp` | 无 Key、42 个 A 股/宏观工具、多公开源降级 | 当前打包后端声明无法通过标准 `uvx` 路径验证，保留为后备观察项 |
| 直接 AKShare | 覆盖面最广、生态成熟 | 不是 MCP；业务代码直接依赖会破坏适配边界 |

## 调用和证据边界

`akshare-mcp` 是发现与取数入口，不是正式事实的最终权威。每条进入正式 `EvidenceFact` 的金融数据仍必须保存：

- 原始数据源或公告机构；
- 可回访 URL；
- 报告期和取得时间；
- 页码、表格或字段定位；
- 指标定义、币种、单位和是否扣非；
- 与冲突数据并存的记录。

软指标不得直接提高判断等级；数据源不可用时生成 `EvidenceGap`，然后依次回退到交易所/公司公告、政府监管来源、公司投资者关系页面和其他公开网页。

## 运行方式

权威配置位于 `研究能力/data_sources.yaml`。规划器会把 `akshare_mcp` 和固定 revision 写进 `PlanProposal` 与所有 `acquire_evidence` 节点参数。

默认 stdio 命令等价于：

```bash
uvx --from git+https://github.com/xiaozhozho/akshare-mcp.git@9b6a22b6d83cce2a996a5072743bb06686040ce0 --with 'mcp<2' akshare-mcp
```

离线 CI 不启动外部 MCP；它只验证注册表、固定 revision、规划注入和禁止数据源规则。联网取数属于运行时能力，原始结果和错误必须写入研究 bundle。
