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

目录编号是整理用的，**不是**做研究时必须走的阶段顺序。唯一能跑起来的应用在 `07_runtime/`。

| 目录 | 人话 |
|---|---|
| [`01_semantic/`](01_semantic/README.md) | 概念、词典、证据语义 |
| [`02_tasks/`](02_tasks/README.md) | 场景与任务定义 |
| [`03_capabilities/`](03_capabilities/README.md) | 方法库、能力登记、数据通道 |
| [`04_execution/`](04_execution/README.md) | 执行合同与历史工作区 |
| [`05_governance/`](05_governance/README.md) | 边界、合同、校验、评测 |
| [`06_app/`](06_app/README.md) | 产品面说明（实现在 Runtime） |
| [`07_runtime/`](07_runtime/README.md) | 唯一可执行应用与后台 |

更细说明见 [`05_governance/01_架构/02_仓库地图与文件治理.md`](05_governance/01_架构/02_仓库地图与文件治理.md)。权威索引：[`five_domain_authority.yaml`](05_governance/01_架构/five_domain_authority.yaml)。
