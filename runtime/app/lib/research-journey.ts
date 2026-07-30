export type JourneyNextStep = {
  label: string;
  pathSuffix: string;
};

export type ResearchStageJourney = {
  stage: number;
  id: string;
  kind: string;
  navLabel: string;
  editTitle: string;
  reviewPath: string;
  scenarioQuestion: string;
  scenarioHint: string;
  editHint: string;
  /** May include `{count}` for runtime substitution. */
  output: string;
  /** Fallback when `{count}` is present but no count is provided. */
  outputFallback: string;
  outputNote: string;
  confirmation: string;
  nextStep: JourneyNextStep;
};

export type ResearchReferenceScene = {
  id: "history" | "object-set" | "compare";
  eyebrow: string;
  title: string;
  hint: string;
};

const JARGON_PATTERN = /Stage|stage_|J[0-4]|JSON|YAML|闸门|缺口/;

export const RESEARCH_STAGE_JOURNEY: readonly ResearchStageJourney[] = [
  {
    stage: 1,
    id: "scope",
    kind: "stage_01",
    navLabel: "范围",
    editTitle: "研究范围",
    reviewPath: "/scope",
    scenarioQuestion: "这次研究到底要判断什么？",
    scenarioHint: "确认对象、判断动作、截止时点和明确排除项，避免后续研究问题悄悄漂移。",
    editHint: "修改对象、判断目标、时间与边界；保存后回到范围页核对本阶段输出。",
    output: "可执行、可证伪的研究问题",
    outputFallback: "等待收敛研究问题",
    outputNote: "确认后，后续结构、证据和判断都必须遵守这组范围边界。",
    confirmation: "研究问题是否已收敛为可验证、可证伪的任务？",
    nextStep: { label: "进入结构 →", pathSuffix: "/structure" },
  },
  {
    stage: 2,
    id: "structure",
    kind: "stage_02",
    navLabel: "结构",
    editTitle: "研究结构",
    reviewPath: "/structure",
    scenarioQuestion: "这项研究需要回答哪些关键判断？",
    scenarioHint: "把研究问题拆成可分别取证、可被反驳的判断；确认后，证据台会严格按这些判断组织工作。",
    editHint: "修改关键判断、必要证据与反证/竞争解释；保存后回到结构页核对输出。",
    output: "{count} 个关键判断及其必要证据",
    outputFallback: "等待形成关键判断",
    outputNote: "研究员在此只需确认：是否拆对了问题、是否漏掉关键证据、什么情况会推翻当前分析。",
    confirmation: "问题是否拆对，关键证据与反面情况是否完整？",
    nextStep: { label: "进入证据 →", pathSuffix: "/evidence" },
  },
  {
    stage: 3,
    id: "evidence",
    kind: "stage_03",
    navLabel: "证据",
    editTitle: "证据准备",
    reviewPath: "/evidence",
    scenarioQuestion: "证据够不够，还有哪些关键材料没拿到？",
    scenarioHint: "围绕要回答的判断核对事实、确认暂缺或理清相互矛盾；证据数量本身不等于结论强度。",
    editHint: "取得公开来源、形成待核对事实并挂到关键判断；最终确认仍在证据页完成。",
    output: "{count} 项不重复的事实、反证、相互矛盾或尚缺的证据",
    outputFallback: "等待形成可核验事实与尚缺项",
    outputNote: "每项证据同时标明影响哪些关键判断、来源状态与人工确认结果。",
    confirmation: "事实是否忠实于原文，尚缺的证据是否被清楚标明？",
    nextStep: { label: "进入判断 →", pathSuffix: "/judgments" },
  },
  {
    stage: 4,
    id: "judgment",
    kind: "stage_04",
    navLabel: "判断",
    editTitle: "判断草稿",
    reviewPath: "/judgments",
    scenarioQuestion: "现有证据，允许说到多强？",
    scenarioHint: "先看结论、强度、依据和改判条件；只有需要追查推理过程时，才展开审计链路。",
    editHint: "这里用于修改草稿；结论、边界与本阶段输出请回对应阶段页面确认。",
    output: "{count} 项有边界的研究判断",
    outputFallback: "尚未形成研究判断",
    outputNote: "每项判断都必须明确：能说到多强、为什么、什么证据会使它失效。",
    confirmation: "现有证据允许结论说到多强，什么情况会改判？",
    nextStep: { label: "进入交付 →", pathSuffix: "/report" },
  },
  {
    stage: 5,
    id: "delivery",
    kind: "stage_05",
    navLabel: "交付",
    editTitle: "报告草稿",
    reviewPath: "/report",
    scenarioQuestion: "把已确认判断交付给读者",
    scenarioHint: "下方是面向读者的研究稿预览；审计编号保留在正式包中，不占用阅读正文。",
    editHint: "这里用于修改草稿；结论、边界与本阶段输出请回对应阶段页面确认。",
    output: "可交付的研究判断报告",
    outputFallback: "研究报告草稿与交付条件",
    outputNote: "正文只呈现结论、依据、边界、改判条件与来源；内部映射留在审计文件。",
    confirmation: "正文是否准确表达已确认判断，没有越过证据上限？",
    nextStep: { label: "返回概览 →", pathSuffix: "" },
  },
] as const;

