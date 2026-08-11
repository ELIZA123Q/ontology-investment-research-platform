# 投研判断工作台

本地优先的 AI 研究搭档：你说清目标、补充材料、审阅关键判断并调整方向；证据不够时会诚实降级为「暂不可判断」。

## 先读这个

**对项目一无所知？从这里开始 → [`新手导读.md`](新手导读.md)**  
遇到词不懂 → [`术语速查.md`](术语速查.md)

## 30 秒启动

```bash
bash start-light.sh
```

浏览器打开 **`http://127.0.0.1:3000`**（不要用 `localhost`）。

## 你属于哪一类

| 我是… | 去哪 |
|---|---|
| 主要做研究 / 用产品 | [新手导读 · 路径 A](新手导读.md#路径-a--我主要做研究再约-5-分钟) |
| 要改代码或维护仓库 | [新手导读 · 路径 B](新手导读.md#路径-b--我要改仓库--维护系统再约-20-分钟) |

---

## 仓库地图（读完导读再看）

目录编号是整理用的，**不是**做研究时必须走的阶段顺序。唯一能跑起来的应用在 `06_runtime/`。

| 目录 | 人话 |
|---|---|
| [`01_semantic_knowledge/`](01_semantic_knowledge/README.md) | 世界里有什么：概念、词典、证据语义 |
| [`02_scenario_task/`](02_scenario_task/README.md) | 现在要完成什么：意图、场景、任务、角色 |
| [`03_agent_capability/`](03_agent_capability/README.md) | 靠什么完成：Agent / Skill / Tool / Protocol |
| [`04_context_state/`](04_context_state/README.md) | 现在看见什么、做到哪里、记住什么、正在操作什么 |
| [`05_control_evaluation/`](05_control_evaluation/README.md) | 什么能做、什么算合格 |
| [`06_runtime/`](06_runtime/README.md) | 应用、API 与用户工作台；真正加载、组合、执行以上一切 |

更细说明见 [`docs/architecture/02_仓库地图与文件治理.md`](docs/architecture/02_仓库地图与文件治理.md)。权威索引：[`five_domain_authority.yaml`](docs/architecture/five_domain_authority.yaml)。

AI 原生分层：[`00_五域系统骨架.md`](docs/architecture/00_五域系统骨架.md) · [`architecture.yaml`](docs/architecture/architecture.yaml)。
