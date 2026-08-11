# 本体 — 系统认识世界的概念表

> 上级目录：[`01_semantic_knowledge/`](../README.md) | 根目录：[`README.md`](../../README.md)

本体用机器可读的方式定义「世界里有哪些对象和关系，以及在规则下允许怎样变化」。可以理解成系统的**正式名词表与结构说明书**——不是研究手册，不是执行引擎，也不是校验程序。

## 里面有什么

| 文件/目录 | 一句话说明 | 你需要管吗 |
|----------|-----------|-----------|
| `platform_registry.yaml` | **机器唯一入口**：程序通过这个文件找到所有本体定义 | 加新文件时必须在这里登记 |
| `meta_schema.yaml` | **格式契约**：本体 YAML 文件长什么样才合法 | 改格式时看 |
| [`models/`](models/) | **通用模型**：跨行业共用的对象和关系（5 个文件） | 加新通用类型时改 |
| `kinetics/` | **变化规则**：允许怎样正式改变世界（Action/Function/Policy/Trigger） | 改动作规则时看 |
| [`domains/`](domains/semiconductor/README.md) | **行业扩展**：半导体等行业的专属类型和参数 | 加新行业时看 |

## 日常怎么用

1. **查概念定义** → 打开 `platform_registry.yaml` 定位文件，再去 `models/` 或 `domains/` 看具体内容
2. **查允许什么操作** → 看 `kinetics/` 下的 `action_types.yaml`
3. **查半导体专属概念** → 去 `domains/semiconductor/`

## 怎么维护

1. 只改本目录的声明式 YAML 文件
2. 新文件必须在 `platform_registry.yaml` 里登记
3. 改完跑校验：
   ```bash
   python3 05_control_evaluation/04_verifiers/ontology/validate_ontology.py
   cd 06_runtime && npm run ontology:sync
   ```
4. 领域参数改完后运行 `domains/semiconductor/build_business_instances.py`
5. **禁止**在 Runtime 或其他目录复制平行定义

## 常见问题

**Q：本体和词典有什么区别？**
A：本体定义「系统认识哪些对象」（正式名词表），词典定义「同一个东西有哪些叫法」（术语映射）。改概念去本体，改叫法去词典。

**Q：通用类型和行业类型怎么分？**
A：所有行业共用的类型放 `models/`，半导体独有的放 `domains/semiconductor/ontology_extension.yaml`。不要混放。

**Q：校验为什么不在这里？**
A：本体只**定义**规则，校验程序在 `05_control_evaluation/04_verifiers/`。定义和检查分开，避免自我裁判。

---

## 技术附录（给开发维护者）

### 核心分层

```
通用 Model = 所有行业共同使用的正式对象/关系
Domain Extension = 某行业独有的正式对象/关系/事件扩展
Domain Parameters = 该行业研究中预置的状态变量、证据画像、传导模板
Task/Method/Runtime = 这次怎么研究、怎么取证、怎么执行
```

> Model 定义「系统允许存在什么」；Domain 定义「半导体里具体认什么」；Task/Method/Runtime 定义「这次研究具体怎么做」。

### models/ 五个通用模型

| 文件 | 回答的问题 |
|------|-----------|
| `semantic.yaml` | 现实世界有什么 |
| `state_event.yaml` | 处于什么状态、发生什么变化 |
| `evidence.yaml` | 我们凭什么知道 |
| `judgment.yaml` | 形成什么研究判断 |
| `operational.yaml` | 一次研究本身有哪些正式状态对象 |

### kinetics/ 四个文件

| 文件 | 回答的问题 |
|------|-----------|
| `action_types.yaml` | 允许怎样正式改变世界 |
| `functions.yaml` | 可以怎样读取/计算世界（无副作用） |
| `policies.yaml` | 什么动作允许/禁止/需审批 |
| `triggers.yaml` | 发生什么变化后自动触发什么 Action |

### 刻意移出 Model 的东西

| 原位置 | 现位置 | 原因 |
|--------|--------|------|
| `scenario.yaml` | [`02_scenario_task/02_scenarios/types.yaml`](../../02_scenario_task/02_scenarios/types.yaml) | 场景是任务 catalog，不是世界对象模型 |
| `ActionExecution` | [`05_control_evaluation/02_identity/`](../../05_control_evaluation/02_identity/action_execution_schema.yaml) | 运行审计，不是投研世界对象 |
| `semiconductor_extension` | `domains/semiconductor/ontology_extension.yaml` | 行业正式扩展属于 Domain |
| 领域研究参数 | `domains/*/parameters/` | 预置知识，不是通用类型定义 |

### 研究业务主链

```
CASE → HYPOTHESIS → EVIDENCE → JUDGMENT → DELIVERABLE → MONITORING
```

### 约定

- `function_ref`：Action 提交前的主要计算/规范化 Function；不要求与 parameters 一一对应
- Policy vs Action 前置：Policy 是跨 Action 的治理规则；`preconditions`/`approval_policy` 是可执行实现
- `Trigger.run_as`：必须落在目标 Action 的 `allowed_actors` 内
- 正式语义对象与关系只能通过 Action Service 写入

### 入口链

```
01_semantic_knowledge/registry.yaml
        ↓
01_ontology/platform_registry.yaml
        ↓
   models / kinetics / domains
```

| 项 | 值 |
|----|-----|
| status | `active` |
| source_of_truth | `01_semantic_knowledge/01_ontology/` |
| machine_entry | `platform_registry.yaml` |
| schema 版本 | Platform 5.0 |
| validator | `05_control_evaluation/04_verifiers/ontology/` |