export const RESEARCH_REFERENCE_SCENES: readonly ResearchReferenceScene[] = [
  {
    id: "history",
    eyebrow: "研究历史",
    title: "这项研究如何演进？",
    hint: "先看阶段进展与前后轮变化；原始文件、全部版本和系统校验记录收进审计档案。",
  },
  {
    id: "object-set",
    eyebrow: "高级审计 · 不改变研究结论",
    title: "本轮实例关系审计",
    hint: "核对本轮具体对象的正式连接与关系缺口；知识类型和规则定义请到知识库查看。",
  },
  {
    id: "compare",
    eyebrow: "质量实验 · 不改变研究结论",
    title: "同一证据下，两种研究流程谁更可用？",
    hint: "先确认不补充外部信息的对照稿，再由未参与产出的评价人盲评来源、边界、反证和决策帮助。",
  },
] as const;

export function researchStage(stage: number) {
  return RESEARCH_STAGE_JOURNEY.find((item) => item.stage === stage);
}

export function researchStageByKind(kind: string) {
  return RESEARCH_STAGE_JOURNEY.find((item) => item.kind === kind);
}

export function researchReferenceScene(id: ResearchReferenceScene["id"]) {
  return RESEARCH_REFERENCE_SCENES.find((item) => item.id === id);
}

/** After confirming stage N, go to the next review scene (stage 5 → overview). */
export function journeyNextHref(runId: string, stage: number): string {
  const journey = researchStage(stage);
  if (!journey) return `/runs/${runId}`;
  return `/runs/${runId}${journey.nextStep.pathSuffix}`;
}

/** 审阅页路径（RunNav / 确认门主入口）。 */
export function journeyReviewHref(runId: string, stage: number): string {
  const journey = researchStage(stage);
  if (!journey) return `/runs/${runId}`;
  return `/runs/${runId}${journey.reviewPath}`;
}

/** 编辑/生成页路径。 */
export function journeyEditHref(runId: string, stage: number): string {
  return `/runs/${runId}/stages/${stage}`;
}

/**
 * 后台任务跳转：生成中 → 编辑页；待确认/受阻 → 审阅页。
 */
export function journeyJobHref(
  runId: string,
  stage: string | number,
  jobStatus?: string | null,
): string {
  const number = typeof stage === "number"
    ? stage
    : Number(String(stage).match(/0?([1-5])$/)?.[1] || 0);
  if (!number) return `/runs/${runId}`;
  if (["queued", "running", "retrying"].includes(String(jobStatus || ""))) {
    return journeyEditHref(runId, number);
  }
  return journeyReviewHref(runId, number);
}

