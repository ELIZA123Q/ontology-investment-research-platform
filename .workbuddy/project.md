# 本体约束的投研判断工作台

> **跨工具索引：** 本项目同时支持 Claude Code（`CLAUDE.md`）、Cursor（`.cursor/rules/03-evidence-sources.mdc`）和 WorkBuddy（本文件）。三者内容核心一致，新增 MCP 通道时需同步更新。维护指引见 `CONTRIBUTING.md`。

> **Runtime 集成状态（2026-07-23）：** 18 个 MCP 通道全部接入 runtime 引擎。Stage03 全量生成和自动补证均可调用全部通道。通道注册在 `runtime/adapters/mcp_evidence.ts`（EVIDENCE_MCP_CHANNELS），工具定义和分发在 `runtime/adapters/deepseek.ts`。

## 项目身份

- **名称：** 本体约束的投研判断工作台
- **类型：** 投研判断工作台（本体约束 + 证据计算 + LLM 受约束判断）
- **三层公式：** 可靠判断 = 确定性计算 + 本体语义/约束 + 受约束的开放推理
- **阶段分工：** 02 搭结构，03 备事实与计算，04 做判断；本体贯穿不替代
- **当前焦点领域：** 半导体（存储周期、管制政策与国产设备替代）
- **运行端口：** `http://127.0.0.1:3000`

## 可用数据通道

本项目已配置以下 MCP 金融数据通道（配置于 `~/.workbuddy/mcp.json`）：

> **边界：** `runtime/` Stage03 生成/补证已接入 18 个证据通道，实际清单以 `runtime/adapters/mcp_evidence.ts#EVIDENCE_MCP_CHANNELS` 为准。MCP 是获取通道不是来源生产者，关键事实仍须核验公开原文。

### 法定披露
- **cninfo**：巨潮资讯网——A股公司公告列表、定期报告、临时公告、问询函
- **china-policy**：中央政策原文（国务院、部委文件）

### 金融数据（通联数据 DataYes 全系列）
- **datayes-stock-info-mcp**：公司基本信息、股东
- **datayes-stock-finoper-mcp**：利润表、资产负债表、现金流量表
- **datayes-stock-mkt-mcp**：A股行情、K线、技术指标
- **datayes-stock-eqhld-mcp**：机构持仓明细
- **datayes-stock-event-mcp**：公司事件摘要
- **datayes-macro-mcp**：宏观经济指标（GDP、CPI、PMI、贸易等）
- **datayes-index-info-mcp**：指数成分与权重
- **datayes-index-mktanl-mcp**：指数行情与估值
- **datayes-fund-master-mcp**：基金基本信息
- **datayes-fund-perf-mcp**：基金业绩
- **datayes-fund-holding-mcp**：基金持仓
- **datayes-fund-fincap-mcp**：基金财务
- **datayes-fund-analytics-mcp**：基金分析

### 研报辅助
- **htsc_research_mcp**：华泰证券研究所研报、行业观点、估值模型
- **caixin-news**：财新新闻

### 网页获取
- **jina-reader**：网页内容提取与检索

### 工具辅助
- **paperclip**：文件处理
- **hermes-docs**：文档检索

## 数据使用规则

1. MCP、API、数据库终端和 AI 工具是获取通道，不是来源生产者。——03规范 2.5节
2. 每次 MCP 调用必须记录：Connector名称、上游来源、查询参数、原始响应、字段血缘、权限范围、回放能力
3. 详细 MCP 通道映射见 `methods/03_取证/B03_MCP通道注册.md`
4. 操作参考见 `methods/03_取证/OPS_MCP查询快速参考.md`
5. MCP 不可用时回退到 `methods/03_取证/OPS_*` 手册的 Web 查询路径

## 五阶段研究流程

1. **01 受理** — 明确研究问题与边界
2. **02 结构** — 核心判断、路径、最低验证条件
3. **03 证据** — 取证、留痕、评价证据完备度
4. **04 判断** — 按证据形成裁决结论
5. **05 表达** — 形成最终研报或表达输出

工作规范在 `workflow/stages/` 下，取证方法在 `methods/03_取证/` 下。

## 关键文件索引

| 文件 | 说明 |
|------|------|
| `governance/01_架构/00_项目定位与边界.md` | 项目定位与边界 |
| `methods/03_取证/README.md` | 取证库入口 |
| `methods/03_取证/B03_MCP通道注册.md` | MCP 通道到来源类别的映射 |
| `methods/03_取证/OPS_MCP查询快速参考.md` | MCP 查询操作卡片 |
| `workflow/stages/03_证据/03_数据与证据准备规范.md` | 03阶段主规范 |
| `workflow/stages/03_证据/03_附录2_取数留痕与材料处理操作手册.md` | 取数留痕操作手册 |
| `methods/03_取证/03_registry.yaml` | 取证方法注册中心 |
| `governance/02_合同/public_contract.yaml` | 公共合同 |
