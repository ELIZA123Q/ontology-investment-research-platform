import "server-only";

import { readFileSync } from "node:fs";
import YAML from "yaml";
import { repositoryPath } from "../adapters/repo-paths";
import type { MethodApplication, MethodApplicationStatus, StageKind } from "./types";

const FINAL_STATUSES = new Set<MethodApplicationStatus>(["executed", "rejected", "blocked", "degraded"]);
const FAILURE_STATUSES = new Set<MethodApplicationStatus>(["rejected", "blocked", "degraded"]);

export type MethodApplicationValidationContext = {
  prior?: MethodApplication[];
  evidenceIds?: Set<string>;
  judgmentIds?: Set<string>;
  signalIds?: Set<string>;
  evidenceDrafts?: Array<{ id: string; source_ids?: string[]; source_keys?: string[] }>;
  sourceGroupById?: Map<string, string>;
  ontologyObjectIds?: Set<string>;
};

type ExecutableMethodProfile = Record<string, {
  minimumEvidenceFacts: number;
  minimumIndependentSourceGroups: number;
  requiredPreconditions: string[];
}>;

let cachedExecutableMethods: ExecutableMethodProfile | null = null;

function loadExecutableMethodProfile(): ExecutableMethodProfile {
  if (cachedExecutableMethods) return cachedExecutableMethods;
  const profile = YAML.parse(
    readFileSync(repositoryPath("governance", "02_合同", "runtime_supported_profile.yaml"), "utf8"),
  ) as { executable_method_profile?: Record<string, {
    minimum_evidence?: number;
    minimum_evidence_facts?: number;
    minimum_independent_source_groups?: number;
    required_preconditions?: string[];
  }> };
  const loaded: ExecutableMethodProfile = {};
  for (const [methodId, definition] of Object.entries(profile.executable_method_profile || {})) {
    loaded[methodId] = {
      minimumEvidenceFacts: Number(definition.minimum_evidence_facts ?? definition.minimum_evidence ?? 0),
      minimumIndependentSourceGroups: Number(definition.minimum_independent_source_groups ?? definition.minimum_evidence ?? 0),
      requiredPreconditions: [...(definition.required_preconditions || [])],
    };
  }
  cachedExecutableMethods = loaded;
  return loaded;
}

export function methodApplicationIndex(applications: MethodApplication[]): Map<string, MethodApplication> {
  const result = new Map<string, MethodApplication>();
  for (const application of applications) {
    const duplicatePreconditions = application.precondition_checks
      .map((item) => item.precondition_id)
      .filter((id, index, all) => all.indexOf(id) !== index);
    if (duplicatePreconditions.length) throw new Error(`${application.application_id} 前置条件 ID 重复: ${duplicatePreconditions.join(", ")}`);
    if (result.has(application.application_id)) {
      throw new Error(`方法应用 ID 重复: ${application.application_id}`);
    }
    result.set(application.application_id, application);
  }
  return result;
}

function validateTransition(prior: MethodApplication, current: MethodApplication, stage: StageKind) {
  if (prior.method_id !== current.method_id || prior.method_version !== current.method_version) {
    throw new Error(`${current.application_id} 的方法 ID/版本不得跨阶段漂移`);
  }
  if (prior.capability_type !== current.capability_type) {
    throw new Error(`${current.application_id} 的能力类型不得跨阶段漂移`);
  }
  for (const field of ["target_question_refs", "target_judgment_unit_refs"] as const) {
    if (JSON.stringify(prior[field]) !== JSON.stringify(current[field])) {
      throw new Error(`${current.application_id}.${field} 不得跨阶段漂移`);
    }
  }
  const removedObjects = prior.target_ontology_object_refs.filter(
    (ref) => !current.target_ontology_object_refs.includes(ref),
  );
  if (removedObjects.length) {
    throw new Error(`${current.application_id}.target_ontology_object_refs 只允许追加: ${removedObjects.join(", ")}`);
  }
  const allowed: Record<MethodApplicationStatus, Set<MethodApplicationStatus>> = {
    candidate: new Set(["candidate", "selected", "executed", "rejected", "blocked", "degraded"]),
    selected: new Set(["selected", "executed", "rejected", "blocked", "degraded"]),
    executed: new Set(["executed"]),
    rejected: new Set(["rejected"]),
    blocked: new Set(["blocked"]),
    degraded: new Set(["degraded", "executed", "rejected", "blocked"]),
  };
  if (!allowed[prior.status].has(current.status)) {
    throw new Error(`${current.application_id} 非法状态迁移: ${prior.status} -> ${current.status} (${stage})`);
  }
}

function assertRefsExist(application: MethodApplication, refs: string[], known: Set<string>, label: string) {
  for (const ref of refs) {
    if (!known.has(ref)) throw new Error(`${application.application_id} 引用了不存在的${label} ${ref}`);
  }
}

