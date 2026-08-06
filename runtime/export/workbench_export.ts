import "server-only";
import type { RunManifest } from "./manifest";
import {
  normalizeCompetingExplanations,
  normalizeCounterEvidenceDirections,
  projectEvidenceRequirementsFromStructure,
} from "../agents/02_structure/structure_candidates";

type Json = Record<string, any>;

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export function projectTask(data: Json, manifest: RunManifest): Json {
  return {
    stage: "01",
    package_projection: "workbench_zod",
    task_id: manifest.task_id,
    question: data.normalized_question || data.question || "",
    normalized_question: data.normalized_question || "",
    core_object: data.core_object || "",
    judgment_action: data.judgment_action || "",
    time_scope: data.time_scope || {},
    boundaries: asArray<string>(data.boundaries),
    exclusions: asArray<string>(data.exclusions),
    domain_supported: Boolean(data.domain_supported),
    excluded_outputs: asArray<string>(data.exclusions),
  };
}

export function projectStructure(data: Json): Json {
  const units = asArray<Json>(data.judgment_units);
  const unitIds = units.map((unit) => String(unit.id || unit.judgment_unit_id || "")).filter(Boolean);
  return {
    stage: "02",
    package_projection: "workbench_zod",
    schema_version: "3.0.0",
    method_applications: asArray<Json>(data.method_applications),
    judgment_units: units.map((unit) => ({
      judgment_unit_id: unit.id || unit.judgment_unit_id,
      title: unit.title || "",
      question: unit.question || unit.statement || "",
      statement: unit.statement || unit.question || "",
      judgment_type: unit.judgment_type || "",
      ontology_node_ids: asArray<string>(unit.ontology_node_ids),
      evidence_requirements: asArray<string>(unit.evidence_requirements),
      evidence_requirement_refs: asArray<string>(unit.evidence_requirements),
    })),
    variables: asArray<Json>(data.variables),
    paths: asArray<Json>(data.paths),
    questions: asArray<Json>(data.questions).length
      ? asArray<Json>(data.questions)
      : (data.research_scope?.dimensions?.question || data.research_scope?.label
        ? [{ id: "RQ-01", statement: String(data.research_scope?.dimensions?.question || data.research_scope?.label) }]
        : []),
    evidence_requirements: asArray<Json>(data.evidence_requirements).length
      ? asArray<Json>(data.evidence_requirements)
      : projectEvidenceRequirementsFromStructure({
        units: units.map((unit) => ({
          id: String(unit.id || unit.judgment_unit_id || ""),
          evidence_requirements: unit.evidence_requirements,
        })),
        counter_evidence_directions: data.counter_evidence_directions,
      }),
    counter_evidence_directions: normalizeCounterEvidenceDirections(data.counter_evidence_directions, { unitIds }),
    competing_explanations: normalizeCompetingExplanations(data.competing_explanations, { unitIds }),
  };
}

export function projectEvidence(data: Json): Json {
  return {
    stage: "03",
    package_projection: "workbench_zod",
    schema_version: "3.0.0",
    method_applications: asArray<Json>(data.method_applications),
    sources: asArray<Json>(data.sources),
    evidence_drafts: asArray<Json>(data.evidence_drafts),
    unresolved_gaps: asArray<string>(data.unresolved_gaps),
  };
}

export function projectJudgment(data: Json): Json {
  return {
    stage: "04",
    package_projection: "workbench_zod",
    schema_version: "5.0.0",
    method_applications: asArray<Json>(data.method_applications),
    signals: asArray<Json>(data.signals),
    hypotheses: asArray<Json>(data.hypotheses),
    competing_explanations: asArray<Json>(data.competing_explanations),
    rule_evaluations: asArray<Json>(data.rule_evaluations),
    judgments: asArray<Json>(data.judgments).map((item) => ({
      ...item,
      judgment_id: item.judgment_id || item.id,
      method_application_refs: item.method_application_refs || item.method_application_ids || [],
      method_application_ids: item.method_application_ids || item.method_application_refs || [],
    })),
    reasoning_traces: asArray<Json>(data.reasoning_traces),
    overall_boundary: data.overall_boundary || "",
  };
}

export function projectExpression(data: Json): Json {
  return {
    stage: "05",
    package_projection: "workbench_zod",
    schema_version: "3.0.0",
    title: data.title || "",
    executive_points: asArray<string>(data.executive_points),
    report_claims: asArray<Json>(data.report_claims).map((item) => ({
      ...item,
      expression_id: item.expression_id || item.id,
      source_claim_id: item.source_claim_id || (item.judgment_ids || [])[0],
      judgment_ids: item.judgment_ids || (item.source_claim_id ? [item.source_claim_id] : []),
      source_method_application_refs: item.source_method_application_refs || item.method_application_ids || [],
      method_application_ids: item.method_application_ids || item.source_method_application_refs || [],
    })),
    limitations: asArray<string>(data.limitations),
  };
}

export function buildWorkbenchManifest(
  manifest: RunManifest,
  artifactFiles: Record<string, string[]>,
): Record<string, unknown> {
  return {
    schema_name: "controlled_research_run_manifest_workbench",
    schema_version: "1.0.0",
    package_kind: "workbench_export",
    task_id: manifest.task_id,
    run_id: manifest.run_id,
    parent_run: manifest.parent_run,
    run_mode: "workbench",
    producer_id: "runtime-workbench-export",
    contract_ref: {
      schema_name: "controlled_research_run_manifest",
      schema_version: "1.3.0",
    },
    versions: manifest.versions,
    stages: Object.fromEntries(
      Object.entries(manifest.stages).map(([stage, entry]) => [
        stage,
        {
          ...entry,
          artifact: artifactFiles[stage] || entry.artifact || [],
        },
      ]),
    ),
    reasoning_loop: manifest.reasoning_loop,
    validation_summary: {
      quality_pass: false,
      publishable: false,
      publish_status: "exported_pending_validate",
    },
    validation_target: "governance/03_校验/validate_workbench_package.py",
    artifacts: [
      "package_kind.yaml",
      "01_task.yaml",
      "02_structure.yaml",
      "03_evidence.yaml",
      "04_judgment.yaml",
      "05_expression.yaml",
      "05_report.md",
      "05-研究报告.md",
    ],
  };
}
