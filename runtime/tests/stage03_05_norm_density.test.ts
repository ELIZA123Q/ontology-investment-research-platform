import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import {
  evidencePreparationSchema,
  judgmentDecisionSchema,
  researchExpressionSchema,
} from "@/engine/schemas";
import {
  assertStage03ReadyForApproval,
  collectStage03ConsistencyIssues,
  ensureStage03DocumentFields,
} from "@/engine/stage03_documents";
import {
  assertStage04ReadyForApproval,
  collectStage04ConsistencyIssues,
  ensureStage04DocumentFields,
} from "@/engine/stage04_documents";
import {
  assertStage05ReadyForApproval,
  collectStage05ConsistencyIssues,
  ensureStage05DocumentFields,
} from "@/engine/stage05_documents";
import {
  syncStage03ReadableMarkdown,
  syncStage04ReadableMarkdown,
  syncStage05ReadableMarkdown,
} from "@/engine/readable_markdown";

const longMd = "# 标题\n\n".padEnd(80, "正文内容足够长以通过 markdown 最小长度约束。");

function publishableStage05Markdown(title = "库存趋势暂不可判断") {
  const denseGap = "当前缺少可核验的连续库存披露与同口径样本，证据缺口明确，不能把局部线索外推为行业改善结论。".repeat(8);
  return [
    `# ${title}`,
    "",
    "## 投资要点",
    "",
    "- **库存趋势暂不可判断。** 缺少可核验披露。",
    "",
    "## 核心结论概览",
    "",
    "| 项目 | 结论 |",
    "|---|---|",
    "| 当前判断 | 暂不可判断 |",
    "",
    "## 市场认知差 / Research Edge",
    "",
    "| 参考认识 | 本次差异化判断 | 被低估的机制 | 什么会证伪 | 证据边界 |",
    "|---|---|---|---|---|",
    "| 库存已改善 | 证据不足不能确认 | 公开披露缺失 | 连续两季库存下降 | 仅限已确认判断 |",
    "",
    "## 一、库存证据不足",
    "",
    denseGap,
    "",
    "## 二、验证与改判",
    "",
    denseGap,
    "",
    "## 投资含义与重点观察",
    "",
    "| 对象/环节 | 当前判断 | 关键依据 | 后续观察 | 主要风险 |",
    "|---|---|---|---|---|",
    "| 库存 | 暂不可判断 | 证据缺口 | 连续披露 | 外推 |",
    "",
    "## 催化、验证与风险",
    "",
    "### 未来重点观察",
    "",
    "| 当前基线 | 触发条件 | 对判断的影响 |",
    "|---|---|---|",
    "| 证据不足 | 连续两季库存下降 | 可转为方向性观察 |",
    "",
    "### 主要风险",
    "",
    "- 把缺口报告误写成方向性结论。",
    "",
    "## 主要资料来源",
    "",
    "- 本轮无可用公开来源。",
    "",
  ].join("\n");
}

function ma(stage: "stage_03" | "stage_04", status: "selected" | "blocked" | "executed" = "selected") {
  return {
    application_id: "MA-A02-01",
    method_id: "kb03:A02",
    method_version: "3.2.0",
    capability_type: stage === "stage_04" ? "adjudication" : "evidence",
    target_question_refs: ["Q-01"],
    target_judgment_unit_refs: ["JU-1"],
    target_ontology_object_refs: [],
    status,
    precondition_checks: status === "blocked"
      ? [{ precondition_id: "source_available", result: "fail", evidence_refs: ["GAP-1"], reason: "失败" }]
      : [{ precondition_id: "source_available", result: "pass", evidence_refs: ["EV-1"], reason: "通过" }],
    input_evidence_refs: status === "blocked" ? ["GAP-1"] : ["EV-1"],
    output_signal_refs: [],
    output_judgment_refs: status === "executed" ? ["J-1"] : [],
    execution_summary: status === "executed" ? "完成" : "",
    applicability_boundary: "测试",
    limitations: [],
    counter_example_refs: [],
    provenance: { stage, source_application_id: null, actor: "test", recorded_at: null },
    alternatives: status === "blocked"
      ? [{ method_id: "kb03:A02", decision: "retry", reason: "重试" }]
      : [],
  };
}

function leanStage03() {
  return {
    method_applications: [ma("stage_03", "blocked")],
    sources: [],
    evidence_drafts: [{
      id: "GAP-1",
      statement: "缺少可核验库存披露",
      kind: "gap",
      direction: "unknown",
      source_keys: [],
      source_ids: [],
      judgment_unit_ids: ["JU-1"],
      ontology_node_ids: ["SV-1"],
      requirement: "取得可定位库存披露",
      evidence_role: "boundary",
      minimum_independent_sources: 1,
      limitations: ["来源取得失败"],
    }],
    unresolved_gaps: ["缺少可核验库存披露"],
    document_markdown: longMd,
  };
}

