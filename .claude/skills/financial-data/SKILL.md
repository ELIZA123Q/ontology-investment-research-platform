---
name: financial-data
description: >-
  金融数据MCP通道管理与数据映射。确定数据类型→匹配MCP通道→获取数据→
  映射到本体实例属性。覆盖A股公告、财务三表、行情、机构持仓、宏观、
  指数、基金、政策、研报、新闻。
  Use when user asks to "取数据" "查财报" "查行情" "MCP通道"
  "数据映射" or mentions 金融数据, cninfo, datayes, Wind.
allowed-tools: Read, Bash
---

# 金融数据通道

## 触发条件

- Stage03 需要获取金融数据
- 需要确定某个数据类型应走哪个 MCP 通道
- 需要将金融数据字段映射到本体实例属性

## 通道速查

| 要找什么 | 优先MCP | 上游来源 |
|---------|---------|---------|
| A股公司公告 | `cninfo` | 巨潮资讯网 |
| A股财务数据（三表） | `datayes-stock-finoper` | 通联数据 |
| A股行情 | `datayes-stock-mkt` | 通联数据 |
| A股机构持仓 | `datayes-stock-eqhld` | 通联数据 |
| 宏观数据 | `datayes-macro` | 通联数据 |
| 指数行情 | `datayes-index-mktanl` | 通联数据 |
| 中央政策 | `china-policy` | 国务院/部委 |
| 华泰研报 | `htsc_research_mcp` | 华泰证券研究所 |
| 财经新闻 | `caixin-news` | 财新 |
| 网页原文 | `jina-reader` | —（回退通道） |
| 基金数据 | `datayes-fund-*` | 通联数据 |

## 使用流程

1. 确定要找什么：读取 `methods/03_取证/B01_通用来源速查.md`
2. 映射到 MCP：读取 `methods/03_取证/B03_MCP通道注册.md`
3. 获取操作参数：读取 `methods/03_取证/OPS_MCP查询快速参考.md`
4. 调用 MCP 获取数据
5. 映射到本体属性：读取 `governance/02_合同/ontology_data_mapping_profiles.yaml`
6. 按留痕模板记录

## 核心约束

- **MCP、API 是获取通道，不是来源生产者**（03规范 2.5节）
- MCP 不可用时：按 `OPS_MCP查询快速参考.md` 回退链 → `OPS_通用真实来源查询与回退手册.md` Web 路径

## 知识库引用（不复制，直接读取）

| 需要什么 | 读取位置 |
|---------|---------|
| 通用来源速查 | `methods/03_取证/B01_通用来源速查.md` |
| 半导体来源速查 | `methods/03_取证/B02_半导体来源速查.md` |
| MCP通道注册 | `methods/03_取证/B03_MCP通道注册.md` |
| MCP操作参数 | `methods/03_取证/OPS_MCP查询快速参考.md` |
| Web回退路径 | `methods/03_取证/OPS_通用真实来源查询与回退手册.md` |
| 数据映射配置 | `governance/02_合同/ontology_data_mapping_profiles.yaml` |
| 可用通道总览 | `CLAUDE.md` |
| 实现代码 | `runtime/skills/financial_data/` |
