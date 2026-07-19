# 研究样例与本机数据

实际跑出来的研究材料放这里。

| 编号 | 目录 | 说明 |
|------|------|------|
| 00 | [`00_本机运行`](00_本机运行) | 本机数据库、工作台导出；**不进 Git**。导出为 `workbench_export`，不是正式发布包 |
| 02 | [`02_V3样例`](02_V3样例) | Ontology 3.0 / Public Contract 1.3 **语义黄金样例**（`semantic_fixture`） |

包类型见 [`governance/02_合同/package_kinds.yaml`](../governance/02_合同/package_kinds.yaml)：`formal_pack` / `semantic_fixture` / `workbench_export`。

当前语义黄金样例（`semantic_fixture`，不是 formal_pack）：

| 样例 | 题目类型 | 入口 |
|------|----------|------|
| [`01_memory-cycle-run-002`](02_V3样例/01_memory-cycle-run-002) | 行业周期判断 | 先看目录内 README |
| [`02_us-controls-localization-run-002`](02_V3样例/02_us-controls-localization-run-002) | 事件影响 / 国产替代 | 先看目录内 README |

建议阅读顺序：05 研报 → 04 判断 → 需要时再翻 02/03 底稿。

旧样例已直接迁移并由上述两个 run-002 取代；仓库不保留 legacy 副本。run-002 是唯一 **semantic_fixture** 验收基线；仓库当前不附带 in-repo `formal_pack` 黄金包。
