# 集中式 Runtime 退场账本

Workspace 模块单体已经承担所有新增架构能力：不可变知识包、ResearchRun 锁、主管—worker 编排、独立 SQLite Repository、知识晋级 API 和业绩更新黄金路径。公共 HTTP 只从 `src/application/` 进入，`src/runtime-v2/` 已移除。

生产 `src/worker.ts` 也只依赖 `src/application/production-worker-runtime.ts` 暴露的端口；兼容 Kernel/Store 的组装留在 Application 内部。架构审计会拒绝 HTTP 路由或 worker 重新直连兼容实现。

现有 `src/runtime/kernel.ts`、`src/runtime/store.ts` 和 `src/contracts.ts` 暂时保留为已上线产品链路的兼容实现，不再是新增能力落点。`npm run audit:architecture` 同时冻结三者的最大行数和最大引用者数量，因此后续变更只能迁出，不能继续堆入。

退场顺序固定如下：

1. 将 Case、Task、Artifact、Approval 与 Knowledge 类型迁到 `@investment/domain`，消费者改用包出口后删除 `src/contracts.ts`。
2. 将 Case、Artifact、Approval、Knowledge、Event 和 Job Repository 逐个迁到 `@investment/persistence-sqlite`，回放与备份验证通过后删除 `RuntimeStore`。目前 Schema/Queue/Worker/Connector Response 已归包内实现，Knowledge 与 Research Record（Artifact/Approval/Event）已成为独立 SQLite Repository；Store 只保留兼容委托入口。
3. 将提交目标、证据摄取、推进节点、审批、修订、发布和知识挖掘用例迁到 `src/application/` 与 `@investment/orchestrator`，最后删除 `AgentKernel`。

每次迁出必须让三项冻结指标至少一项下降，并保持 `validate_project.py`、公开业绩回放和受约束多 Agent 黄金回放全部通过。禁止用重命名、继承或另一份巨型兼容类冒充拆分完成。
