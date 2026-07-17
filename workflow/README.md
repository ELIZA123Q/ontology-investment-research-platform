# 1 · 研究流程（01—05）

01—05 是研究阶段的职责边界与质量检查点，**不是**「本体推理链」。真正的裁决发生在 04 与 `runtime/` 面对本次证据时。

一次研究按五个阶段推进。每个阶段目录里有：**规范**（怎么做）、**附录**（细节）、**模板**（直接套用）。

```text
01_受理 → 02_结构 → 03_证据 → 04_判断 → 05_表达
```

| 阶段 | 目录 | 你要回答的问题 | 主要产出 |
|------|------|----------------|----------|
| 01 | [`stages/01_受理`](stages/01_受理) | 要判断什么？能不能做？ | 投研需求说明 |
| 02 | [`stages/02_结构`](stages/02_结构) | 按什么结构分析？ | 研究逻辑 + 本体视图 |
| 03 | [`stages/03_证据`](stages/03_证据) | 证据够不够？ | 证据准备、实例清单、快照 |
| 04 | [`stages/04_判断`](stages/04_判断) | 能说到多强？ | 判断简报 + 推理审计 |
| 05 | [`stages/05_表达`](stages/05_表达) | 怎么写成研报？ | 研报正文 + 表达审计 |

方法正文不在这里：框架在 [`methods/02_判断结构`](../methods/02_判断结构)，取证在 [`methods/03_取证`](../methods/03_取证)，裁决在 [`methods/04_裁决`](../methods/04_裁决)。研报模板在 [`delivery/`](../delivery)。

走完 05 不等于可以正式发布；发布规则见 [`governance/03_校验/00A`](../governance/03_校验/00A_高质量产出判别标准.md)。

## 结构化回放

一次研究运行的真相在结构化产物与 `run_manifest`，不在 Markdown 正文。回放合同见 [`governance/02_合同/public_contract.yaml`](../governance/02_合同/public_contract.yaml) 的 `replay_contract`：

- **最小追溯链**：`Q → JU → ER → EV → MA → C → EX`
- **版本**：`run_manifest.versions` 记录合同、本体、方法库与各阶段 schema 版本
- **方法应用**：02 建 `MA-nn` 候选 → 03 绑定证据 → 04 确认 `executed` / `rejected` / `blocked` / `degraded`
- **规则评价**：04 的 `RuleEvaluation` 记录本次规则执行结果，与设计态 methods/本体规则分开

带完整 `MethodApplication` 的 V3 样例见 [`instances/02_V3样例`](../instances/02_V3样例)；[`instances/01_正式样例`](../instances/01_正式样例) 为历史 fixture，回放以 `business_instance_graph` 中的 `RuleEvaluation` 为主。
