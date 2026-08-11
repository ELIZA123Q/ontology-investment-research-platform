# 本体（Ontology）

这里用机器可读的方式定义：**世界里有哪些对象与关系，以及在规则下允许怎样变化**。

可以把它理解成系统的正式名词表与结构说明书——不是研究手册，不是执行引擎，也不是校验程序。

```text
01_ontology = 世界模型 + 变化规则（声明式权威）
```

人话口径与别名在 [`../02_dictionary/`](../02_dictionary/README.md)；怎么做一次研究在 `02_scenario_task` / `03_agent_capability/02_skills` / Runtime。

---

## 1. 本目录刻意只留这些

```text
01_ontology/
├── README.md                 # 人读：为什么这样拆、边界在哪
├── platform_registry.yaml    # 机器唯一入口：东西在哪、哪一版
├── meta_schema.yaml          # YAML 应遵循什么结构
├── models/                   # 通用正式模型（跨行业）
├── kinetics/                 # 允许怎样改变世界
└── domains/                  # 行业正式扩展与参数
```

**就这么简单。** 根目录不再放第二套 registry、不再放 3.0/4.0 两代 validator、不再把解释器与本体定义堆在一起；**也不要再维护第二套本体规范 MD**——本 README 是唯一人读总入口。

| 角色 | 文件 | 回答的问题 |
|---|---|---|
| 人读入口（唯一） | `README.md` | 设计意图与边界；不另维护 00–03 规范 MD |
| 机器入口 | `platform_registry.yaml` | 模型 / kinetics / domain / schema 在哪 |
| 格式契约 | `meta_schema.yaml` | Ontology YAML 长什么样才合法 |
| 世界长什么样 | `models/` + `domains/` | 允许存在什么 |
| 世界如何变 | `kinetics/` | 允许怎样正式改写 |

两个不可替代的机器文件：

- **`meta_schema`** → 格式是什么  
- **`platform_registry`** → 东西在哪里  

AI 或 Runtime 要找对象定义、动作、领域扩展、校验入口：先读 `platform_registry.yaml`。

---

## 2. 核心分层（比目录更重要）

```text
通用 Model
= 所有行业共同使用的正式对象 / 关系

Domain Extension
= 某行业独有的正式对象 / 关系 / 事件扩展

Domain Parameters
= 该行业研究中预置的状态变量、证据画像、传导模板等

Task / Method / Runtime
= 这次怎么研究、怎么取证、怎么执行
```

一句话边界：

> **Model 定义「系统允许存在什么」；Domain 定义「半导体里具体认什么、通常怎么看」；Task / Method / Runtime 定义「这次研究具体怎么做」。**

因此：

| 该放这里 | 不该放这里 |
|---|---|
| 跨行业正式类型与关系 | 单次研究结论、买卖建议 |
| 行业正式扩展类型 | 任务编排、队列、重试、Checkpoint |
| 领域预置参数（经 Bundle 消费） | 场景「怎么跑」的流程正文 |
| 改变世界的 Action / Function / Policy / Trigger | 校验程序、规则解释器实现 |

`01_semantic_knowledge` 回答「系统如何理解世界」；**不负责**「怎么做一次研究」。

---

## 3. `models/`：五个通用正式模型

```text
models/
├── semantic.yaml      # 现实世界有什么
├── state_event.yaml   # 这些东西处于什么状态、发生什么变化
├── evidence.yaml      # 我们凭什么知道
├── judgment.yaml      # 我们形成什么研究判断
└── operational.yaml   # 一次研究本身有哪些正式状态对象
```

这是**跨行业共用**的类型层。行业专属类型不进这里。

刻意移出 Model 的东西（以及为什么）：

| 原位置 | 现位置 | 原因 |
|---|---|---|
| `scenario.yaml`（场景类型） | [`02_scenario_task/02_scenarios/types.yaml`](../../02_scenario_task/02_scenarios/types.yaml) | 场景是任务 catalog，不是世界对象模型 |
| `ActionExecution` | [`05_control_evaluation/02_identity/`](../../05_control_evaluation/02_identity/action_execution_schema.yaml) | 运行审计，不是投研世界对象 |
| `semiconductor_extension` | `domains/semiconductor/ontology_extension.yaml` | 行业正式扩展属于 Domain |
| 领域研究参数 | `domains/*/parameters/` | 预置知识，不是通用类型定义 |

`ResearchScope` 属于 **operational**（研究如何裁剪世界），不是语义世界实体。  
`SourceSnapshot` 属于 **evidence**（我们凭什么知道），不是运营日志。

---

## 4. `domains/`：正式扩展 ≠ 预置参数 ≠ 方法

以半导体为例：

```text
domains/semiconductor/
├── README.md                 # Domain 人读入口
├── DOMAIN_GUIDE.md           # 语义 / 推理 / 证据研究原则
├── domain_registry.yaml      # Domain 机器入口
├── ontology_extension.yaml   # 正式新增类型 / 关系 / 事件
├── parameters/               # 人工维护的预置参数源
├── business_instances.yaml   # 生成的 Runtime 只读 Bundle
└── build_business_instances.py
```

