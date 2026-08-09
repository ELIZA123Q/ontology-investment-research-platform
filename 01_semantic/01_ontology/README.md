# 本体（Ontology）

这里用机器可读的方式定义「世界里有哪些对象、关系，以及在规则下允许怎样变化」。可以把它理解成系统的正式名词表与结构说明书。

## 给谁看

- **研究员**：偶尔查阅概念是否已在本体中定义；日常研究更常看词典与方法库
- **维护者**：改模型、动作、策略时的权威目录

## 材料从哪来

| 内容 | 位置 |
|---|---|
| 世界模型（对象/关系） | `models/` |
| 变化规则（动作、触发、策略、函数） | `kinetics/` |
| 统一入口登记 | [`platform_registry.yaml`](./platform_registry.yaml) |
| 子注册表 | [`registry.yaml`](./registry.yaml) |

Ontology 3.0 相关内容可作为只读历史基线保留；正式写入只允许经过登记的 Action。Function 只做只读计算，任务编排不在本目录完成。

## 怎么用

1. 查「有没有这个正式对象/关系」→ 从 `platform_registry.yaml` 进入对应 `models/`。
2. 查「允许怎样改世界」→ 看 `kinetics/`（action / trigger / policy / function）。
3. 做研究时不必手写本体；Runtime 与治理校验会消费这里的登记结果。

## 怎么维护

- 新增或修改正式对象/关系：只写入本目录，并更新 `platform_registry.yaml` / `registry.yaml`。
- 改完跑本体与项目校验（见 [`validate_v4.py`](./validate_v4.py) 与 [`05_governance/03_校验/`](../../05_governance/03_校验/README.md)）。
- 禁止在 Runtime 或其他域复制平行权威枚举。

---

## 维护者附录（可跳过）

- **status:** active
- **source_of_truth:** `01_semantic/01_ontology/`
- Platform 4.0：`models/` 定义世界，`kinetics/` 定义治理约束下的变化