export function validateMethodApplications(
  stage: Extract<StageKind, "stage_02" | "stage_03" | "stage_04">,
  applications: MethodApplication[],
  context: MethodApplicationValidationContext = {},
): Map<string, MethodApplication> {
  if (!applications.length) throw new Error(`${stage} 至少需要一项 MethodApplication`);
  const current = methodApplicationIndex(applications);
  const prior = methodApplicationIndex(context.prior || []);
  const executableMethods = loadExecutableMethodProfile();

  if (stage !== "stage_02") {
    const silentlyDropped = [...prior.keys()].filter((applicationId) => !current.has(applicationId));
    if (silentlyDropped.length) {
      throw new Error(`${stage} 不得静默删除方法应用: ${silentlyDropped.join(", ")}`);
    }
  }

  for (const application of applications) {
    if (application.provenance.stage !== stage) {
      throw new Error(`${application.application_id}.provenance.stage 必须为 ${stage}`);
    }
    if (stage === "stage_02") {
      if (application.status !== "candidate") {
        throw new Error(`${application.application_id} 在 stage_02 只能是 candidate`);
      }
      if (application.provenance.source_application_id !== null) {
        throw new Error(`${application.application_id} 在 stage_02 不得声明来源方法应用`);
      }
      if (
        application.input_evidence_refs.length
        || application.output_signal_refs.length
        || application.output_judgment_refs.length
        || application.execution_summary.length
      ) {
        throw new Error(`${application.application_id} 在 stage_02 不得预填执行输入或输出`);
      }
    } else if (application.provenance.source_application_id !== application.application_id) {
      throw new Error(`${application.application_id}.provenance.source_application_id 必须沿用自身 MA ID`);
    }
    if (!application.target_judgment_unit_refs.length) {
      throw new Error(`${application.application_id} 必须绑定至少一个判断单元`);
    }
    if (context.ontologyObjectIds) {
      assertRefsExist(
        application,
        application.target_ontology_object_refs,
        context.ontologyObjectIds,
        "本体对象",
      );
    }
    if (stage !== "stage_04" && application.status === "executed") {
      throw new Error(`${application.application_id} 只能在 stage_04 确认 executed`);
    }
    if (stage === "stage_04" && !FINAL_STATUSES.has(application.status)) {
      throw new Error(`${application.application_id} 在 stage_04 必须形成最终状态`);
    }
    if (stage !== "stage_02") {
      const previous = prior.get(application.application_id);
      if (!previous) throw new Error(`${application.application_id} 未在上一阶段登记`);
      validateTransition(previous, application, stage);
    }
    if (application.status !== "candidate" && !application.precondition_checks.length) {
      throw new Error(`${application.application_id} 非候选状态必须记录前置条件检查`);
    }
    if (FAILURE_STATUSES.has(application.status)) {
      const hasFailure = application.precondition_checks.some((item) => item.result === "fail" || item.result === "partial");
      if (!hasFailure && !application.limitations.length) {
        throw new Error(`${application.application_id} ${application.status} 缺少失败条件或限制说明`);
      }
      if (!application.alternatives.length) {
        throw new Error(`${application.application_id} ${application.status} 必须记录替代方法`);
      }
    }
    if (application.status === "executed") {
      const nonPassing = application.precondition_checks.filter((item) => item.result !== "pass");
      if (nonPassing.length) {
        throw new Error(`${application.application_id} executed 不得包含未通过前置条件: ${nonPassing.map((item) => item.precondition_id).join(", ")}`);
      }
      if (!application.execution_summary.trim()) throw new Error(`${application.application_id} executed 缺少 execution_summary`);
      if (!application.provenance.recorded_at) throw new Error(`${application.application_id} executed 缺少 recorded_at`);
      if (!application.input_evidence_refs.length) {
        throw new Error(`${application.application_id} executed 必须绑定输入证据`);
      }
      if (!application.output_signal_refs.length && !application.output_judgment_refs.length) {
        throw new Error(`${application.application_id} executed 必须绑定输出信号或判断`);
      }
      const executable = executableMethods[application.method_id];
      if (executable && context.evidenceDrafts) {
        for (const precondition of executable.requiredPreconditions) {
          const check = application.precondition_checks.find((item) =>
            item.precondition_id === precondition || item.precondition_id.endsWith(`-${precondition}`));
          if (!check || check.result !== "pass" || !check.evidence_refs.length) {
            throw new Error(`${application.application_id} 未以具体证据通过可执行前置条件 ${precondition}`);
          }
        }
        if (application.input_evidence_refs.length < executable.minimumEvidenceFacts) {
          throw new Error(`${application.application_id} 执行 ${application.method_id} 至少需要 ${executable.minimumEvidenceFacts} 条事实级证据`);
        }
        const byId = new Map(context.evidenceDrafts.map((item) => [item.id, item]));
        const sourceIds = application.input_evidence_refs.flatMap((id) => byId.get(id)?.source_ids || byId.get(id)?.source_keys || []);
        const independentGroups = new Set(sourceIds.map((id) => context.sourceGroupById?.get(id) || id));
        if (independentGroups.size < executable.minimumIndependentSourceGroups) {
          throw new Error(`${application.application_id} 执行 ${application.method_id} 缺少 ${executable.minimumIndependentSourceGroups} 个独立来源组`);
        }
      }
    }
    if (context.evidenceIds) {
      assertRefsExist(application, application.input_evidence_refs, context.evidenceIds, "证据");
      for (const check of application.precondition_checks) {
        assertRefsExist(application, check.evidence_refs, context.evidenceIds, "前置条件证据");
      }
    }
    if (context.judgmentIds) {
      assertRefsExist(application, application.output_judgment_refs, context.judgmentIds, "判断");
    }
    if (context.signalIds) {
      assertRefsExist(application, application.output_signal_refs, context.signalIds, "信号");
    }
  }
  return current;
}

