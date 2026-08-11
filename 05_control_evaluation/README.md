# Control & Evaluation

`05_control_evaluation` 只定义控制面：什么必须遵守、谁发起动作、谁能执行动作、确定性条件是否满足，以及结果是否有研究价值。

它不存放项目架构、路线图或跨域合同的汇总副本；合同跟随真正的 owner。

| 子域 | 回答的问题 | 入口 |
|---|---|---|
| Rules | 系统必须遵守什么规则？ | [`01_rules/`](01_rules/README.md) |
| Identity | 动作是谁发起的？ | [`02_identity/`](02_identity/README.md) |
| Permissions | 谁可以对什么资源做什么？ | [`03_permissions/`](03_permissions/README.md) |
| Verifiers | 确定性条件是否满足？ | [`04_verifiers/`](04_verifiers/README.md) |
| Evals | 结果是否真的有价值？ | [`05_evals/`](05_evals/README.md) |

研究员日常先用 [`05_evals/rubrics/research_quality.md`](05_evals/rubrics/research_quality.md) 判断研究是否有用；交付前再运行 Verifier。两者不可互相替代：**Verifier 不给洞察打分，Eval 也不冒充 schema 校验。**

常用命令：

```bash
python3 05_control_evaluation/04_verifiers/validate_project.py
```

单次任务的确定性检查由 vNext Runtime 的 Verifier、Action Service 与测试实现。本层不写业务方法正文，也不保存单次研究结论。
