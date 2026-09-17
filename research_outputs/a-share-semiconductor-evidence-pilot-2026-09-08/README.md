# A股半导体公开证据调研试点

本目录是通用公开证据调研 Skill 的首个验收运行，信息截面固定为 `2026-09-08T23:59:59+08:00`。它不覆盖 `research_outputs/a-share-semiconductor-2026h1/`中的原报告，也不自行形成行业判断或投资命题。

- `evidence-handoff.yaml`：交给研究总控的机器可读证据包。
- `evidence-package.md`：对调研范围、产业链覆盖、口径和缺口的人工审阅版。
- `query-ledger.yaml`：支持方向和反方向的查询记录、来源选择及停止理由。
- `causal-design.yaml`、`causal-assessment.yaml` 与 `causal-replay.md`：使用同一证据包回放因果门槛；代表公司与行业指标的共变被限制在 `association_only / consistent_only`。

运行校验：

```bash
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python .agents/skills/touyan-gongkai-zhengju-diaoyan/scripts/validate_evidence_handoff.py research_outputs/a-share-semiconductor-evidence-pilot-2026-09-08/evidence-handoff.yaml
```

预期输出为 `status: valid`、`completeness: limited`。降级原因主要是未取得截面日全40只历史生效样本及统一财务聚合，以及SEMI付费细分不可得。
