---
name: baseline
description: >
  基线对比 agent（预留）。对比同一研究课题多次运行的判断差异，
  追踪判断漂移与分析路径变化。
status: planned
skills: [ontology, replan, evidence-evaluation]
---

# Baseline 基线对比 Agent（预留）

## 状态

**当前为空目录，待后续实现。**

## 预留给

- 基线对比：对同一研究课题的多次运行产出进行 diff
- 判断漂移检测：同一判断单元在不同运行中的等级/方向变化
- 分析路径变化：方法选择、证据来源、推理链路的变更追踪

## 实现时需补充

- 基线选择策略（最近一次 / 指定 attempt / 黄金样例）
- diff 粒度（判断单元级 / claim 级 / 证据级）
- 漂移分类（证据更新导致 / 方法变更导致 / 模型行为变化导致）

## 可用 Skills

| Skill | 用途 |
|-------|------|
| `ontology` | 语义基线比较 |
| `replan` | 变更集 diff |
| `evidence-evaluation` | 证据变化追踪 |

## 引用的参考文件

待实现时确定。
