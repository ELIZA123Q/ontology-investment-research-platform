import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { existsSync } from "node:fs";
import { join } from "node:path";
import { registeredFiles } from "@/engine/knowledge";
import {
  applyUpstreamQualityFailure,
  forceHighQualityTarget,
  meetsHighQualityForReview,
  shouldPreserveUpstreamQualityFailure,
} from "@/engine/stage_hq_retry";
import { collectStage02HighQualityIssues } from "@/engine/stage02_documents";
import { assertStage03ReadyForApproval } from "@/engine/stage03_documents";
import { attachResearchValueReview } from "@/engine/research_value_review";

/**
 * 验收：堵住「结构全绿、实质仍弱」的假绿路径。
 * 工作台确认态 ≠ validate_run PUBLISHABLE；此处锁定确认前硬门禁。
 */
describe("quality enforcement acceptance", () => {
  it("forceHighQualityTarget does not overwrite research_value_review fail", () => {
    const data = attachResearchValueReview(
      { quality_status: "high_quality_pass", deterministic_check_status: "checked" },
      {
        status: "fail",
        checks: [{ id: "has_judgment_value", pass: false, score: 0, evidence_span: "", note: "无认知差" }],
        retry_count: 1,
        total_score: 0,
        pass_threshold: 16,
        mode: "heuristic",
      },
    );
    expect(shouldPreserveUpstreamQualityFailure(data, "stage_05").preserve).toBe(true);
    forceHighQualityTarget(data);
    expect(data.quality_status).not.toBe("high_quality_pass");
    applyUpstreamQualityFailure(data, "00A 研究价值审查未通过");
    expect(data.quality_status).toBe("return_required");
    expect(data.deterministic_check_status).toBe("not_checked");
    expect(meetsHighQualityForReview("stage_05", data)).toBe(false);
  });

  it("forceHighQualityTarget does not overwrite evidence_quality_gate failure", () => {
    const data: any = {
      quality_status: "minimum_pass",
      deterministic_check_status: "not_checked",
      evidence_quality_gate: { passed: false, quality_status: "return_required" },
      evidence_quality_summary: "判断单元无可用证据",
    };
    expect(shouldPreserveUpstreamQualityFailure(data, "stage_03").preserve).toBe(true);
    forceHighQualityTarget(data);
    expect(data.quality_status).toBe("minimum_pass");
    applyUpstreamQualityFailure(data, data.evidence_quality_summary);
    expect(data.quality_status).toBe("return_required");
    expect(() => assertStage03ReadyForApproval({
      ...data,
      preparation_markdown: "# 准备\n\n".padEnd(820, "x"),
      document_markdown: "# 准备\n\n".padEnd(820, "x"),
      instance_manifest_yaml: "metadata:\n  task_id: T\n",
      quality_status: "high_quality_pass",
      deterministic_check_status: "checked",
    })).toThrow(/证据质量门/);
  });

  it("stage02 HQ rejects vague stop conditions and missing counter role", () => {
    const logic = [
      "# 研究逻辑",
      "",
      "选用供需框架裁剪产品线。",
      "",
      "## 停止条件",
      "",
      "继续收集更多资料直到材料足够多。",
      "",
    ].join("\n").padEnd(820, "机制叙述。");
    const issues = collectStage02HighQualityIssues({
      research_logic_markdown: logic,
      document_markdown: logic,
      judgment_spine: "区分 HBM 结构性扩张与通用 DRAM 供给约束是否同步",
      judgment_units: [
        { id: "JU-1", title: "HBM", question: "是否扩张" },
        { id: "JU-2", title: "DRAM", question: "是否紧缺" },
      ],
      competing_explanations: [{
        explanation_id: "CE-1",
        statement: "需求一次性脉冲而非供给约束",
        discriminating_evidence: ["订单取消率与渠道库存对照"],
      }],
      counter_evidence_directions: [],
      evidence_requirements: [
        { id: "ER-1", requirement: "HBM 出货", evidence_role: "support" },
      ],
      method_applications: [
        { capability_type: "judgment_structure", method_id: "BF-SD-01" },
        { capability_type: "evidence", method_id: "kb03:A02" },
        { capability_type: "adjudication", method_id: "kb04:A02" },
      ],
      research_scope: { label: "存储周期 HBM/DRAM" },
      quality_status: "high_quality_pass",
      deterministic_check_status: "checked",
    });
    const codes = issues.map((item) => item.code);
    expect(codes).toContain("stop_condition_vague");
    expect(codes).toContain("counter_evidence_directions_thin");
    expect(codes).toContain("counter_evidence_role_missing");
    expect(codes).toContain("competing_explanation_unit_coverage");
    expect(codes).toContain("counter_direction_unit_coverage");
    expect(codes).toContain("counter_requirement_unit_coverage");
  });

  it("stage02 treats per-unit minimum validation conditions as research stop conditions", () => {
    const logic = [
      "# 研究逻辑",
      "选用供需框架并按产品线裁剪，关键单元优先。",
      "## 最低验证条件",
      "每个判断单元达到两类独立来源并覆盖主证、反证后停止扩展材料。",
    ].join("\n").padEnd(820, "机制、边界与区分信号。");
    const unitIds = ["JU-1", "JU-2"];
    const issues = collectStage02HighQualityIssues({
      research_logic_markdown: logic,
      document_markdown: logic,
      judgment_spine: "区分 HBM 与通用 DRAM 的需求拉动和供给挤占机制",
      judgment_units: unitIds.map((id) => ({
        id,
        title: id === "JU-1" ? "HBM" : "通用DRAM",
        question: "未来六个月是否改善",
      })),
      competing_explanations: unitIds.map((id) => ({
        explanation_id: `CE-${id}`,
        statement: "改善可能只是一次性补库而非终端真实消耗",
        judgment_unit_ids: [id],
        discriminating_evidence: ["终端消耗与渠道库存的多期对照"],
      })),
      counter_evidence_directions: unitIds.map((id) => ({
        id: `CD-${id}`,
        statement: "需求下修且库存重新累积",
        judgment_unit_ids: [id],
      })),
      evidence_requirements: unitIds.flatMap((id) => [
        { id: `ER-${id}-S`, requirement: "价格与库存序列", evidence_role: "support", judgment_unit_ids: [id] },
        { id: `ER-${id}-C`, requirement: "需求下修与库存累积", evidence_role: "counter", judgment_unit_ids: [id] },
      ]),
      method_applications: [
        { capability_type: "judgment_structure", method_id: "BF-SD-01" },
        { capability_type: "evidence", method_id: "kb03:A03" },
        { capability_type: "adjudication", method_id: "kb04:A03" },
      ],
      research_scope: { label: "存储周期 HBM/通用DRAM" },
      quality_status: "high_quality_pass",
      deterministic_check_status: "checked",
    });
    expect(issues.some((item) => item.code === "stop_condition_section_missing")).toBe(false);
  });

  it("01–04 knowledge injects 00A card and key appendices", () => {
    expect(registeredFiles("stage_01")).toContain("governance/03_校验/00A_runtime_quality_card.md");
    expect(registeredFiles("stage_02")).toContain("workflow/stages/02_结构/02_附录2_本体缺口扫描矩阵与处理细则.md");
    expect(registeredFiles("stage_03")).toContain("workflow/stages/03_证据/03_附录2_取数留痕与材料处理操作手册.md");
    expect(registeredFiles("stage_04")).toContain("governance/03_校验/00A_runtime_quality_card.md");
  });

  it("validate_run.py remains the formal publish authority", () => {
    const root = join(__dirname, "../..");
    const validateRun = join(root, "governance/03_校验/validate_run.py");
    expect(existsSync(validateRun)).toBe(true);
    // 工作台确认只保证 TS 门禁；正式 PUBLISHABLE 仍须跑 validate_run。
  });
});