export function journeyApproveLabel(stage: number): string {
  const journey = researchStage(stage);
  if (!journey) return "确认并继续";
  if (stage >= 5) return "确认交付";
  const next = journey.nextStep.label.replace(/→\s*$/, "").trim();
  return `确认${journey.navLabel}，${next}`;
}

/** Replace `{count}` when provided; otherwise use outputFallback if template needs a count. */
export function formatJourneyOutput(
  journey: Pick<ResearchStageJourney, "output" | "outputFallback">,
  options?: { count?: number },
): string {
  const hasSlot = journey.output.includes("{count}");
  if (!hasSlot) {
    if (options?.count !== undefined && options.count <= 0) return journey.outputFallback;
    return journey.output;
  }
  if (options?.count === undefined || options.count <= 0) return journey.outputFallback;
  return journey.output.replaceAll("{count}", String(options.count));
}

export function validateJourney(): string[] {
  const errors: string[] = [];
  const stages = RESEARCH_STAGE_JOURNEY.map((item) => item.stage);
  if (stages.join(",") !== "1,2,3,4,5") {
    errors.push("stages must be contiguous 1–5");
  }

  const reviewPaths = new Set(RESEARCH_STAGE_JOURNEY.map((item) => item.reviewPath));
  if (reviewPaths.size !== 5) errors.push("reviewPath must be unique per stage");
  if (new Set(RESEARCH_STAGE_JOURNEY.map((item) => item.kind)).size !== 5) {
    errors.push("kind must be unique per stage");
  }
  if (new Set(RESEARCH_STAGE_JOURNEY.map((item) => item.id)).size !== 5) {
    errors.push("id must be unique per stage");
  }

  for (const stage of RESEARCH_STAGE_JOURNEY) {
    const required: Array<[string, string]> = [
      ["navLabel", stage.navLabel],
      ["editTitle", stage.editTitle],
      ["reviewPath", stage.reviewPath],
      ["scenarioQuestion", stage.scenarioQuestion],
      ["scenarioHint", stage.scenarioHint],
      ["editHint", stage.editHint],
      ["output", stage.output],
      ["outputFallback", stage.outputFallback],
      ["outputNote", stage.outputNote],
      ["confirmation", stage.confirmation],
      ["nextStep.label", stage.nextStep.label],
    ];
    for (const [name, value] of required) {
      if (!value || value.trim().length < 2) errors.push(`stage ${stage.stage}: ${name} is empty`);
    }
    if (!stage.confirmation.match(/[？?]$/)) {
      errors.push(`stage ${stage.stage}: confirmation must end with a question mark`);
    }
    for (const [name, value] of [
      ["navLabel", stage.navLabel],
      ["editTitle", stage.editTitle],
      ["scenarioQuestion", stage.scenarioQuestion],
      ["scenarioHint", stage.scenarioHint],
      ["editHint", stage.editHint],
      ["output", stage.output],
      ["outputFallback", stage.outputFallback],
      ["outputNote", stage.outputNote],
      ["confirmation", stage.confirmation],
      ["nextStep.label", stage.nextStep.label],
    ] as const) {
      if (JARGON_PATTERN.test(value)) errors.push(`stage ${stage.stage}: ${name} contains internal jargon`);
    }
    const next = stage.nextStep.pathSuffix;
    if (stage.stage < 5) {
      if (!reviewPaths.has(next)) {
        errors.push(`stage ${stage.stage}: nextStep.pathSuffix must match a reviewPath`);
      }
      const target = RESEARCH_STAGE_JOURNEY.find((item) => item.reviewPath === next);
      if (target && target.stage !== stage.stage + 1) {
        errors.push(`stage ${stage.stage}: nextStep should point to stage ${stage.stage + 1}`);
      }
    } else if (next !== "") {
      errors.push("stage 5: nextStep.pathSuffix must be empty (overview)");
    }
  }

  for (const scene of RESEARCH_REFERENCE_SCENES) {
    if (!scene.eyebrow.trim() || !scene.title.trim() || !scene.hint.trim()) {
      errors.push(`reference scene ${scene.id}: missing eyebrow/title/hint`);
    }
  }

  return errors;
}
