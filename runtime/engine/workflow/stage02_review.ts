import "server-only";

import { getRun, latestArtifact } from "../../adapters/db";
import { createResearchModelClient } from "../../adapters/deepseek";
import { ONTOLOGY_JUDGMENT_TYPES } from "../ontology_vocabulary.generated";
import {
  structureValidationResultSchema,
  type StructureValidationResultInput,
} from "../revise_schemas";
import { collectStage02ConsistencyIssues } from "../stage02_documents";
import { parseJson, type Artifact } from "../types";
import {
  heuristicStructureIssues,
  structureFromArtifact,
  structureValidationIssueConflictsWithContract,
} from "../workflow_revise";
import { createControlledStructureProjection } from "../workflow_projections";

export async function validateStage02ForApproval(
  runId: string,
  options: {
    createClient?: typeof createResearchModelClient;
    /** Test hook: return this validation result without calling the model. */
    validationResult?: StructureValidationResultInput;
    applySuggestedPatch?: boolean;
  } = {},
): Promise<StructureValidationResultInput & { artifact?: Artifact }> {
  const run = getRun(runId);
  if (!run) throw new Error("研究任务不存在");
  const stage01 = latestArtifact(runId, "stage_01", ["approved"]);
  if (!stage01) throw new Error("请先确认阶段 01");
  const stage02 = latestArtifact(runId, "stage_02", ["needs_review", "approved"]);
  if (!stage02) throw new Error("尚无待确认的判断结构");
  if (stage02.status !== "needs_review") throw new Error("只有待确认的判断结构可以做确认前校验");

  const scope = parseJson<any>(stage01.json_content, {});
  const structure = structureFromArtifact(stage02);
  const stage02Data = parseJson<any>(stage02.json_content, {});
  const heuristic = [
    ...heuristicStructureIssues(structure, scope),
    ...collectStage02ConsistencyIssues(stage02Data).map((item) => ({
      severity: item.severity as "error" | "warning",
      code: item.code,
      message: item.message,
      unit_id: undefined as string | undefined,
    })),
  ];

  let result = options.validationResult;
  if (!result && stage02.model_name === "human-controlled-structure-projection") {
    const errors = heuristic.filter((item) => item.severity === "error");
    result = {
      ok: errors.length === 0,
      summary: errors.length
        ? "人工受控结构未通过确定性确认前校验"
        : "人工受控结构已通过 Schema 与确定性确认前校验；未产生额外模型费用",
      issues: heuristic,
      suggested_patch: null,
    };
  }
  if (!result) {
    const client = (options.createClient || createResearchModelClient)("producer");
    const modelResult = await client.generateStructured(
      "structure_validate",
      structureValidationResultSchema,
      [
        "你是投研工作台的研究结构确认前校验器。检查当前 Stage02 是否可进入 Stage03。",
        "必须检查：1) 每个单元标题、原子问题、judgment_type 是否一致；2) 是否越出 Stage01 对象/动作/边界；3) 必要证据是否可执行并与问题匹配；4) 反向证据与竞争解释是否空洞或与单元矛盾。",
        "正式引用合同：units[].evidence_requirements 存放 EvidenceRequirement ID，必须到 current_structure.evidence_requirement_registry 按 id 解析；只要引用可解析且 requirement 具体，就不是占位符。",
        "正式字段合同：counter_evidence_directions 只要求 direction_id、statement、judgment_unit_ids；不要求 id、explanation_id 或 discriminating_evidence。",
        "正式字段合同：competing_explanations 只要求 explanation_id、statement、judgment_unit_ids、discriminating_evidence；不要求 id 或 direction_id。",
        "不得把正式合同未定义的字段当成必填项；suggested_patch 也必须严格服从上述合同。",
        "若存在 error 级问题，ok 必须为 false，并给出可直接落库的 suggested_patch（完整合同字段）。",
        "若仅有轻微 warning 且结构可用，ok 可为 true，suggested_patch 可为 null。",
        "issues.message 使用简洁中文。不要编造证据事实。",
      ].join("\n"),
      JSON.stringify({
        stage_01_scope: {
          normalized_question: scope.normalized_question,
          core_object: scope.core_object,
          judgment_action: scope.judgment_action,
          time_scope: scope.time_scope,
          boundaries: scope.boundaries,
          exclusions: scope.exclusions,
        },
        current_structure: structure,
        heuristic_issues: heuristic,
        allowed_judgment_types: ONTOLOGY_JUDGMENT_TYPES,
      }, null, 2),
    );
    result = modelResult.data;
  }

  const filteredContractNoise = result.issues.filter((issue) =>
    structureValidationIssueConflictsWithContract(issue, structure));
  if (filteredContractNoise.length) {
    result.issues = result.issues.filter((issue) =>
      !structureValidationIssueConflictsWithContract(issue, structure));
    if (!result.issues.some((issue) => issue.severity === "error")) {
      result.ok = true;
      result.suggested_patch = null;
      result.summary = `${result.summary}；已由 Runtime 过滤 ${filteredContractNoise.length} 条与正式字段/引用合同冲突的校验噪声`;
    }
  }

  // Merge heuristic errors the model might have missed.
  const codes = new Set(result.issues.map((item) => `${item.unit_id || ""}:${item.code}`));
  for (const issue of heuristic.filter((item) => item.severity === "error")) {
    const key = `${issue.unit_id || ""}:${issue.code}`;
    if (!codes.has(key)) {
      result.issues.push(issue);
      result.ok = false;
    }
  }

  if (result.ok) return { ...result };

  if (options.applySuggestedPatch && result.suggested_patch) {
    const artifact = createControlledStructureProjection(runId, {
      scope_label: result.suggested_patch.scope_label || structure.scope_label,
      units: result.suggested_patch.units.map((unit) => ({
        ...unit,
        id: unit.id ?? undefined,
      })),
      counter_evidence_directions: result.suggested_patch.counter_evidence_directions,
      competing_explanations: result.suggested_patch.competing_explanations,
    });
    const nextStructure = structureFromArtifact(artifact);
    const nextIssues = heuristicStructureIssues(nextStructure, scope);
    const remainingErrors = nextIssues.filter((item) => item.severity === "error");
    return {
      ok: remainingErrors.length === 0,
      summary: remainingErrors.length
        ? `${result.summary}；已写入建议补丁，但仍有待处理问题。`
        : `${result.summary}；已采纳建议补丁，可再次确认。`,
      issues: nextIssues.length ? nextIssues : result.issues,
      suggested_patch: remainingErrors.length ? result.suggested_patch : null,
      artifact,
    };
  }

  return { ...result };
}

