# 校验说明

跨阶段校验工具在这里；各阶段模板在对应 `workflow/stages/*/模板/` 下。

研究员日常用到的：

| 想确认 | 打开或运行 |
|--------|------------|
| 高质量原则与发布规则 | [`00A_高质量产出判别标准.md`](00A_高质量产出判别标准.md) |
| 三库→Runtime 注入覆盖 | [`runtime_asset_coverage.yaml`](runtime_asset_coverage.yaml)（维护 ontology/methods/workflow 时对照；`runtime/tests/runtime_asset_coverage.test.ts`） |
| 正式发布包（中文命名 MD/YAML） | `python3 governance/03_校验/validate_run.py <运行目录>` |
| V3 黄金样例（紧凑 YAML） | `python3 governance/03_校验/validate_v3_samples.py <运行目录>` |
| 工作台导出包 | `python3 governance/03_校验/validate_workbench_package.py <导出目录>` |
| 包类型定义 | [`../02_合同/package_kinds.yaml`](../02_合同/package_kinds.yaml) |
| 全库自检 | `python3 governance/03_校验/validate_project.py` |

三类包不要混用校验入口：`validate_run` 会拒绝 V3/工作台包并提示正确命令。

## 各阶段产出（人看什么）

| 阶段 | 面向研究员 | 结构化文件 |
|------|------------|------------|
| 01 | 投研需求说明 | — |
| 02 | 研究逻辑 | 本体视图 YAML |
| 03 | 数据与证据准备 | 实例清单 + 快照目录 |
| 04 | 判断简报 | 推理审计 YAML |
| 05 | 研报正文 | 表达审计 YAML |

发布闸门另有「独立语义审查」（非研究员交付物）。走完 05 且结构通过，不等于一定 `PUBLISHABLE`。

## 证据闭环与 attempt 归档

新 attempt 不覆盖旧 attempt；历史归档哈希必须可复核。相关校验见 [`requirements_coverage.yaml`](requirements_coverage.yaml) 的 `LOOP-ATTEMPT-001`。

## 03 快照目录长什么样

```text
03-主题数据与证据快照-日期-序号/
├─ manifest.csv
├─ 01_plan/           证据需求、配方、来源画像
├─ 02_assets/         来源与规范化证据链
├─ 03_gate/           各判断证据是否够用
└─ 04_05_materials/   图表、表格、研报素材就绪情况
```

更细的字段、版本与发布双层校验规则，见本目录实现与 [`00A`](00A_高质量产出判别标准.md)。跨阶段 ID 约定以 [`../02_合同/public_contract.yaml`](../02_合同/public_contract.yaml) 为准。
