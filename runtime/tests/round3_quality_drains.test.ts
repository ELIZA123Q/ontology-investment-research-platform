import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import { sanitizeAuditVoice } from "@/engine/expression_audit";
import {
  compactStage03ForUpstream,
  shouldAbortStage03Batching,
  shouldRetryRuntimeFailure,
} from "@/engine/workflow_support";
import { collectStage03ConsistencyIssues } from "@/engine/stage03_documents";
import { looksLikePlaceholder } from "@/engine/stage_high_quality";
import { ensureStage04DocumentFields } from "@/engine/stage04_documents";

describe("round3 quality drains", () => {
  it("aborts remaining Stage03 batches on provider-wide or lease failures", () => {
    expect(shouldAbortStage03Batching(new Error("402 Insufficient Balance"))).toBe(true);
    expect(shouldAbortStage03Batching(new Error("GENERATION_LEASE_LOST"))).toBe(true);
    expect(shouldAbortStage03Batching(new Error("[structured_schema_contract] invalid"))).toBe(true);
    expect(shouldAbortStage03Batching(new Error("400 Thinking mode does not support this tool_choice"))).toBe(true);
    expect(shouldAbortStage03Batching(new Error("某个公开网页抓取失败"))).toBe(false);
  });

  it("does not retry paid jobs after provider-wide or contract failures", () => {
    expect(shouldRetryRuntimeFailure(new Error("402 Insufficient Balance"))).toBe(false);
    expect(shouldRetryRuntimeFailure(new Error("401 invalid api key"))).toBe(false);
    expect(shouldRetryRuntimeFailure(new Error("[structured_schema_contract] invalid"))).toBe(false);
    expect(shouldRetryRuntimeFailure(new Error("400 Thinking mode does not support this tool_choice"))).toBe(false);
    expect(shouldRetryRuntimeFailure(new Error("GENERATION_LEASE_LOST"))).toBe(false);
    expect(shouldRetryRuntimeFailure(new Error("模型返回了不合法 JSON"))).toBe(true);
    expect(shouldRetryRuntimeFailure(new Error("某个公开网页抓取失败"))).toBe(true);
  });

  it("sanitizeAuditVoice does not rewrite ordinary English blocked", () => {
    const body = "BIS export controls blocked shipments to listed fabs in 2023.";
    expect(sanitizeAuditVoice(body)).toContain("blocked shipments");
    expect(sanitizeAuditVoice("状态 J2/supported 可写")).not.toMatch(/J2\/supported/);
    expect(sanitizeAuditVoice("结论： supported 。")).toContain("有证据支持");
  });

  it("upstream stage03 keeps preparation excerpt and more samples", () => {
    const compacted: any = compactStage03ForUpstream({
      preparation_markdown: "准备说明：覆盖、缺口与上限。".repeat(20),
      evidence_drafts: Array.from({ length: 10 }, (_, i) => ({
        id: `EV-${i + 1}`,
        kind: i === 9 ? "counter" : "fact_draft",
        judgment_unit_ids: ["JU-1"],
      })),
      evidence_bundles: [{
        judgment_unit_id: "JU-1",
        support_evidence_ids: Array.from({ length: 9 }, (_, i) => `EV-${i + 1}`),
        counter_evidence_ids: ["EV-10"],
        gap_ids: [],
      }],
      evidence_summaries: [{ id: "ES-1" }],
    }, 6);
    expect(compacted.preparation_excerpt).toContain("准备说明");
    expect(compacted.evidence_drafts.length).toBeGreaterThan(2);
    expect(compacted.evidence_drafts.some((d: any) => d.id === "EV-10")).toBe(true);
  });

  it("stage03 does not confuse acquisition channel with source authority", () => {
    const issues = collectStage03ConsistencyIssues({
      preparation_markdown: "# 准备\n\n".padEnd(820, "x"),
      document_markdown: "# 准备\n\n".padEnd(820, "x"),
      instance_manifest_yaml: "metadata:\n  task_id: T\n",
      evidence_drafts: [{ id: "EV-1", kind: "fact_draft", statement: "价涨", source_keys: ["SRC-1"] }],
      quality_status: "high_quality_pass",
      deterministic_check_status: "checked",
      mcp_channel_usage: { mcp_evidence_calls: 0, web_search_calls: 3 },
      evidence_quality_gate: { passed: true, quality_status: "high_quality_pass" },
    });
    expect(issues.some((item) => item.code === "mcp_channel_missing")).toBe(false);
    expect(issues.some((item) => item.severity === "error" && item.code === "acquisition_telemetry_missing")).toBe(false);
  });

  it("HQ ensure does not scaffold object_differentiation placeholders", () => {
    const data = ensureStage04DocumentFields({
      judgments: [{ id: "J1", title: "主判断", conclusion: "有条件上行", strength: "J2", invalidation_conditions: ["价跌"] }],
      competing_explanations: [{ explanation_id: "CE-1", statement: "需求脉冲", status: "active" }],
      judgment_brief_markdown: "# 简报\n\n".padEnd(820, "对象分化与主路径与改判条件。"),
      quality_status: "high_quality_pass",
      brief_quality_check_result: "pass",
      expression_permission: {
        allowed_core_claims: ["J1"],
        allowed_mechanisms: ["供给约束"],
        prohibited_claims: ["确定见顶"],
        restricted_phrasing: ["不得写成已确认"],
        max_expression_level: "J2",
      },
    });
    // 未手写研究字段时不得自动填脚手架；HQ 应降档或字段为空
    expect(data.object_differentiation || "").toBe("");
    expect(looksLikePlaceholder("尚未形成对象分化。")).toBe(true);
  });
});
