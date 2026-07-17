import type { MethodApplication, MethodApplicationStatus, StageKind } from "./types";

const FINAL_STATUSES = new Set<MethodApplicationStatus>(["executed", "rejected", "blocked", "degraded"]);
const FAILURE_STATUSES = new Set<MethodApplicationStatus>(["rejected", "blocked", "degraded"]);

export type MethodApplicationValidationContext = {
  prior?: MethodApplication[];
  evidenceIds?: Set<string>;
  judgmentIds?: Set<string>;
  signalIds?: Set<string>;
};

export function methodApplicationIndex(applications: MethodApplication[]): Map<string, MethodApplication> {
  const result = new Map<string, MethodApplication>();
  for (const application of applications) {
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
  const allowed: Record<MethodApplicationStatus, Set<MethodApplicationStatus>> = {
    candidate: new Set(["candidate", "selected", "rejected", "blocked", "degraded"]),
    selected: new Set(["selected", "executed", "rejected", "blocked", "degraded"]),
    executed: new Set(["executed"]),
    rejected: new Set(["rejected"]),
    blocked: new Set(["blocked"]),
    degraded: new Set(["degraded", "executed", "blocked"]),
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
    if (!application.target_judgment_unit_refs.length) {
      throw new Error(`${application.application_id} 必须绑定至少一个判断单元`);
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
      if (!application.input_evidence_refs.length) {
        throw new Error(`${application.application_id} executed 必须绑定输入证据`);
      }
      if (!application.output_signal_refs.length && !application.output_judgment_refs.length) {
        throw new Error(`${application.application_id} executed 必须绑定输出信号或判断`);
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
  judgments: Array<{ id: string; method_application_ids: string[] }>,
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
    if (!bound.some((application) => application?.status === "executed")) {
      throw new Error(`${judgment.id} 至少需要一项 executed MethodApplication`);
    }
  }
}

export function validateExpressionMethodBindings(
  claims: Array<{ id: string; method_application_ids: string[] }>,
  stage04Applications: MethodApplication[],
) {
  const byId = methodApplicationIndex(stage04Applications);
  for (const claim of claims) {
    if (!claim.method_application_ids.length) throw new Error(`${claim.id} 缺少 MethodApplication 追溯`);
    for (const ref of claim.method_application_ids) {
      const application = byId.get(ref);
      if (!application) throw new Error(`${claim.id} 引用了不存在的方法应用 ${ref}`);
      if (application.status !== "executed") throw new Error(`${claim.id} 只能引用 executed MethodApplication: ${ref}`);
    }
  }
}