三层不要混：

1. **正式扩展**：能进类型系统的东西（如 `WaferFab`、`CapacityMetric`）；依赖五个通用 Model，**不得重定义核心 ID**。
2. **领域参数**：研究中「通常怎么看」的预置（状态变量、证据画像、传导模板）；必须引用正式对象；改源后重建 Bundle。
3. **Skill 资源**：怎么取证、怎么裁决 → 在 `03_agent_capability/02_skills`，**不得写回正式本体**。

领域扩展若投影到核心类型，用 `projects_to` / 明确关系，避免错误的 `extends` 继承链。

---

## 5. `kinetics/`：世界允许怎样被改写

| 文件 | 回答的问题 |
|---|---|
| `action_types.yaml` | 允许怎样**正式改变**世界？ |
| `functions.yaml` | 可以怎样**读取 / 计算**世界？（无副作用） |
| `policies.yaml` | 什么动作允许 / 禁止 / 需审批？ |
| `triggers.yaml` | 发生什么变化后自动触发什么 Action？ |

研究业务主链（生命周期断点要完整，不要把创建与批准糊在一步里）：

```text
CASE → HYPOTHESIS → EVIDENCE → JUDGMENT → DELIVERABLE → MONITORING
```

约定：

- **`function_ref`**：Action 提交前的主要计算 / 规范化 Function；**不要求**与 parameters 一一对应。
- **Policy vs Action 前置**：Policy 是跨 Action 的治理规则；`preconditions` / `approval_policy` 是可执行实现。
- **`Trigger.run_as`**：必须落在目标 Action 的 `allowed_actors` 内。
- 正式语义对象与关系**只能通过 Action Service 写入**；Runtime 任务对象（Task、队列、Checkpoint）不进业务本体。

---

## 6. 为什么必须只有一个机器入口

入口链：

```text
01_semantic_knowledge/registry.yaml
        ↓
01_ontology/platform_registry.yaml
        ↓
   models / kinetics / domains
```

`platform_registry` 登记：`meta_schema`、semantic / operational / kinetic 模型、domain bundle、runtime 投影、validator、迁移基线指针。

**不要**再维护平行的 `registry.yaml` / 根目录 `model_registry.yaml`。  
改一个 Model 却要同步三处登记，就是在制造「平行权威」——而这正是本项目要消灭的问题。


---

## 7. 校验为什么不在这里

> Ontology **定义**规则；Governance **检查**规则有没有被破坏。

统一校验：

[`05_control_evaluation/04_verifiers/ontology/validate_ontology.py`](../../05_control_evaluation/04_verifiers/ontology/validate_ontology.py)

它合并了两类能力：

- **语义深度**（原 v3）：重复 key、继承环、关系逆、基数、Evidence→Judgment 边界、规则 fixture 等  
- **平台 / kinetics 接线**（原 v4）：registry 完整性、Action / Function / Trigger / Policy 引用、`run_as` 合法性等  

`rule_interpreter.py` 同属校验基础设施（让 YAML 里的 `condition` 可执行测试），不随本体定义放在本目录。

原 `00`–`03` 本体规范 MD **已退出正式维护**。仍有价值的设计原则已合并至本 README；对象、属性、关系与约束的机器权威以 `models/*.yaml`（及 `domains/*/ontology_extension.yaml`）为准。

[`../02_dictionary/`](../02_dictionary/README.md) 只管术语 / 别名 / 歧义 / 研究用语归一，**不是**旧规范文档的归档处。

---

## 8. 怎么用 / 怎么改

**查：**

1. 打开 [`platform_registry.yaml`](./platform_registry.yaml) → 定位模型与 kinetics。  
2. 正式对象 / 关系 → `models/` 或 `domains/*/ontology_extension.yaml`。  
3. 半导体预置知识 → `domains/semiconductor/parameters/`（改源）与生成 Bundle。  
4. 允许怎样改世界 → `kinetics/`。

**改：**

1. 只改本目录声明式 YAML，并确保已被 `platform_registry` 登记。  
2. 领域参数改完后运行 `domains/semiconductor/build_business_instances.py`。  
3. 跑：`python3 05_control_evaluation/04_verifiers/ontology/validate_ontology.py`。  
4. Runtime 消费侧如需同步：`cd 06_runtime && npm run ontology:sync`。  
5. **禁止**在 Runtime 或其他域复制平行权威枚举。

---

## 维护者附录

| 项 | 值 |
|---|---|
| status | `active` |
| source_of_truth | `01_semantic_knowledge/01_ontology/` |
| machine_entry | `platform_registry.yaml` |
| schema 版本 | Platform 4.0 |
| validator | `05_control_evaluation/04_verifiers/ontology/` |
