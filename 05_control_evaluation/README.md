# 控制与评估域 — 什么能做、什么算合格

> 第一次接触项目？先读仓库根目录 [`README.md`](../README.md)。

这里只管「控制面」：系统必须遵守什么规则、动作是谁发起的、谁有权做什么、确定性条件是否满足、研究结果是否有价值。好比投研团队的合规手册和质量评审标准——规则在这里定，检查也在这里跑。

**不存放**项目架构、路线图或跨域合同副本——合同跟随各自的 owner 目录。

## 里面有什么

| 子目录 | 一句话说明 | 你需要管吗 |
|--------|-----------|-----------|
| [`01_rules/`](01_rules/README.md) | **规则**：系统必须遵守什么（策略、阈值、方法路由） | 改规则时看 |
| [`02_identity/`](02_identity/README.md) | **身份**：动作是谁发起的（用户、Agent、系统） | 一般不用管 |
| [`03_permissions/`](03_permissions/README.md) | **权限**：谁可以对什么资源做什么 | 改权限时看 |
| [`04_verifiers/`](04_verifiers/README.md) | **校验器**：确定性条件是否满足（格式、来源、回溯、阈值） | 改检查规则时看 |
| [`05_evals/`](05_evals/README.md) | **评估**：研究结果是否真的有价值 | 改评估标准时看 |

## 日常怎么用

### 日常判断研究质量

先看 [`05_evals/rubrics/research_quality.md`](05_evals/rubrics/research_quality.md)——这是人类可读的研究质量标准，帮你判断研究是否有用。

### 交付前跑校验

```bash
python3 05_control_evaluation/04_verifiers/validate_project.py
```

这是全库一致性检查，确保产物格式合规、来源可回溯、阈值达标。

> **校验器（Verifier）和评估（Eval）不能互相替代**：Verifier 不给洞察打分（只检查格式和合规性），Eval 也不冒充 Schema 校验（只评价研究价值）。

## 怎么维护

- **改规则/阈值/权限**：写在 `01_rules/` 或 `03_permissions/` 对应 YAML 里
- **改校验逻辑**：改 `04_verifiers/` 下的 Python 脚本
- **改评估标准**：改 `05_evals/rubrics/` 下的 Markdown 或 `05_evals/protocols/` 下的 YAML
- 本域**不写**业务方法正文，也**不保存**单次研究结论

## 常见问题

**Q：通过 Verifier 就说明研究结论正确吗？**
A：不是。通过 Verifier 只表示产物格式合规、来源可追溯、阈值达标。研究结论是否有洞察力，需要看 Eval 的评估结果。

**Q：Eval 和正式研究价值评测什么关系？**
A：当前已有 1 个真实 MCP 调用形成的 restraint 候选案例，正式评测案例仍为 0。正式研究价值评测需要满足独立密封裁决、扰动集、模型隔离和同证据基线，不以运行时自检冒充研究质量分数。

**Q：单次任务的检查在哪里跑？**
A：由 `06_runtime` 的 Verifier、Action Service 和测试实现。本层只定义规则和标准。

---

## 技术附录（给开发维护者）

### 校验器入口

`04_verifiers/` 下有 7 个验证器入口，检查 schema/字段/来源/回溯/阈值/发布闸门/可重放性：
- `validate_project.py` — 全库一致性
- `ontology/validate_ontology.py` — 本体一致性
- `knowledge_graph/` — 图合同校验
- `stages/stage_01` — `stage_05` — 阶段校验

### 评估体系

| 项 | 说明 |
|----|------|
| `05_evals/protocols/` | 评测规则、聚合口径、验收手册 |
| `05_evals/rubrics/` | 人类可读研究质量标准 |
| `05_evals/cases/` | 真实冻结案例候选 |
| `05_evals/cases/semiconductor-restraint-2026-08-11/` | 半导体约束案例 |
| `05_evals/cases/a-share-fundamental-v1/` | A 股基本面案例 |
