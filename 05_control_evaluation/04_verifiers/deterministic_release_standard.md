# vNext 确定性发布标准

本文件只规定可以无歧义判定的发布条件。研究是否有洞察、是否帮助决策，仍按 [`../05_evals/rubrics/research_quality.md`](../05_evals/rubrics/research_quality.md) 和正式 Eval 协议评价。

## 发布前必须满足

1. TaskGraph 来自白名单 Node Catalog，所有必需节点已完成或有明确降级原因。
2. 正式 Claim 只引用已验证的 SourceReference 与 EvidenceFact。
3. MethodApplication 的必需输入已满足；被阻断的方法保留缺口，不得冒充 executed。
4. Judgment 已经研究员确认，并通过 `ApproveJudgment` 写入正式本体。
5. 报告通过来源、表达边界和可信 UI 校验，审计不得静默改写主制品。
6. `publish_confirmation` 已批准，`PublishDeliverable` 的 preview、版本检查和审批检查通过。
7. report hash、evidence bundle hash 与 Artifact 版本已经冻结。

发布成功只证明确定性边界满足，不代表 R、U、delta、S、C 或研究增益已经通过。

## 返工与更新

- 上游变化只使依赖图中可达的下游 Artifact 或正式对象失效。
- Artifact 修改创建新版本；旧版本保留为 `superseded`。
- 已发布 Task 的新材料或范围变化必须创建更新分支。
- 时间范围变化必须重新检查来源新鲜度与 KnowledgeLock。
- 没有合格证据时，Judgment 必须降级为「暂不可判断」。

实现入口位于 `06_runtime/src/governance/verifiers.ts`、`06_runtime/src/runtime/kernel.ts` 与 `06_runtime/src/ontology/action-service.ts`。
