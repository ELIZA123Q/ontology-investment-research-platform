# DeepSeek-pro 校准预检（≤10 次新请求）与体验读板

日期：2026-07-22  
模型分工：评测 `deepseek-v4-pro`；生产 `deepseek-v4-flash`（第二 `model_id`）  
运行目录：`05_governance/14_evals/03_执行/runs/pilot_light_pro_flash_20260722_budget10`  
结论类型：有预算的校准切片与流程增益读板；**不是**完整 C 门通过，也**不是**流程增益已验证。

## 1. 本轮实际调用

- 命令：`--stage calibration --intensity pilot_light --max-new-requests 10`
- 状态：`request_budget_exhausted`；`new_requests_sent=10`；`error_responses=0`
- 范围：`evaluation_scope=single_vendor_comparative`，`research_gain_claim_eligible=true`
- `calibration_minimum`（pilot_light + single_vendor）：C1；本轮在算完整校准摘要前触达预算门，**未写出** `calibration_summary.yaml`
- 全部 10 次均为缺陷校准（DEF-01…DEF-05 × judge_a/judge_b）；干净样例与扰动未发（故意把预算留给缺陷识别）
- 模型实呼：`deepseek-v4-pro`；10/10 `status=ok`，最终 JSON 均可解析，**无空响应**
- Token（响应 usage 合计）：prompt 85,594 + completion 8,061 = **93,655**；其中大量为 reasoning_tokens

## 2. 缺陷切片观察（非正式 C 分）

| 缺陷 | 期望类别 | 两路是否检出 | 定位 | 严重度 | 正常稿更高 |
|---|---|---|---|---|---|
| DEF-01 | fact_error | 是 / 是 | 正确 | major / critical | 是 / 是 |
| DEF-02 | scope_extrapolation | 是 / 是 | 正确 | major / major | 是 / 是 |
| DEF-03 | strength_upgrade | 是 / 是 | 正确 | critical / critical | 是 / 是（类别两路均写成 fact_error） |
| DEF-04 | counterevidence_removed | 是 / 是 | 正确 | major / major | 是 / 是 |
| DEF-05 | causal_leap | 是 / 是 | 正确 | major / critical | 是 / 是（一路类别写成 fact_error） |

解读：大模型在长上下文下能稳定检出并定位、并把正常稿排前；**严重度与细分类别仍不稳**。这支持“值得在预算内继续校准”，**不足以**发布 R/U/delta 或宣称流程增益。

## 3. 工程与体验侧同期动作

- `model_profiles.yaml` 改为 pro（评测/下游）+ flash（生产），解锁 comparative 资格。
- 校准请求顺序改为：缺陷 → 干净样例 → 扰动，避免紧预算先烧在扰动上。
- 临时/QA 库：`createExperienceCohortRun` 硬拒绝；`/experience` 继续标红；API 返回 403。
- 已在持久库重新登记 `RXB-S01`（`run_id=e81d73c5-10a2-457c-805d-05d8170683de`），`bound=1, completed=0/8`；**不回填**废演练。
- 主链、同证据基线、独立审阅、A/B 盲评仍为 pending；本轮批准的 10 次请求**未**用于工作台生成。

## 4. 流程增益读板（合同口径）

| 检查项 | 结果 |
|---|---|
| 体验完整配对样本 | `0/8`（`workflow_gain_claim_status=insufficient_sample`） |
| 质量护栏分母 | 尚无独立审阅 / 盲评分差 |
| 评测声明资格 | 档案层已是 comparative，但完整 C 门与 formal 未跑 |
| 成本 | 本轮评测 10 次 / ~93.7k token；体验 KPI 与任务美元成本仍无合格样本 |

**正式结论：仍不得宣称「流程增益值得成本」。**  
当前只证明：合同与测量协议能跑；pro 评测器在 10 次预算内对高信息量缺陷切片可用且无空响应；前瞻体验分母仍为空。

## 5. 下一步硬门槛（未再获预算前禁止扩跑）

1. 研究员从 `/experience` 在**持久库**把至少 8 题跑到 Stage05 或正确停止，并完成同证据基线、独立审阅与揭盲盲评。
2. 若续跑评测：新目录或续跑本目录时必须再带 `--max-new-requests`；优先补干净样例与关键扰动，再谈完整 C 门。
3. 任一轮主 KPI 变好但质量回退，或样本未满 8，都不得改写本结论。
