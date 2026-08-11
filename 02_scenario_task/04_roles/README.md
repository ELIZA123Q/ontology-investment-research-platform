# Research Roles

本目录定义研究任务中的责任位置（Role）。

## 核心定义

**Role = 一个研究任务中的责任位置。**

Role 描述“需要有人对什么负责”，不描述具体由哪个 Agent 承担。

与其他域的关系：

- **Task**：定义需要完成什么研究任务；
- **Role**：定义任务中的责任位置；
- **Agent**：声明自身可以承担哪些 Role；
- **Runtime**：根据当前任务、能力和运行状态确定实际承担者。

因此：

```text
Problem Graph → requires Role responsibility
Agent → can_assume Role
Runtime → resolves Actor for the current frontier
```

Role 与 Agent 不建立静态一一映射。
同一 Role 可以跨多个 Task motif 对共享子图负责，不能因图分支而静态复制成多个 Agent 身份。

## 当前角色

当前仅保留两个核心研究角色：

- `research_owner`：研究目标与方向的责任拥有者；
- `research_lead`：研究组织、协调与判断综合责任角色。

vNext.1 当前可执行 Agent 仍仅为 `research-lead`，
其可承担 `research_lead` Role。

## 边界

本目录只保存：

- Role 定义；
- Role 职责；
- 可承担该 Role 的 Actor 类型。

本目录不保存：

- Agent 定义；
- Role-Agent 静态映射；
- Prompt；
- Skill；
- Workflow；
- Human Gate；
- Runtime 调度逻辑。

Human Gate 属于 Runtime / Governance Policy（例如 workflow pattern 中的 `human_gates`），不是 Role 固有属性。
