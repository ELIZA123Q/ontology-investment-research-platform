import { mkdtempSync, readFileSync, rmSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { buildFormalPackNames, formalThemeSlug } from "../engine/formal_pack_naming";
import { formalStageHash } from "../engine/formal_pack_hash";
import { projectFormalSnapshot, SNAPSHOT_CSV_LAYOUT } from "../engine/formal_snapshot_project";
import {
  buildQualityRetryNotes,
  markGenerationBelowHighQuality,
  meetsHighQualityForReview,
} from "../engine/stage_hq_retry";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("formal pack naming", () => {
  it("builds 7:13-style Chinese filenames", () => {
    const names = buildFormalPackNames({
      theme: "存储芯片周期",
      date: "20260713",
      seq: 1,
      deliveryPrimary: "industry_cycle_report",
    });
    expect(names.stage01Md).toBe("01-存储芯片周期投研需求说明-20260713-1.md");
    expect(names.stage03SnapshotDir).toBe("03-存储芯片周期数据与证据快照-20260713-1");
    expect(names.stage05ReportMd).toBe("05-存储芯片周期行业周期判断-20260713-1.md");
    expect(names.stage05SemanticReviewYaml).toBe("05-存储芯片周期独立语义审查-20260713-1.yaml");
  });

  it("slugs theme from core object", () => {
    expect(formalThemeSlug({ core_object: "全球存储芯片中的 HBM、DRAM" })).toContain("存储");
  });
});

describe("formal pack manifest hashes", () => {
  it("matches the Python formal validator for files and directories", () => {
    const root = mkdtempSync(path.join(tmpdir(), "formal-hash-"));
    tempDirs.push(root);
    writeFileSync(path.join(root, "01-a.md"), "alpha\n", "utf8");
    mkdirSync(path.join(root, "03-snapshot"), { recursive: true });
    writeFileSync(path.join(root, "03-snapshot", "b.csv"), "x,y\n1,2\n", "utf8");
    const tsHash = formalStageHash(root, ["01-a.md", "03-snapshot"]);
    const repoRoot = path.resolve(__dirname, "../..");
    const py = [
      "from pathlib import Path",
      "import sys",
      `sys.path.insert(0, str(Path(${JSON.stringify(repoRoot)}) / 'governance' / '03_校验'))`,
      "from validate_run import _stage_hash",
      `root=Path(${JSON.stringify(root)})`,
      "print(_stage_hash([root/'01-a.md', root/'03-snapshot'], root))",
    ].join(";");
    const result = spawnSync("python3", ["-c", py], { encoding: "utf8", cwd: repoRoot });
    expect(result.status).toBe(0);
    expect(String(result.stdout || "").trim()).toBe(tsHash);
  });
});

describe("formal snapshot projection", () => {
  it("writes all required CSV layout files", () => {
    const root = mkdtempSync(path.join(tmpdir(), "formal-snap-"));
    tempDirs.push(root);
    const names = buildFormalPackNames({ theme: "测试主题", date: "20260724", seq: 1 });
    const snapshotDir = path.join(root, names.stage03SnapshotDir);
    const result = projectFormalSnapshot({
      snapshotDir,
      names,
      runId: "run-test",
      structure: {
        judgment_units: [{ id: "JU-01", title: "周期阶段" }],
        evidence_requirements: [{ id: "ER-01", statement: "价格证据", judgment_unit_ids: ["JU-01"] }],
        variables: [{ id: "SV-01", name: "price" }],
      },
      evidence: {
        evidence_drafts: [{
          id: "EV-01",
          kind: "fact_draft",
          statement: "价格上行",
          judgment_unit_ids: ["JU-01"],
          source_ids: ["SRC-1"],
        }],
        unresolved_gaps: [],
        evidence_readiness: "partial",
        delivery_readiness: "partial",
        quality_status: "high_quality_pass",
        deterministic_check_status: "checked",
        delivery_materials: { chart_candidates: [], table_candidates: [], source_annotation_candidates: [] },
      },
      sources: [{
        id: "SRC-1",
        run_id: "run-test",
        url: "https://example.com/a",
        normalized_url: "https://example.com/a",
        title: "Example",
        publisher: "Example",
        published_at: "2026-01-01T00:00:00.000Z",
        source_type: "web",
        source_tier: "S5",
        locator: "p1",
        source_quote: "价格上行示例摘录足够长度用于测试",
        content_hash: "abc",
        captured_at: "2026-01-01T00:00:00.000Z",
        retrieval_status: "captured",
        quote_verified: true,
      } as any],
    });
    expect(result.snapshotDirName).toBe(names.stage03SnapshotDir);
    for (const rel of Object.values(SNAPSHOT_CSV_LAYOUT)) {
      expect(existsSync(path.join(snapshotDir, rel))).toBe(true);
    }
    const manifest = readFileSync(path.join(snapshotDir, "manifest.csv"), "utf8");
    expect(manifest).toContain("03-测试主题数据与证据准备-20260724-1.md");
  });
});

describe("stage HQ retry helpers", () => {
  it("marks below-HQ generations as return_required", () => {
    const next = markGenerationBelowHighQuality({ quality_status: "minimum_pass" }, [
      { severity: "error", code: "thin", message: "正文过短" },
    ]);
    expect(next.quality_status).toBe("return_required");
    expect(next.return_required).toBe(true);
    expect(buildQualityRetryNotes([{ severity: "error", code: "thin", message: "正文过短" }])[0]).toContain("thin");
  });

  it("requires explicit high_quality_pass for review readiness", () => {
    expect(meetsHighQualityForReview("stage_01", {
      quality_status: "minimum_pass",
      research_value_gate: { status: "pass", incremental_question: "增量问题足够长", decision_use: "内部跟踪", decisive_variables: ["价格"], disagreements_or_unknowns: ["库存"] },
      delivery_archetype: { primary: "industry_cycle_report" },
      document_markdown: "x".repeat(500),
      deterministic_check_status: "checked",
      overscope_check: { status: "pass" },
    })).toBe(false);
  });
});

describe("formal pack discovery and semantic review mapping", () => {
  it("refuses batch verdict mapping without semantic_checks", async () => {
    const { mapIndependentReviewToSemanticYaml } = await import("../engine/formal_semantic_review");
    const YAML = (await import("yaml")).default;
    const yamlText = mapIndependentReviewToSemanticYaml({
      reviewData: {
        verdict: "pass",
        summary: "边界清楚，可交付",
        reviewer_model: "reviewer-model",
        reviewer_type: "model",
      },
      stageHashes: {
        stage_02: "sha256:a",
        stage_03: "sha256:b",
        stage_04: "sha256:c",
        stage_05: "sha256:d",
      },
      contractVersion: "1.3.0",
      producerId: "producer-model",
    });
    const parsed = YAML.parse(yamlText);
    expect(parsed.schema_name).toBe("independent_semantic_review");
    expect(parsed.verdict).toBe("needs_human");
    expect(parsed.reviewer.independent_from_producer).toBe(true);
    expect(parsed.reviewer.reviewer_id).not.toBe("producer-model");
    expect(parsed.checks).toHaveLength(5);
    expect(parsed.checks.every((c: any) => c.result === "needs_human")).toBe(true);
    expect(parsed.notes).toMatch(/拒绝批量|五项/);
  });

  it("exports real semantic_checks when complete", async () => {
    const { mapIndependentReviewToSemanticYaml } = await import("../engine/formal_semantic_review");
    const YAML = (await import("yaml")).default;
    const checks = [
      "local_evidence_not_globalized",
      "parent_aggregation_complete",
      "incremental_update_is_local_first",
      "title_represents_major_scopes",
      "conditions_scope_and_prohibitions_preserved",
    ].map((check_id) => ({
      check_id,
      result: "pass",
      reason: `${check_id} 已核对，未见违规`,
    }));
    const yamlText = mapIndependentReviewToSemanticYaml({
      reviewData: {
        verdict: "pass",
        reviewer_model: "reviewer-model",
        reviewer_type: "model",
        semantic_checks: checks,
      },
      stageHashes: {
        stage_02: "sha256:a",
        stage_03: "sha256:b",
        stage_04: "sha256:c",
        stage_05: "sha256:d",
      },
      contractVersion: "1.3.0",
      producerId: "producer-model",
    });
    const parsed = YAML.parse(yamlText);
    expect(parsed.verdict).toBe("pass");
    expect(parsed.checks).toHaveLength(5);
    expect(parsed.checks[0].reason).toContain("local_evidence");
  });

  it("detect_package_kind recognizes workbench formal layout as formal_pack", () => {
    const root = mkdtempSync(path.join(tmpdir(), "formal-detect-"));
    tempDirs.push(root);
    const names = buildFormalPackNames({ theme: "存储芯片周期", date: "20260724", seq: 1 });
    const packDir = path.join(root, names.dirName);
    mkdirSync(packDir, { recursive: true });
    writeFileSync(path.join(packDir, names.stage01Md), "# 投研需求说明\n", "utf8");
    writeFileSync(path.join(packDir, names.stage02LogicMd), "# 研究逻辑\n", "utf8");
    writeFileSync(
      path.join(packDir, "run_manifest.yaml"),
      [
        "schema_name: controlled_research_run_manifest",
        "schema_version: '1.3.0'",
        "package_kind: formal_pack",
        "run_id: EXEC-test",
      ].join("\n"),
      "utf8",
    );
    const repoRoot = path.resolve(__dirname, "../..");
    const py = [
      "from pathlib import Path",
      "import sys",
      `sys.path.insert(0, str(Path(${JSON.stringify(repoRoot)}) / 'governance' / '03_校验'))`,
      "from package_kind import detect_package_kind, KIND_FORMAL",
      `print(detect_package_kind(${JSON.stringify(packDir)}))`,
      "print(KIND_FORMAL)",
    ].join(";");
    const result = spawnSync("python3", ["-c", py], { encoding: "utf8", cwd: repoRoot });
    expect(result.status).toBe(0);
    const lines = String(result.stdout || "").trim().split("\n");
    expect(lines[0]).toBe(lines[1]);
    expect(lines[0]).toMatch(/formal/i);
  });
});
