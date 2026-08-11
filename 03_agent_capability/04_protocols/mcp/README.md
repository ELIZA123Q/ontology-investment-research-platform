# MCP 通道

工作台用来拉取公告、行情、研报、新闻等材料的 **MCP 通道配置与操作手册**。

本目录只回答：**已经决定要从某个渠道获取以后，怎么连过去？**

来源路由（找谁、顺序、检索词、核验）见：
[`evidence-research` / `source_routes.yaml`](../../02_skills/evidence_research/references/source_routes.yaml)

## 给谁看

- **研究员：** 查该用哪条通道、参数怎么填、不可用时如何回退
- **维护者：** 维护通道注册与 OPS 卡片

## 材料从哪来

| 资产 | 作用 |
|---|---|
| [`mcp_channels.yaml`](mcp_channels.yaml) | 机器可读通道清单 |
| [`ops/B03_MCP通道注册.md`](ops/B03_MCP通道注册.md) | 通道清单与上游来源对照 |
| [`ops/OPS_MCP查询快速参考.md`](ops/OPS_MCP查询快速参考.md) | 操作卡片 QP-MCP-* |
| [`registry.yaml`](./registry.yaml) | 本目录登记 |

**MCP ≠ 来源生产者。** 返回内容是线索/摘录时，写入正式证据前必须核验可核对原文。

## 接入状态

以 `registry.yaml` 的 `adapter_status` 为准（当前：`common_contract_ready_connector_planned`）。  
统一结果合同已落地；真实 connector 完整映射仍在推进。

## 凭证

MCP credentials/config 由 Runtime / Harness 环境提供，项目仓库不保存凭证。

## 怎么用

1. 用 `evidence-research` 来源速查 / `source_routes` 确定「要找什么」。
2. 在 B03 映射到通道名。
3. 按 OPS 卡片调用，并按留痕模板记录。
4. MCP 不可用 → 走 OPS 回退链；**禁止**用 AI 训练数据编造。

## Runtime Tool

对应 Tool：`source.query`（动作语义），底层通过 MCP adapter 连接各通道。
