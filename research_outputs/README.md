# 历史研究运行

本目录保存具体研究的信息截面、计划、证据、推理、报告及运行图，主要用于审阅、追溯和复盘。它与 [examples](../examples/README.md) 的稳定验收样例不同；旧判断不代表当前市场观点。

| 运行 | 状态与阅读入口 |
|---|---|
| [A 股半导体 2026H1](a-share-semiconductor-2026h1/README.md) | 有人工审批和正式报告的历史运行 |
| [A 股创新药短期研究](a-share-innovative-drugs-one-month-2026-09-08/README.md) | 研究草稿与待审批状态的历史运行 |

每个运行目录先读自己的 `README.md`，再按“请求 → 研究设计 → 证据 → 推理 → 报告”查看。`research-bundle.trig` 是可移植图归档；`runtime/` 内的 Oxigraph 和 SQLite 文件是本地运行状态，可能包含机器路径、审计标识或来源记录。公开分发前必须单独复核这些二进制文件，不能因通过文本扫描就认定可公开，见[发布检查](../docs/public-release-checklist.md)。
