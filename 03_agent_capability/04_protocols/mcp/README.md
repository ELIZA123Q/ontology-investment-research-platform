# MCP 通道 — 怎么连接外部数据源

> 上级：[`04_protocols/`](../README.md) | 根目录：[`README.md`](../../../README.md)

这里存放 MCP 通道的配置和操作手册。MCP 是连接外部数据源（公告、行情、研报、新闻等）的通道。

> 本目录只回答：**已经决定要从某个渠道获取以后，怎么连过去？**
> 来源路由（找谁、顺序、检索词、核验）见 [`evidence-research` / `source_routes.yaml`](../../02_skills/evidence_research/references/source_routes.yaml)

## 里面有什么

| 文件 | 一句话说明 |
|------|-----------|
| `mcp_channels.yaml` | 通道清单（机器可读） |
| `ops/B03_MCP通道注册.md` | 通道清单与上游来源对照 |
| `ops/OPS_MCP查询快速参考.md` | 操作卡片（怎么查、参数怎么填） |
| `registry.yaml` | 本目录登记 |

## 日常怎么用

1. 用 `evidence-research` 来源速查 / `source_routes` 确定「要找什么」
2. 在 B03 映射到通道名
3. 按 OPS 卡片调用，并按留痕模板记录
4. MCP 不可用 → 走 OPS 回退链；**禁止**用 AI 训练数据编造

> **MCP ≠ 来源生产者。** 返回内容是线索/摘录时，写入正式证据前必须核验可核对原文。

## 接入状态

以 `registry.yaml` 的 `adapter_status` 为准：

| 通道 | 状态 |
|------|------|
| 华泰行业景气度 | 已落地，已取得真实半导体月度样本 |
| DataYes 财务表 | 因积分不足暂不可用 |
| 其他 connector | 完整映射仍在推进 |

## 凭证

MCP credentials/config 由 Runtime / Harness 环境提供，**项目仓库不保存凭证**。

## 怎么维护

- 新增/变更通道：更新 `mcp_channels.yaml`、B03、OPS
- 保持「通道 ≠ 生产者」
- 对应 Tool：`source.query`（动作语义），底层通过 MCP adapter 连接各通道
