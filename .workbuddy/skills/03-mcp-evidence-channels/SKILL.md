---
name: 03-mcp-evidence-channels
description: >
  03阶段取证MCP通道自动选择。当处理投研03取证阶段任务、需要获取
  金融数据、查找公司公告/财务/行情/宏观/政策等材料时自动触发。
  遍历可用MCP工具，匹配正确通道获取数据，按03附录2第5节记录留痕。
  关键词：取证、证据、数据获取、来源查询、证据准备、03阶段
metadata:
  short-description: 03取证MCP通道自动选择与留痕
---

# 03取证MCP通道

## 触发条件

当处理03取证阶段任务且需要获取金融数据时自动触发。自动查阅 `methods/03_取证/B03_MCP通道注册.md` 匹配对应 MCP。

## 核心原则

**MCP、API、数据库终端和 AI 工具是获取通道，不是来源生产者。——03规范 2.5节**

材料质量由上游来源（巨潮、通联、华泰研究所等）决定，MCP调用不影响来源权威性。

## 使用流程

1. 从 `methods/03_取证/B01_通用来源速查.md` 或 `B02_半导体来源速查.md` 确定"要找什么"
2. 查 `methods/03_取证/B03_MCP通道注册.md` 找到对应的 MCP 通道
3. 调用 MCP 获取数据
4. 按 `methods/03_取证/B03_MCP通道注册.md` 中的留痕要求记录
5. MCP 不可用时按 `methods/03_取证/OPS_MCP查询快速参考.md` 的回退链降级

## 通道优先级

| 要找什么 | 优先MCP | 备用MCP |
|---------|---------|---------|
| A股公司公告 | `cninfo` | `datayes-stock-event`（仅摘要） |
| A股财务数据（三表） | `datayes-stock-finoper` | `cninfo`（定期报告原文） |
| A股行情 | `datayes-stock-mkt` | — |
| A股机构持仓 | `datayes-stock-eqhld` | `cninfo`（定期报告） |
| 宏观数据 | `datayes-macro` | Web → OPS 通用手册 |
| 指数行情 | `datayes-index-mktanl` | — |
| 中央政策 | `china-policy` | Web → OPS QP-GEN-01 |
| 华泰研报 | `htsc_research_mcp` | — |
| 网页原文 | `jina-reader` | 浏览器直接访问 |
| 基金数据 | `datayes-fund-*`（按需选） | 基金公司官网 |

## 留痕模板

每次 MCP 调用后立即填写（用于证据归档）：

```yaml
mcp_call_log:
  connector: ""           # MCP名称，如 cninfo
  upstream_source: ""     # 原始生产者，如 巨潮资讯网
  query_params: {}        # 完整调用参数
  raw_response_ref: ""    # 原始响应保存位置或内容指纹
  field_lineage: {}       # 关键字段→原始响应字段路径
  access_scope: ""        # 权限范围（公开/授权）
  replay_capable: true    # 同一参数是否可复现
  obtained_at: ""         # ISO 8601 获取时间
```
