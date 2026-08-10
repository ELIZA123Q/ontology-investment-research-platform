# 架构与项目边界

这里放「整个仓库怎么理解」的权威说明：项目做什么/不做什么、五域怎么分工、文件放哪、知识如何沉淀。

## 给谁看

- **研究员：** 优先读「项目定位与边界」即可
- **维护者：** 仓库地图、五域权威、兼容策略、知识闭环

## 材料从哪来

| 文件 | 白话用途 |
|---|---|
| [`00_项目定位与边界.md`](00_项目定位与边界.md) | 做什么、不做什么 |
| [`00_五域系统骨架.md`](00_五域系统骨架.md) | AI 原生分层 + 五域职责边界 |
| [`architecture.yaml`](architecture.yaml) | 心智名↔路径映射、模块关系、禁止项 |
| [`02_仓库地图与文件治理.md`](02_仓库地图与文件治理.md) | 文件该放哪 |
| [`03_知识沉淀闭环.md`](03_知识沉淀闭环.md) | 单次研究如何变成长期资产 |
| [`five_domain_authority.yaml`](five_domain_authority.yaml) | 「权威在哪」机器索引 |
| [`compat_policy.yaml`](compat_policy.yaml) | 旧路径如何兼容 |
| [`01_本体统一语义基础设施契约.md`](01_本体统一语义基础设施契约.md) | 语义基础设施契约 |

## 怎么用

1. 新人/研究员：先读定位与边界。
2. 理解 AI 原生分层 / 心智名：读 [`00_五域系统骨架.md`](00_五域系统骨架.md) 与 [`architecture.yaml`](architecture.yaml)。
3. 找不到文件权威：查 `five_domain_authority.yaml` → 各域 `registry.yaml`。
4. 了解知识晋升：读知识沉淀闭环，机器细节见 [`../02_合同/knowledge_learning_contract.yaml`](../02_合同/knowledge_learning_contract.yaml)。

## 怎么维护

- 新架构入口优先写本目录；旧英文路径只作 compat。
- 改五域边界须同步 `five_domain_authority.yaml`、`architecture.yaml` 与受影响域 README。
- 顶层 1:1 改名已完成；仍禁止 Data/Evidence 第九写入口、Runtime 嵌进 Context、独立 `08_` 写入口。
- 改完跑 `python3 05_control_evaluation/03_校验/validate_project.py` 等治理校验。

---

## 维护者附录（可跳过）

- 五域是后台职责边界，不建成五个 UI 中心
- Runtime 唯一可执行在 `06_runtime/`，不嵌进 Context & State
- Asset Evolution 写入口暂挂 Governance 知识闭环合同
- Workflow 是 Scenario/Task 下的可选策略，不是系统骨架
