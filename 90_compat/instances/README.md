# 研究样例与本机数据

实际跑出来的研究材料放这里。

| 编号 | 目录 | 说明 |
|------|------|------|
| 00 | [`00_本机运行`](00_本机运行) | 本机数据库、工作台导出；**不进 Git**。正式包在 `formal/`，紧凑投影在 `exports/` |
| 02 | [`02_V3样例`](02_V3样例) | Ontology 3.0 / Public Contract 1.3 **语义黄金样例**（`semantic_fixture`） |
| 03 | [`03_回归`](03_回归) | 从真实工作台链冻结的最小回归夹具；验证运行/导出能力，不作为研究增益结论 |

包类型见 [`05_governance/02_合同/package_kinds.yaml`](../05_governance/02_合同/package_kinds.yaml)：`formal_pack` / `semantic_fixture` / `workbench_export`。

## 存储芯片周期：权威源（勿再复制第三份）

同一课题在仓库里只保留两种包，职责不同，**不是重复数据**：

| 角色 | 路径 | 包类型 | 用途 |
|------|------|--------|------|
| 语义黄金样例 | [`02_V3样例/01_memory-cycle-run-002`](02_V3样例/01_memory-cycle-run-002) | `semantic_fixture` | Ontology / 公共合同字段与阶段语义验收（`validate_v3_samples.py`） |
| 正式包回归 | [`03_回归/02_memory-cycle-formal-pack`](03_回归/02_memory-cycle-formal-pack) | `formal_pack` | 中文正式发布包布局与 `validate_run.py` 黄金回归；Stage05 密度/结构金标也对齐此包 |

根目录旧案例快照 `7:13/`（2026-07-13 存储芯片周期）**已退役删除**。导出文件的中文命名习惯仍可参考该历史布局，但仓库内金标与校验一律以上表两处为准。

## 交付与投影

- **正式交付**：工作台交付台「导出正式发布包」→ `90_compat/instances/00_本机运行/formal/<主题>-<日期>-<序号>/`（中文命名）→ `validate_run.py`
- **内部投影**：`exports/<runId>/` 仍为 `workbench_export`，供回归与调试

当前语义黄金样例（`semantic_fixture`，不是 formal_pack）：

| 样例 | 题目类型 | 入口 |
|------|----------|------|
| [`01_memory-cycle-run-002`](02_V3样例/01_memory-cycle-run-002) | 行业周期判断 | 先看目录内 README |
| [`02_us-controls-localization-run-002`](02_V3样例/02_us-controls-localization-run-002) | 事件影响 / 国产替代 | 先看目录内 README |

建议阅读顺序：05 研报 → 04 判断 → 需要时再翻 02/03 底稿。

旧样例已直接迁移并由上述两个 run-002 取代；仓库不保留 legacy 副本。run-002 是唯一 **semantic_fixture** 验收基线；`03_回归/02_memory-cycle-formal-pack` 是 in-repo **formal_pack** 黄金包。
