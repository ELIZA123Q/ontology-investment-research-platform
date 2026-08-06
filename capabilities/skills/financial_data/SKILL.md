---
name: financial-data
description: >
  金融数据通道技能集。MCP通道注册与连接管理、
  本体数据映射配置加载、金融数据到本体实例的转换。
metadata:
  category: financial_data
  stage: "03"
  short-description: MCP金融数据通道注册与数据映射
---

# 金融数据通道技能集

## 触发条件

- Stage03 证据准备中需要获取金融数据
- 需要确定某个数据类型应走哪个 MCP 通道
- 需要将金融数据字段映射到本体实例属性
- 关键词：MCP、数据映射、金融数据、通道注册

## 核心原则

**MCP、API、数据库终端和 AI 工具是获取通道，不是来源生产者。——03规范 2.5节**

材料质量由上游来源（巨潮、通联、华泰研究所等）决定。

## 组成文件

| 文件 | 职责 |
|------|------|
| `mcp_registry.ts` | MCP 通道完整注册表：18个已注册通道的连接配置、来源出处、查询参数类型、留痕模板 |
| `data_mapping.ts` | 本体数据映射：从 `ontology_data_mapping_profiles.yaml` 加载数据字段到本体属性的映射配置 |

## 已注册 MCP 通道

| 通道 | 上游来源 | 数据类型 |
|------|---------|---------|
| `cninfo` | 巨潮资讯网 | A股公告、定期报告、问询函 |
| `datayes-stock-finoper-mcp` | 通联数据 | 利润表、资产负债表、现金流量表 |
| `datayes-stock-info-mcp` | 通联数据 | 公司基本信息、股东 |
| `datayes-stock-mkt-mcp` | 通联数据 | A股日/周/月K线、技术指标 |
| `datayes-stock-eqhld-mcp` | 通联数据 | 机构持仓明细 |
| `datayes-stock-event-mcp` | 通联数据 | 公司事件摘要 |
| `datayes-macro-mcp` | 通联数据 | GDP/CPI/PMI/贸易/工业/消费 |
| `datayes-index-info-mcp` | 通联数据 | 指数成分与权重 |
| `datayes-index-mktanl-mcp` | 通联数据 | 指数行情与估值 |
| `datayes-fund-*-mcp` | 通联数据 | 基金信息/业绩/持仓/财务/分析 |
| `china-policy` | 国务院/部委 | 中央政策原文 |
| `htsc_research_mcp` | 华泰证券研究所 | 研报、行业观点 |
| `caixin-news` | 财新 | 财经新闻 |
| `jina-reader` | — | 网页内容提取（回退通道） |

## 使用流程

1. 从 `methods/03_取证/B01_通用来源速查.md` 或 `B02_半导体来源速查.md` 确定要找什么
2. 查 `B03_MCP通道注册.md` 映射到对应 MCP
3. 通过 `mcp_registry.ts` 获取连接配置与查询参数
4. 调用 MCP 获取数据
5. 按 `data_mapping.ts` 映射到本体实例属性
6. 按留痕模板记录

## 引用的参考文件

| 文件 | 用途 |
|------|------|
| `methods/03_取证/B01_通用来源速查.md` | 通用来源→首选来源→MCP通道 |
| `methods/03_取证/B02_半导体来源速查.md` | 半导体专用来源映射 |
| `methods/03_取证/B03_MCP通道注册.md` | MCP通道完整注册 |
| `methods/03_取证/OPS_MCP查询快速参考.md` | MCP操作卡片 |
| `governance/02_合同/ontology_data_mapping_profiles.yaml` | 数据映射配置 |
| `CLAUDE.md` | 可用金融数据通道总览 |

## 输出规范

每次 MCP 调用后必须填写留痕：

```yaml
mcp_call_log:
  connector: ""           # MCP名称
  upstream_source: ""     # 原始生产者
  query_params: {}        # 完整调用参数
  raw_response_ref: ""    # 原始响应保存位置
  field_lineage: {}       # 关键字段→原始响应字段路径
  access_scope: "公开"    # 权限范围
  replay_capable: true    # 是否可复现
  obtained_at: ""         # ISO 8601
```