export function validateJudgmentMethodBindings(
  judgments: Array<{ id: string; strength?: string; decision_status?: string; method_application_ids: string[] }>,
  applications: MethodApplication[],
) {
  const byId = methodApplicationIndex(applications);
  for (const judgment of judgments) {
    if (!judgment.method_application_ids.length) {
      throw new Error(`${judgment.id} 必须绑定至少一项实际方法应用`);
    }
    const bound = judgment.method_application_ids.map((id) => byId.get(id));
    const missing = judgment.method_application_ids.filter((_, index) => !bound[index]);
    if (missing.length) throw new Error(`${judgment.id} 引用了不存在的方法应用 ${missing.join(", ")}`);
    const allowedWithoutExecution = judgment.strength === "J0"
      && ["blocked", "indeterminate", "contested"].includes(String(judgment.decision_status));
    const adjudication = bound.filter((application) => application?.capability_type === "adjudication");
    if (!adjudication.length) {
      throw new Error(`${judgment.id} 必须绑定实际裁决能力的 MethodApplication，结构或取证 MA 不能代替裁决`);
    }
    if (!allowedWithoutExecution && !adjudication.some((application) => application?.status === "executed")) {
      throw new Error(`${judgment.id} 至少需要一项 executed adjudication MethodApplication`);
    }
    if (allowedWithoutExecution && !adjudication.some((application) => application && FINAL_STATUSES.has(application.status))) {
      throw new Error(`${judgment.id} 暂不可判断也必须绑定已收敛状态的 adjudication MethodApplication`);
    }
  }
}

export function validateJudgmentCapabilityCoverage(
  applications: MethodApplication[],
  judgmentUnits: Array<{ id: string }>,
) {
  const capabilities = ["judgment_structure", "evidence", "adjudication"] as const;
  for (const unit of judgmentUnits) {
    const bound = applications.filter((application) => application.target_judgment_unit_refs.includes(unit.id));
    const missing = capabilities.filter((capability) => !bound.some((application) => application.capability_type === capability));
    if (missing.length) {
      throw new Error(`${unit.id} 缺少跨阶段方法覆盖: ${missing.join(", ")}；必须在 stage_02 同时登记结构、取证和裁决 MA`);
    }
  }
}

export function validateExpressionMethodBindings(
  claims: Array<{ id: string; judgment_ids: string[]; method_application_ids: string[]; evidence_draft_ids?: string[] }>,
  stage04Applications: MethodApplication[],
  judgments: Array<{ id: string; strength?: string; decision_status?: string; method_application_ids: string[] }> = [],
) {
  const byId = methodApplicationIndex(stage04Applications);
  const judgmentById = new Map(judgments.map((judgment) => [judgment.id, judgment]));
  for (const claim of claims) {
    if (!claim.method_application_ids.length) throw new Error(`${claim.id} 缺少 MethodApplication 追溯`);
    const boundJudgments = claim.judgment_ids.map((id) => judgmentById.get(id)).filter(Boolean);
    if (boundJudgments.length !== claim.judgment_ids.length) throw new Error(`${claim.id} 引用了不存在的 Judgment`);
    const allowedMethods = new Set(boundJudgments.flatMap((judgment) => judgment?.method_application_ids || []));
    const referencedApplications: MethodApplication[] = [];
    for (const ref of claim.method_application_ids) {
      const application = byId.get(ref);
      if (!application) throw new Error(`${claim.id} 引用了不存在的方法应用 ${ref}`);
      if (!allowedMethods.has(ref)) throw new Error(`${claim.id} 引用了来源 Judgment 未使用的方法应用 ${ref}`);
      const onlyIndeterminate = boundJudgments.length === claim.judgment_ids.length && boundJudgments.every((judgment) =>
        judgment?.strength === "J0" && ["blocked", "indeterminate", "contested"].includes(String(judgment.decision_status)));
      if (application.status !== "executed" && !(onlyIndeterminate && FINAL_STATUSES.has(application.status))) {
        throw new Error(`${claim.id} 只能引用 executed MethodApplication；J0 不可判断可引用已收敛的失败/降级方法: ${ref}`);
      }
      referencedApplications.push(application);
    }
    if (!referencedApplications.some((application) => application.capability_type === "adjudication")) {
      throw new Error(`${claim.id} 必须追溯到来源 Judgment 的 adjudication MethodApplication`);
    }
  }
}