function leanStage04() {
  const adjudication = {
    ...ma("stage_04", "executed"),
    application_id: "MA-A03-01",
    method_id: "kb04:A02",
    method_version: "1.0.0",
    capability_type: "adjudication",
    input_evidence_refs: [],
    output_judgment_refs: ["J-1"],
    precondition_checks: [],
    alternatives: [],
  };
  return {
    method_applications: [adjudication],
    signals: [],
    hypotheses: [{
      id: "H-1",
      statement: "库存变化可能代表趋势改善",
      signal_ids: [],
      falsification_conditions: ["库存重新上升"],
      time_horizon: "未来一个季度",
    }],
    competing_explanations: [{
      id: "CE-1",
      statement: "只是季节性波动",
      signal_ids: [],
      discriminating_evidence: ["连续两季库存下降"],
      status: "active",
      elimination_rationale: "",
    }],
    rule_evaluations: [{
      id: "RE-1",
      rule_ref: "judgment_status_consistency",
      input_refs: ["J-1"],
      condition_results: [{
        condition_id: "C-1",
        expression: "status consistent",
        input_refs: ["J-1"],
        outcome: "pass",
        rationale: "一致",
      }],
      result: "pass",
      deterministic_result: null,
    }],
    judgments: [{
      id: "J-1",
      judgment_unit_id: "JU-1",
      title: "库存趋势",
      conclusion: "暂不可判断",
      rationale: "证据不足",
      strength: "J0",
      confidence: "low",
      decision_status: "blocked",
      conflict_status: "none",
      not_judgeable_reason: "缺少可核验库存披露",
      scope_ref: "SCOPE-1",
      cutoff_at: "2026-07-18T08:00:00Z",
      conditions: [],
      supporting_evidence_draft_ids: [],
      counter_evidence_draft_ids: [],
      hypothesis_ids: ["H-1"],
      rule_evaluation_ids: ["RE-1"],
      method_application_ids: ["MA-A03-01"],
      ontology_node_ids: [],
      uncertainties: ["证据缺口"],
      invalidation_conditions: ["取得连续两季库存披露"],
      tracking_signals: [],
    }],
    reasoning_traces: [{
      id: "RT-1",
      judgment_id: "J-1",
      node_ids: ["J-1", "MA-A03-01"],
      created_at: "2026-07-18T08:00:00Z",
    }],
    overall_boundary: "仅登记暂不可判断，不外推。",
    document_markdown: longMd,
  };
}

