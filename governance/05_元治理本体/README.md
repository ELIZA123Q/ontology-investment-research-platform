# 本体演进治理本体

> **面向开发者，研究员可跳过。** 这里是管理"投研知识体系本身如何变化"的规则库——当需要修改某个研究概念的定义或关系时，在这里发起变更请求��研究员通常不直接操作这里。

本目录是投研本体的治理控制面，采用与 `ontology/` 相似的"元模式—模型注册表—模型文件—实例图"组织方式，但不属于投研正式本体。

它借鉴 Palantir Ontology 的四个核心思想：

1. 用对象类型和关系类型表达可治理资源及其影响网络；
2. 用 Action Type 作为唯一写入口，把参数、权限、提交条件、状态迁移和日志绑定在一起；
3. 用 Branch、Proposal、Diff、Check、Approval、Rebase、Release 表达变更闭环；
4. 用 Action Log、Usage Observation 和 Release Baseline 保留可追溯历史。

## 权威入口

- [`00_本体演进治理框架概述.md`](00_本体演进治理框架概述.md)：设计原则、闭环和执行方式。
- [`meta_schema.yaml`](meta_schema.yaml)：治理本体元模式。
- [`model_registry.yaml`](model_registry.yaml)：治理模型文件的唯一注册表。
- [`models/`](models)：共享属性、接口、对象、关系、Action 和规则。
- [`instances/governance_instance_graph.yaml`](instances/governance_instance_graph.yaml)：治理控制面的种子对象与关系。

## 与正式本体的关系

`ontology/` 回答“投研世界里有什么、如何关联、什么判断成立”；本目录回答“这些定义由谁负责、如何提出变更、影响谁、经过什么检查与批准、何时成为新基线”。

治理对象只能通过稳定资产 ID、本体元素 ID、运行 ID、仓库引用和内容指纹引用业务面。治理对象、治理关系和治理 Action 不得注册到 `ontology/01_通用/model_registry.yaml`，也不得进入投研业务实例图或商业规则求值。

## 机器检查

```bash
python3 governance/03_校验/validate_governance_control_plane.py
```

Runtime 从本目录读取 ChangeProposal 状态和 Action 状态迁移；旧的 `governance/02_合同/governance_control_contract.yaml` 与 `governed_asset_registry.yaml` 仅保留为兼容投影，不再是状态机事实源。
