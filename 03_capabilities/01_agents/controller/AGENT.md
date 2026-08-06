---
name: controller
description: >
  流程控制器 agent。编排五阶段的执行顺序、
  自动返工调度、并行/串行决策、人工确认卡点。
status: implemented
skills: [replan, method-selection]
---

# Controller 流程控制器 Agent

## 状态

**已实现。** 核心编排逻辑位于 `07_runtime/workflow/controller.ts`。

## 职责

- 流程编排：自动按依赖顺序执行五个阶段（01→02→03→04→05）
- 自动确认：HQ 质量门禁通过后自动确认，无需人工逐阶段点击
- 返工调度：HQ 未通过时自动重试生成
- 人工卡点：HQ 重试耗尽或确认校验失败时，停止并标记需人工介入

## 实现方式

Controller 不是调用 LLM 的 Agent——它是一个**确定性编排函数**，复用现有基础设施：

| 能力 | 调用 |
|------|------|
| 阶段生成 | `enqueueArtifactGeneration()` + `runResearchJobUntilSettled()` |
| 等待完成 | `runResearchJobUntilSettled()` 阻塞等待至终态 |
| 自动确认 | `approve()` — 复用完整确认管线（合同校验、图谱物化等） |
| HQ 门禁 | `meetsHighQualityForReview()` — 判断是否可自动确认 |

## API

### POST `/api/runs/[id]/pipeline`

启动全链路自动执行。

请求体（全部可选）：
```json
{
  "maxRetriesPerStage": 1,
  "autoApprove": true,
  "stage03Mode": "auto",
  "startFrom": 1,
  "stopAt": 5
}
```

响应：`202 Accepted` — 链路在后台执行，通过 `GET /api/runs/[id]/pipeline` 查询进度。

### GET `/api/runs/[id]/pipeline`

查询当前链路进度（复用 run progress + artifact 状态）。

## 配置

| 环境变量 | 默认值 | 说明 |
|----------|--------|------|
| `PIPELINE_MAX_RETRIES_PER_STAGE` | `1` | 每阶段最多重试次数 |
| `PIPELINE_AUTO_APPROVE` | `true` | HQ 通过后是否自动确认 |
| `PIPELINE_STAGE03_MODE` | `auto` | Stage03 模式：auto/regenerate/evidence_supplement |

## 编排流程

```
对于每个阶段 (01→02→03→04→05):
  1. 已确认 → 跳过
  2. 上游未就绪 → 终止（blocked）
  3. 入队生成 → 等待完成
  4. HQ 通过 + autoApprove → 自动确认 → 下一阶段
  5. HQ 未通过 → 重试（最多 maxRetriesPerStage 次）
  6. 重试耗尽 → 标为 needs_manual_review → 终止
  7. 生成失败 → 终止（failed）
```

## 边界处理

- **Stage01 needs_clarification**：生成后若 disposition 为 needs_clarification，HQ 不会通过，触发重试后最终标为 pending
- **Stage03 补证模式**：若已有 approved stage_03，默认走 evidence_supplement（补充取证），避免全量重抓
- **已部分完成的 run**：自动检测已确认阶段，从第一个未确认处开始
- **Stage05 paid auto-retry**：尊重 `STAGE05_PAID_AUTO_RETRY` 环境变量（HQ 门禁重试逻辑由 `high_quality_retry.ts` 控制）

## 可用 Skills

| Skill | 用途 |
|-------|------|
| `replan` | 返工调度与变更传播 |
| `method-selection` | 方法合规性预检 |

## 引用的参考文件

| 文件 | 用途 |
|------|------|
| `90_compat/governance_mirrors/contracts/governance_control_contract.yaml` | 治理控制合同 |
| `07_runtime/workflow/controller.ts` | 核心编排实现 |
| `07_runtime/app/api/runs/[id]/pipeline/route.ts` | API 端点 |
| `07_runtime/workflow/approval.ts` | 确认管线 |
| `07_runtime/runner/research_job_runner.ts` | 任务入队与执行 |