describe("stage03/04/05 norm density", () => {
  it("rejects missing preparation / audit documents and readiness conflicts", () => {
    const data: any = leanStage03();
    ensureStage03DocumentFields(data);
    data.preparation_markdown = "短";
    data.document_markdown = "短";
    data.instance_manifest_yaml = "";
    data.quality_status = "minimum_pass";
    data.evidence_readiness = "not_ready";
    data.allowed_05_output = "full_report";
    expect(collectStage03ConsistencyIssues(data).some((item) => item.code === "missing_preparation")).toBe(true);
    expect(collectStage03ConsistencyIssues(data).some((item) => item.code === "readiness_output_conflict")).toBe(true);
    expect(() => evidencePreparationSchema.parse(data)).toThrow();
  });

  it("upgrades lean stage03 via ensure/sync for approval path", () => {
    const data: any = leanStage03();
    syncStage03ReadableMarkdown(data, {
      question: "库存是否改善？",
      structure: { judgment_units: [{ id: "JU-1", title: "库存" }] },
    });
    expect(data.preparation_markdown).toContain("数据与证据准备");
    expect(data.instance_manifest_yaml).toContain("cross_domain_runtime_instance_manifest");
    expect(data.document_markdown).toBe(data.preparation_markdown);
    expect(data.allowed_05_output).toBe("gap_report_only");
    expect(data.evidence_readiness).toBe("not_ready");
    data.preparation_markdown = "# 数据与证据准备\n\n".padEnd(820, "覆盖范围、缺口与交给 04 的上限说明。");
    data.document_markdown = data.preparation_markdown;
    data.quality_status = "high_quality_pass";
    data.deterministic_check_status = "checked";
    ensureStage03DocumentFields(data, {
      question: "库存是否改善？",
      structure: { judgment_units: [{ id: "JU-1", title: "库存" }] },
    });
    data.quality_status = "high_quality_pass";
    data.deterministic_check_status = "checked";
    data.preparation_markdown = "# 数据与证据准备\n\n".padEnd(820, "覆盖范围、缺口与交给 04 的上限说明。");
    data.document_markdown = data.preparation_markdown;
    data.evidence_quality_gate = {
      passed: true,
      quality_status: "high_quality_pass",
      total_evidence: 5,
      source_groups: 3,
      direct_facts: 2,
    };
    data.evidence_quality_summary = "证据充分（测试夹具）";
    expect(() => evidencePreparationSchema.parse(data)).not.toThrow();
    expect(() => assertStage03ReadyForApproval(data)).not.toThrow();
    data.quality_status = "return_required";
    expect(() => assertStage03ReadyForApproval(data)).toThrow(/可交接密度|quality_status/);
  });

  it("fails stage04 when brief/audit judgment ids drift", () => {
    const data: any = leanStage04();
    syncStage04ReadableMarkdown(data, { question: "库存是否改善？" });
    data.judgment_brief_markdown = "# 判断简报\n\n".padEnd(820, "一句话结论、对象分化、主路径与竞争解释，并写明改判条件。");
    data.document_markdown = data.judgment_brief_markdown;
    data.object_differentiation = "库存对象单独观察，不做行业均值替代";
    data.primary_path_ruling = "证据不足，维持不可判断";
    data.investment_proposition = "等待可核验库存披露后再更新假设；改判条件为连续两季同口径改善";
    data.expression_permission = {
      allowed_core_claims: ["暂不可判断"],
      allowed_mechanisms: [],
      prohibited_claims: ["确定见顶"],
      restricted_phrasing: ["不得写成已确认"],
      max_expression_level: "J0",
      notes: "不抬升",
    };
    data.quality_status = "high_quality_pass";
    data.deterministic_check_status = "checked";
    data.brief_quality_check_result = "pass";
    expect(() => judgmentDecisionSchema.parse(data)).not.toThrow();
    expect(() => assertStage04ReadyForApproval(data)).not.toThrow();
    data.reasoning_audit_yaml = data.reasoning_audit_yaml.replaceAll("J-1", "J-MISSING");
    expect(collectStage04ConsistencyIssues(data).some((item) => item.code === "judgment_missing_in_audit")).toBe(true);
    expect(() => assertStage04ReadyForApproval(data)).toThrow(/推理审计/);
  });

  it("fails stage05 when expression audit misses report_claims", () => {
    const data: any = {
      title: "研究报告",
      executive_points: ["暂不可判断"],
      report_claims: [{
        id: "RC-01",
        statement: "库存趋势暂不可判断",
        judgment_ids: ["J-1"],
        method_application_ids: ["MA-A03-01"],
        evidence_draft_ids: [],
        source_ids: [],
      }],
      limitations: ["证据不足"],
      document_markdown: publishableStage05Markdown(),
      quality_status: "high_quality_pass",
      deterministic_check_status: "checked",
      research_edge: [{
        market_view: "库存已改善",
        differentiated_view: "证据不足不能确认改善",
        underestimated_mechanism: "口径与样本缺口",
        falsifier: "取得连续披露",
        evidence_boundary: "仅公开材料",
      }],
    };
    ensureStage05DocumentFields(data, { question: "库存是否改善？" });
    data.quality_status = "high_quality_pass";
    data.deterministic_check_status = "checked";
    expect(() => researchExpressionSchema.parse(data)).not.toThrow();
    expect(() => assertStage05ReadyForApproval(data, { requirePublishableStructure: true })).not.toThrow();
    data.expression_audit_yaml = data.expression_audit_yaml.replace("RC-01", "RC-XX");
    expect(collectStage05ConsistencyIssues(data).some((item) => item.code === "claim_missing_in_audit")).toBe(true);
    expect(() => assertStage05ReadyForApproval(data)).toThrow(/表达审计/);
  });

  it("rejects intensity_lifted in expression audit", () => {
    const data: any = {
      title: "研究报告",
      executive_points: ["要点"],
      report_claims: [{
        id: "RC-01",
        statement: "陈述",
        judgment_ids: ["J-1"],
        method_application_ids: ["MA-A03-01"],
        evidence_draft_ids: [],
        source_ids: [],
      }],
      limitations: [],
      document_markdown: publishableStage05Markdown(),
    };
    ensureStage05DocumentFields(data);
    data.expression_audit_yaml = data.expression_audit_yaml.replace("intensity_lifted: false", "intensity_lifted: true");
    expect(collectStage05ConsistencyIssues(data).some((item) => item.code === "intensity_lifted")).toBe(true);
  });

  it("requires Research Edge and fixed sections for high_quality_pass / approval", () => {
    const data: any = {
      title: "研究报告",
      executive_points: ["暂不可判断"],
      report_claims: [{
        id: "RC-01",
        statement: "库存趋势暂不可判断",
        judgment_ids: ["J-1"],
        method_application_ids: ["MA-A03-01"],
        evidence_draft_ids: [],
        source_ids: [],
      }],
      limitations: ["证据不足"],
      document_markdown: "# 短稿\n\n只有标题没有固定节与论点章，不能算正式研报。",
      quality_status: "high_quality_pass",
    };
    ensureStage05DocumentFields(data);
    expect(data.quality_status).toBe("minimum_pass");
    const structureCodes = collectStage05ConsistencyIssues(data).map((item) => item.code);
    expect(structureCodes.some((code) => code === "missing_fixed_section" || code === "argument_chapter_count")).toBe(true);
    expect(() => assertStage05ReadyForApproval(data, { requirePublishableStructure: true })).toThrow(/可交接密度|固定节|论点章|结构/);

    data.document_markdown = publishableStage05Markdown();
    data.quality_status = "high_quality_pass";
    data.deterministic_check_status = "checked";
    data.research_edge = [{
      market_view: "库存已改善",
      differentiated_view: "证据不足不能确认改善",
      underestimated_mechanism: "口径与样本缺口",
      falsifier: "取得连续披露",
      evidence_boundary: "仅公开材料",
    }];
    data.expression_audit_yaml = "";
    ensureStage05DocumentFields(data);
    data.quality_status = "high_quality_pass";
    data.deterministic_check_status = "checked";
    expect(data.document_markdown).toContain("Research Edge");
    expect(data.document_markdown).not.toContain("J1/supported");
    expect(data.document_markdown).not.toContain("审计索引");
    expect(() => assertStage05ReadyForApproval(data, { requirePublishableStructure: true })).not.toThrow();
  });

  it("syncStage05 does not flatten an existing publishable report", () => {
    const body = publishableStage05Markdown("稀缺定价强化期");
    const data: any = {
      title: "稀缺定价强化期",
      executive_points: ["稀缺定价"],
      report_claims: [{
        id: "RC-01",
        statement: "稀缺定价强化",
        judgment_ids: ["J-1"],
        method_application_ids: ["MA-A03-01"],
        evidence_draft_ids: [],
        source_ids: [],
      }],
      limitations: [],
      document_markdown: body,
    };
    syncStage05ReadableMarkdown(data, "库存是否改善？");
    expect(data.document_markdown).toContain("## 市场认知差 / Research Edge");
    expect(data.document_markdown).toContain("稀缺定价强化期");
    expect(data.document_markdown).not.toContain("---\n");
    expect(data.document_markdown).not.toContain("判断依据与改判条件");
  });
});

