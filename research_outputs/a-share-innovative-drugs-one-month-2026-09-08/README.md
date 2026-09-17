# A股创新药未来一个月方向研究

这是 `codex/dynamic-research-dag` 分支上的新研究运行。研究以中证创新药产业指数（931152）为语义范围、159992为可交易价格代理、沪深300为基准；行情通过项目默认免费AkShare MCP取得，基本面和政策事实回溯至法定披露和官方来源。

## 阶段性结果索引

1. [任务输入](request.yaml)
2. [研究设计与预登记假设](research-design.md)
3. [动态DAG与实际执行](execution-plan.md)
4. [来源、市场统计、基本面、催化与证据缺口](evidence-package.md)
5. [假设、竞争解释与J1裁决](reasoning-record.md)
6. [等待审批的完整报告草稿](draft-report.md)
7. [机器可读节点输入](runtime-input.yaml)
8. [机器可读运行摘要](run-summary.json)
9. [可移植RDF/TriG图归档](research-bundle.trig)
10. [首个交易日截点后监测](market-refresh-2026-09-08.md)

## 当前状态

- 正式判断：J1，未来约20个交易日基准情景为震荡偏弱，上涨概率粗略为40%—45%。
- 已完成12个执行节点，失败节点为0。
- 证据谱系可由草稿反向追溯至Judgment、RuleEvaluation、Fact、Claim和SourceDocument。
- Oxigraph重启恢复、TriG归档装载和双时态截面检查通过。
- 项目离线验证及25项测试通过。
- 审批请求：`approval-request:a-share-innovative-drugs-one-month-2026-09-08`，状态pending。
- 未创建 `ApprovalRecord`，未执行非幂等发布节点，未生成正式报告。
- 2026-09-08 收盘后的追加监测未触发计划修订，原 J1 判断保持不变。
