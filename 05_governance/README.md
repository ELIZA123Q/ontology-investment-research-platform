# 治理域

> 还不了解本项目？先读仓库根目录 [新手导读.md](../新手导读.md)。

这里维护「项目边界与质量规则」：做什么、不做什么、跨阶段合同、校验怎么跑、评测与权限如何登记。

日常做研究时，你通常**不必**先读完整本目录。

## 给谁看

- **研究员**：两份高频材料即可（见下）
- **维护者**：架构、合同、校验、路线图、元治理与 Eval

## 材料从哪来

研究员日常优先：

1. [`01_架构/00_项目定位与边界.md`](01_架构/00_项目定位与边界.md) — 做什么、不做什么
2. [`03_校验/00A_高质量产出判别标准.md`](03_校验/00A_高质量产出判别标准.md) — 高质量自检

知识如何从单次研究进入长期资产：

- 人类可读：[`01_架构/03_知识沉淀闭环.md`](01_架构/03_知识沉淀闭环.md)
- 机器合同：[`02_合同/knowledge_learning_contract.yaml`](02_合同/knowledge_learning_contract.yaml)

| 目录 | 白话含义 |
|---|---|
| [`01_架构/`](01_架构/README.md) | 定位、仓库地图、五域权威 |
| [`02_合同/`](02_合同/README.md) | 跨阶段字段、状态、学习闭环等合同 |
| [`03_校验/`](03_校验/README.md) | 校验脚本与判别标准 |
| [`04_路线图/`](04_路线图/README.md) | 工程目标与实施账本（研究员可跳过） |
| [`05_元治理本体/`](05_元治理本体/README.md) | 本体如何演进、如何审批发布 |
| [`14_evals/`](14_evals/README.md) | 评测案例与体验基线 |
| [`11_rules/`](11_rules/README.md) 等壳目录 | 迁移中的治理分层占位 |

## 怎么用

1. 不确定项目边界 → 读「项目定位与边界」。
2. 交稿前自检 → 用「高质量产出判别标准」。
3. 查「权威文件在哪」→ [`01_架构/five_domain_authority.yaml`](01_架构/five_domain_authority.yaml) 与各域 `registry.yaml`。
4. 工程进度与历史决策 → [`04_路线图/`](04_路线图/README.md)（标明可跳过）。

## 怎么维护

- **新合同 / 架构入口**：写入 `01_架构`、`02_合同`、`03_校验` 等现权威目录；旧英文路径仅作兼容桥接，见 [`01_架构/compat_policy.yaml`](01_架构/compat_policy.yaml)。
- 规则归属以 [`02_合同/rule_authority_registry.yaml`](02_合同/rule_authority_registry.yaml) 为唯一登记表。
- 常用校验：

```bash
python3 05_governance/03_校验/validate_project.py
python3 05_governance/03_校验/validate_rule_authority.py
python3 05_governance/03_校验/validate_governance_control_plane.py
```

- 本层不写业务方法正文，也不保存单次研究结论。

---

## 维护者附录（可跳过）

- 域总入口：[`registry.yaml`](registry.yaml)
- 壳目录 `rules/` `identity/` `permissions/` `evals/` `verifiers/` 状态为 migrating（wave4）
- 正式本体约束经 RuleEvaluation；研究方法经 MethodApplication；治理检查不得支撑商业判断
- `governance_control_contract.yaml` 与 `governed_asset_registry.yaml` 可为旧调用方兼容指针
- 本体演进只在 [`05_元治理本体`](05_元治理本体/README.md)，不新增第四个投研业务本体域
