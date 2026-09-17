# A股半导体行业 2026H1 示例运行

这是 `codex/dynamic-research-dag` 分支上的一次真实动态图研究运行。它以“生命周期视图”组织中间结果，但执行顺序由 Rule、Logic 和 Capability 动态编译，不是写死的 01—05 流程。

## 阶段性结果索引

1. [任务输入](request.yaml)
2. [研究设计与预登记假设](research-design.md)
3. [动态 DAG 与规则选择理由](execution-plan.md)
4. [来源、事实、反证和证据完备度](evidence-package.md)
5. [机制、竞争解释和 J2 判断](reasoning-record.md)
6. [审批前研究草稿](draft-report.md)
7. [人工审批后的正式报告](final-report.md)
8. [金融数据源策略变更](data-source-policy-change.md)
9. [机器可读运行摘要](run-summary.json)
10. [可移植 RDF/TriG 图归档](research-bundle.trig)

## 当前状态

- 已完成：任务规范化、语义上下文、取证、主张抽取、事实合成、冲突检查、证据评价、假设、推理规则、正式判断、报告草稿、审批请求、人工审批和正式发布。
- 审批记录：`approval:31ad7cd6-ee7c-4e7d-98fd-556d02fb95e6`，`user:luyao`，approved。
- 正式发布实体：`published-report:a-share-semiconductor-2026h1`。
- 失败节点：无。

人工明确批准后，唯一的非幂等发布节点才获得执行资格。
