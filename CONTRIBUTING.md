# 参与项目

欢迎改进研究方法、规则和运行实现。请先阅读[目录与权威边界](docs/repository-layout.md)，确认改动应落在方法文档、机器规则、本体还是 Python 实现中；不要在多个目录复制一套相同规则。

提交前请：

1. 说明研究问题、适用边界、反证与预期影响；新增框架或方法时更新相应注册表及引用。
2. 为行为变化补充测试，运行 `uv run --frozen --offline pytest` 和 `uv run --frozen --offline ir-platform validate`。
3. 不提交密钥、个人数据、付费数据原文、未经许可的研报全文或本地运行缓存；新增来源只保留可追溯的引用与必要的短摘要。
4. 区分候选研究判断与正式判断。任何正式发布仍须遵守项目原有的证据上限和人工审批规则。

## Agent 与 Skill

项目只维护一个 Agent 入口：`.agents/agent.yaml`。

所有项目 Skill 必须位于 `.agents/skills/<skill-name>/SKILL.md`，并在 `.agents/agent.yaml` 的 `skills` 与 `workflow.required_skills` 中登记。Skill 不得游离在 Agent 之外。

新增/移除 MCP 数据通道时，同步更新 `.agents/skills/touyan-zhengju-mcp-qudao/SKILL.md` + `methods/03_取证/B03_MCP通道注册.md` + `OPS_MCP查询快速参考.md` + `03_registry.yaml`。

## 必过检查

```bash
uv run --frozen --offline pytest
uv run --frozen --offline ir-platform validate
python3 governance/03_校验/validate_agent_skill_registry.py
```

## 变更边界

- 公共字段、ID、跨阶段引用先改权威合同或规则，再同步实现、校验器和样例。
- 新增正式规则时必须登记唯一权威和执行面；未实现规则不得写成已重算挡门。
- 本地运行缓存、`.runtime/`、`.venv/`、构建产物和 API Key 不得提交。

除非贡献者在提交时明确另作说明，提交到本项目的原创贡献按仓库 [Apache-2.0](LICENSE) 许可处理。第三方内容仍依其原始权利条件处理，不能因进入本仓库而自动改授权。公开分享之前请完成[发布检查](docs/public-release-checklist.md)。
