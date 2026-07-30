import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
process.env.WORKBENCH_DB_PATH = `/tmp/ontology-candidates-${process.pid}.sqlite`;

let db: typeof import("@/adapters/db");
let repository: typeof import("@/adapters/ontology_candidates");

beforeAll(async () => {
  db = await import("@/adapters/db");
  repository = await import("@/adapters/ontology_candidates");
});

describe("ontology candidate governance repository", () => {
  it("aggregates current stage02 candidates and keeps append-only expert decisions", () => {
    const candidateName = `跨任务折旧口径-${crypto.randomUUID()}`;
    for (const suffix of ["A", "B"]) {
      const run = db.createRun(`候选治理研究-${suffix}-${crypto.randomUUID()}`, "semiconductor");
      db.createArtifact(run.id, "stage_02", {
        status: "approved",
        json_content: JSON.stringify({
          variables: [{
            id: `VAR-${suffix}`,
            name: candidateName,
            category: "cost",
            variable_kind: "observed",
            definition: "稳定的单位收入折旧口径",
            ontology_node_id: `task_local:VAR-${suffix}`,
          }],
        }),
      });
    }
    const candidate = repository.listOntologyCandidates().find((item) => item.name === candidateName)!;
    expect(candidate).toMatchObject({ run_count: 2, occurrence_count: 2, cross_task_reused: true });
    const confirmed = repository.reviewOntologyCandidate({
      candidateKey: candidate.candidate_key,
      status: "expert_confirmed",
      expertName: "测试专家",
      decisionNote: "跨任务重复且定义稳定，确认存在正式本体缺口",
    });
    expect(confirmed.review.status).toBe("expert_confirmed");
    expect(() => repository.reviewOntologyCandidate({
      candidateKey: candidate.candidate_key,
      status: "promoted",
      expertName: "测试专家",
      decisionNote: "批准进入正式本体变更流程",
      targetOntologyNodeId: "task_local:still-local",
    })).toThrow(/不能继续使用 task_local/);
    const promoted = repository.reviewOntologyCandidate({
      candidateKey: candidate.candidate_key,
      status: "promoted",
      expertName: "测试专家",
      decisionNote: "批准进入正式本体变更流程，仍需 YAML 评审发布",
      targetOntologyNodeId: "depreciation_intensity",
    });
    expect(promoted.review).toMatchObject({
      status: "promoted",
      target_ontology_node_id: "depreciation_intensity",
    });
    expect(promoted.change_request).toMatchObject({
      status: "proposed",
      target_ontology_node_id: "depreciation_intensity",
    });
    expect(promoted.change_request_events).toHaveLength(1);
    expect(promoted.change_request_events[0]).toMatchObject({
      action_type: "ProposeOntologyChange",
      action_version: "2.0.0",
      actor_role: "ontology_steward",
    });
    expect(promoted.review_events).toHaveLength(2);
    expect(promoted.review_events.map((event) => event.next_status)).toEqual(["promoted", "expert_confirmed"]);
    const repeated = repository.reviewOntologyCandidate({
      candidateKey: candidate.candidate_key,
      status: "promoted",
      expertName: "测试专家",
      decisionNote: "重复请求必须保持幂等且不得追加第二条提案",
      targetOntologyNodeId: "depreciation_intensity",
    });
    expect(repeated.review_events).toHaveLength(2);
    expect(repeated.change_request_events).toHaveLength(1);
  });

  it("does not confuse an accepted candidate with a formally released ontology element", async () => {
    const run = db.createRun(`候选发布链-${crypto.randomUUID()}`, "semiconductor");
    const candidateName = `库存周期别名-${crypto.randomUUID()}`;
    db.createArtifact(run.id, "stage_02", {
      status: "approved",
      json_content: JSON.stringify({
        variables: [{
          id: "VAR-RELEASE",
          name: candidateName,
          category: "inventory_cycle",
          variable_kind: "observed",
          definition: "用于验证元治理发布链的任务局部变量",
          ontology_node_id: "task_local:VAR-RELEASE",
        }],
      }),
    });
    const candidate = repository.listOntologyCandidates().find((item) => item.name === candidateName)!;
    expect(() => repository.reviewOntologyCandidate({
      candidateKey: candidate.candidate_key,
      status: "promoted",
      expertName: "测试专家",
      decisionNote: "不得绕过专家确认直接创建变更提案",
      targetOntologyNodeId: "inventory_cycle",
    })).toThrow(/必须先经专家确认/);
    repository.reviewOntologyCandidate({
      candidateKey: candidate.candidate_key,
      status: "expert_confirmed",
      expertName: "测试专家",
      decisionNote: "确认该任务局部变量需要进入正式治理流程",
    });
    const proposed = repository.reviewOntologyCandidate({
      candidateKey: candidate.candidate_key,
      status: "promoted",
      expertName: "测试专家",
      decisionNote: "创建正式变更提案但尚不代表已经正式发布",
      targetOntologyNodeId: "inventory_cycle",
    }).change_request!;
    const impact = {
      changed_element_ids: ["inventory_cycle"],
      affected_consumers: ["workflow_semantic_envelopes"],
      affected_run_ids: [run.id],
      required_checks: ["validate_v3", "validate_project"],
    };
    repository.applyOntologyGovernanceAction({
      requestId: proposed.id,
      actionId: "FreezeImpactAssessment",
      actorName: "治理专家",
      actorRole: "ontology_steward",
      decisionNote: "已冻结元素、消费面、运行和必跑检查影响",
      impactReport: impact,
    });
    repository.applyOntologyGovernanceAction({
      requestId: proposed.id,
      actionId: "ApproveOntologyChange",
      actorName: "治理专家",
      actorRole: "ontology_steward",
      decisionNote: "影响边界明确，批准进入正式实现环节",
      approvalPolicySatisfied: true,
    });
    repository.applyOntologyGovernanceAction({
      requestId: proposed.id,
      actionId: "RecordOntologyImplementation",
      actorName: "本体维护",
      actorRole: "ontology_steward",
      decisionNote: "正式目标已经写入受治理领域参数资产",
      implementationRef: "ontology/02_领域/semiconductor/business_instances.yaml#inventory_cycle",
    });
    repository.applyOntologyGovernanceAction({
      requestId: proposed.id,
      actionId: "AttestValidationResults",
      actorName: "发布维护",
      actorRole: "runtime_owner",
      decisionNote: "影响分析列出的必跑检查已经全部通过",
      validationResults: { validate_v3: "pass", validate_project: "pass" },
    });
    const { loadOntologyCatalog } = await import("@/engine/ontology_catalog");
    const released = repository.applyOntologyGovernanceAction({
      requestId: proposed.id,
      actionId: "ReleaseOntologyBaseline",
      actorName: "发布维护",
      actorRole: "governance_owner",
      decisionNote: "目标已解析并绑定当前正式本体内容指纹",
      releaseFingerprint: loadOntologyCatalog().fingerprint,
      approvalPolicySatisfied: true,
    });
    expect(released.status).toBe("released");
    expect(released.released_at).toBeTruthy();
  });
});
