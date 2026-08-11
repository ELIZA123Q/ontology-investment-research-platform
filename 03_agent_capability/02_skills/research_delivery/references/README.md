# 交付资源 — 表达标准与交付模板

> 上级：[`research-delivery` Skill](../SKILL.md) | 根目录：[`README.md`](../../../../README.md)

这是 `research-delivery` Skill 的表达标准入口。交付形态不止「写文章」，还可包括快答、判断卡、图表、过程视图与执行包。

> 上游事实与判断必须来自 `evidence-research`/`judgment-reasoning`；本 Skill **不生产新证据**。

## 里面有什么

| 位置 | 内容 |
|------|------|
| [`standards/`](standards/README.md) | 表达标准（语气、边界、禁止事项） |
| [`../templates/`](../templates/) | 05A-05E 交付模板 + 审计模板 |

## 日常怎么用

1. 先读 [`../SKILL.md`](../SKILL.md)
2. 确认取证与裁决已审过的事实与判断
3. 按交付类型选模板（见 [`standards/README.md`](standards/README.md)）
4. 按表达标准自检；**不得新增未经确认的事实或判断**

## 怎么维护

- 改标准/模板时同步审计 YAML 与 Runtime 表达校验（若有）
- 质量门槛以 `standards/05_投研表达标准.md` 为准
- 审计模板：`../templates/05_表达审计模板.yaml`、`../templates/05_独立语义审查模板.yaml`