describe("stage03/04/05 archive naming", () => {
  it("uses Chinese dual-product filenames", async () => {
    process.env.WORKBENCH_DB_PATH = `/tmp/ontology-workbench-archive-norm-${process.pid}.sqlite`;
    process.env.WORKBENCH_EXPORT_ROOT = `/tmp/ontology-workbench-archive-norm-exports-${process.pid}`;
    const db = await import("@/adapters/db");
    const { buildRunArchive } = await import("@/engine/run_archive");
    const run = db.createRun("归档命名", "semiconductor");
    const s03: any = leanStage03();
    syncStage03ReadableMarkdown(s03);
    db.createArtifact(run.id, "stage_03", {
      status: "approved",
      json_content: JSON.stringify(s03),
      markdown_content: s03.document_markdown,
    });
    const s04: any = leanStage04();
    syncStage04ReadableMarkdown(s04);
    db.createArtifact(run.id, "stage_04", {
      status: "approved",
      json_content: JSON.stringify(s04),
      markdown_content: s04.document_markdown,
    });
    const s05: any = {
      title: "研究报告",
      executive_points: ["暂不可判断"],
      report_claims: [{
        id: "RC-01",
        statement: "库存趋势暂不可判断",
        judgment_ids: ["J-1"],
        method_application_ids: ["MA-A03-01"],
        evidence_draft_ids: [],
        source_ids: [],
      }],
      limitations: ["证据不足"],
      document_markdown: publishableStage05Markdown(),
    };
    ensureStage05DocumentFields(s05);
    syncStage05ReadableMarkdown(s05, "库存是否改善？");
    db.createArtifact(run.id, "stage_05", {
      status: "approved",
      json_content: JSON.stringify(s05),
      markdown_content: s05.document_markdown,
    });
    const archive = buildRunArchive(run.id);
    const names = archive.files.map((f) => f.file_name);
    expect(names).toContain("03-数据与证据准备.md");
    expect(names).toContain("03-语义域与证据域实例清单.yaml");
    expect(names).toContain("03-证据快照摘要.yaml");
    expect(names).toContain("04-判断简报.md");
    expect(names).toContain("04-推理审计.yaml");
    expect(names).toContain("05-研究报告.md");
    expect(names).toContain("05-表达审计.yaml");
  });
});
