import "server-only";
import type { DefectType, StageDefectReport } from "./output_contract";
import { DEFECT_DIMENSIONS, HARD_FAILURE_DEFECTS, STRUCTURED_DEFECT_TYPES } from "./output_contract";

/**
 * 表达审计 — 从 Python validate_05_outputs.py 迁移 + 增强
 *
 * 确保 Stage 05 表达不超出 Stage 04 判断的许可范围。
 * 核心检查:
 * 1. EX → C 映射完整性：每个 expression 必须对应一个 04 claim
 * 2. 等级一致性：表达强度不超过 claim 的 judgment_level 允可范围
 * 3. 禁止项：审计腔词、禁止措辞
 * 4. 范围忠诚：expression scope 不超过 claim scope
 *
 * v2 增强 (对标 evaluation/calibration/defects.yaml):
 * 5. 结构化缺陷分类 — 将每个 issue 归类到 11 类校准缺陷
 * 6. 表达扭曲检测 — 05 文本强度 vs 04 claim 等级
 * 7. 无支撑新观点检测 — 05 新增 04 确认边界外的事实/主张
 * 8. 反证完整性检查 — 04 反证是否在 05 中体现
 */

type JudgmentLevel = "J0" | "J1" | "J2" | "J3" | "J4";

/**
 * 各等级的允许表达范围 (来源: judgment_threshold_policy.yaml#level_outputs)
 */
const LEVEL_EXPRESSION_SCOPE: Record<JudgmentLevel, { allowed: string; prohibited: string[] }> = {
  J0: {
    allowed: "只说明缺口，不形成方向",
    prohibited: ["方向性判断", "预测", "展望", "我们认为", "预计", "建议"],
  },
  J1: {
    allowed: "只作事实观察或线索",
    prohibited: ["方向性判断", "预测", "展望", "我们认为", "预计", "建议", "趋势"],
  },
  J2: {
    allowed: "保留条件的方向判断",
    prohibited: ["确定性判断", "确认", "确定", "预测", "建议", "交易建议"],
  },
  J3: {
    allowed: "方向判断或高概率判断",
    prohibited: ["目标价", "评级", "交易建议", "买卖建议", "无风险"],
  },
  J4: {
    allowed: "在明确范围内形成确认判断",
    prohibited: ["目标价", "评级", "交易建议", "买卖建议"],
  },
};

/** 审计腔禁词 — 不得出现在 05 的标题、投资要点或核心结论中 */
const AUDIT_VOICE_PROHIBITED = [
  /J\d\//g,
  /supported/i,
  /indeterminate/i,
  /blocked/i,
  /RE-SYS-/g,
  /RuleEvaluation/i,
  /evidence_grade/i,
  /judgment_level\s*[:：]\s*J\d/g,
] as const;

/** 通用越权措辞 — 在任何表达中都应避免 */
const OVERREACHING_WORDS = [
  "毫无疑问",
  "必然",
  "绝对",
  "铁定",
  "无风险",
  "稳赚",
  "百分百",
  "必将",
] as const;

export type ExpressionAuditEntry = {
  expression_id: string;
  claim_id: string;
  text_excerpt: string;
  judgment_level: JudgmentLevel;
  issues: Array<{
    type: "level_violation" | "voice_violation" | "overreaching" | "scope_violation" | "unmapped";
    detail: string;
  }>;
  passed: boolean;
};

export type ExpressionAuditResult = {
  total_expressions: number;
  passed: number;
  failed: number;
  entries: ExpressionAuditEntry[];
  summary: string;
};

/**
 * 执行 05 表达审计
 * @param expressions Stage 05 的 expression 列表
 * @param claims Stage 04 的 claim 列表
 * @param judgments Stage 04 的 judgment 列表
 */
export function auditStage05Expressions(
  expressions: any[],
  claims: any[],
  judgments: any[],
): ExpressionAuditResult {
  const claimMap = new Map<string, any>(claims.map((c) => [String(c.id || c.claim_id || ""), c]));
  const judgmentMap = new Map<string, any>(judgments.map((j) => [String(j.id || j.judgment_id || ""), j]));
  const entries: ExpressionAuditEntry[] = [];

  for (const expression of expressions) {
    const expressionId = String(expression.id || expression.expression_id || "");
    const claimId = String(expression.claim_id || expression.claim_ref || "");
    const text = String(expression.text || expression.content || expression.body || "").slice(0, 200);
    const issues: ExpressionAuditEntry["issues"] = [];

    // 1. 映射检查
    if (!claimId || !claimMap.has(claimId)) {
      issues.push({ type: "unmapped", detail: `EX ${expressionId} 缺少 Claim 映射或 ${claimId} 不存在` });
    } else {
      const claim = claimMap.get(claimId)!;
      const judgmentId = String(claim.judgment_id || claim.judgment_ref || "");
      const judgment = judgmentMap.get(judgmentId);

      if (judgment) {
        const level = (judgment.strength || "J0") as JudgmentLevel;
        const scope = LEVEL_EXPRESSION_SCOPE[level];
        const fullText = String(expression.text || expression.content || expression.body || "");

        // 2. 等级越级检查
        for (const prohibited of scope.prohibited) {
          if (fullText.includes(prohibited)) {
            issues.push({
              type: "level_violation",
              detail: `J${level.slice(1)} 表达包含禁止词 "${prohibited}"，允许: ${scope.allowed}`,
            });
          }
        }

        // 3. 审计腔检查
        for (const pattern of AUDIT_VOICE_PROHIBITED) {
          if (pattern.test(fullText)) {
            issues.push({
              type: "voice_violation",
              detail: `包含审计腔模式: ${pattern.source}`,
            });
          }
        }

        // 4. 越权措辞检查
        for (const word of OVERREACHING_WORDS) {
          if (fullText.includes(word)) {
            issues.push({
              type: "overreaching",
              detail: `包含越权措辞: "${word}"`,
            });
          }
        }
      }
    }

    entries.push({
      expression_id: expressionId,
      claim_id: claimId,
      text_excerpt: text,
      judgment_level: "J0",
      issues,
      passed: issues.length === 0,
    });
  }

  const passedCount = entries.filter((e) => e.passed).length;
  const failedCount = entries.length - passedCount;

  return {
    total_expressions: entries.length,
    passed: passedCount,
    failed: failedCount,
    entries,
    summary: failedCount > 0
      ? `${failedCount}/${entries.length} 表达存在问题: ${entries.filter((e) => !e.passed).map((e) => `${e.expression_id}(${e.issues.map((i) => i.type).join(",")})`).join("; ")}`
      : `全部 ${entries.length} 条表达通过审计`,
  };
}

// =============================================================================
// v2 增强: 结构化缺陷检测 (对标 evaluation/calibration/defects.yaml)
// =============================================================================

/**
 * 将表达审计 issue 映射到结构化缺陷类型
 */
export function classifyDefect(
  issueType: string,
  detail: string,
): DefectType {
  // 语音违规 → audit_register_voice_in_prose
  if (issueType === "voice_violation") return "audit_register_voice_in_prose";
  // 等级越级 → strength_upgrade 或 expression_distortion
  if (issueType === "level_violation") {
    if (detail.includes("J4") || detail.includes("确认") || detail.includes("确定")) {
      return "expression_distortion";
    }
    return "strength_upgrade";
  }
  // 越权措辞 → expression_distortion
  if (issueType === "overreaching") return "expression_distortion";
  // 未映射 → unsupported_novelty (可能是无支撑的新观点)
  if (issueType === "unmapped") return "unsupported_novelty";
  // 范围违规 → scope_extrapolation
  if (issueType === "scope_violation") return "scope_extrapolation";
  return "low_research_value";
}

/**
 * 检测表达扭曲：05 文本强度 vs 04 claim 约束
 * 对标 defects.yaml expression_distortion
 */
export function detectExpressionDistortion(
  expressionText: string,
  claimId: string,
  judgmentLevel: JudgmentLevel,
): StageDefectReport[] {
  const reports: StageDefectReport[] = [];
  const text = String(expressionText || "");

  // J0/J1 出现方向性表述 → 严重扭曲
  if ((judgmentLevel === "J0" || judgmentLevel === "J1")) {
    const directionalPatterns = [
      { pattern: /我们认为/, detail: "J0/J1 不得使用'我们认为'" },
      { pattern: /预计/, detail: "J0/J1 不得给出预测" },
      { pattern: /趋势/, detail: "J0/J1 不得描述趋势" },
      { pattern: /有望/, detail: "J0/J1 不得暗示方向" },
      { pattern: /向好|向坏|改善|恶化/, detail: "J0/J1 不得作方向性描述" },
      { pattern: /确认|确定/, detail: "J0/J1 不得使用确定性措辞" },
    ];
    for (const { pattern, detail } of directionalPatterns) {
      if (pattern.test(text)) {
        reports.push({
          defect_type: "expression_distortion",
          dimension: "R",
          severity: "hard_fail",
          stage: "05",
          location: `claim=${claimId}`,
          detail: `${detail}: "${text.slice(0, 80)}"`,
          suggestion: `J0/J1 仅可说明缺口或作事实观察，重写为边界表述`,
        });
      }
    }
  }

  // J2 出现确定判断 → 强度扭曲
  if (judgmentLevel === "J2") {
    const confidentPatterns = [
      { pattern: /确认/, detail: "J2 不得使用'确认'" },
      { pattern: /确定/, detail: "J2 不得使用'确定'" },
      { pattern: /毫无疑问|必然/, detail: "J2 不得使用绝对肯定措辞" },
    ];
    for (const { pattern, detail } of confidentPatterns) {
      if (pattern.test(text)) {
        reports.push({
          defect_type: "expression_distortion",
          dimension: "R",
          severity: "error",
          stage: "05",
          location: `claim=${claimId}`,
          detail: `${detail}: "${text.slice(0, 80)}"`,
          suggestion: "J2 应加条件限定（如'在 X 条件下倾向于'）",
        });
      }
    }
  }

  // J3/J4 出现买卖建议 → 合规扭曲
  if (judgmentLevel === "J3" || judgmentLevel === "J4") {
    const compliancePatterns = [
      { pattern: /目标价/, detail: "不得给出目标价" },
      { pattern: /评级/, detail: "不得给出评级" },
      { pattern: /买卖|买入|卖出|增持|减持/, detail: "不得给出交易建议" },
      { pattern: /无风险/, detail: "不得暗示无风险" },
    ];
    for (const { pattern, detail } of compliancePatterns) {
      if (pattern.test(text)) {
        reports.push({
          defect_type: "expression_distortion",
          dimension: "R",
          severity: "hard_fail",
          stage: "05",
          location: `claim=${claimId}`,
          detail: `${detail}: "${text.slice(0, 80)}"`,
          suggestion: "移除交易建议措辞，仅保留研究判断表述",
        });
      }
    }
  }

  return reports;
}

/**
 * 检测无支撑新观点：05 中出现 04 确认边界外的事实或判断
 */
export function detectUnsupportedNovelty(
  expressionText: string,
  claimId: string,
  stage04Facts: string[],
): StageDefectReport[] {
  const reports: StageDefectReport[] = [];
  const text = String(expressionText || "");

  // 检测 05 中出现的数字型事实是否在 04 中出现过
  const numericPattern = /(\d{1,3}(?:,\d{3})*(?:\.\d+)?[万亿百分比%倍点]|\d+\.\d+%)/g;
  const novelNumbers: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = numericPattern.exec(text)) !== null) {
    const num = match[0];
    if (!stage04Facts.some((f) => f.includes(num))) {
      novelNumbers.push(num);
    }
  }

  if (novelNumbers.length > 0) {
    reports.push({
      defect_type: "unsupported_novelty",
      dimension: "R",
      severity: novelNumbers.length >= 3 ? "hard_fail" : "error",
      stage: "05",
      location: `claim=${claimId}`,
      detail: `05 出现 ${novelNumbers.slice(0, 5).join(", ")} 等 ${novelNumbers.length} 个未在 04 中出现的数据`,
      suggestion: "将新数据退回 03 补充为证据，或删除在 05 中新增的数据",
    });
  }

  // 检测 05 中的企业/产品名称是否在 04 出现
  const companyPatterns = [/华为/, /中芯国际/, /台积电/, /ASML/, /应用材料/, /北方华创/, /中微公司/];
  for (const pattern of companyPatterns) {
    if (pattern.test(text)) {
      const name = pattern.source;
      if (!stage04Facts.some((f) => f.includes(name))) {
        reports.push({
          defect_type: "unsupported_novelty",
          dimension: "R",
          severity: "warning",
          stage: "05",
          location: `claim=${claimId}`,
          detail: `05 提及 "${name}" 但 04 中未出现`,
          suggestion: `确认 "${name}" 是否在 03/04 证据中有支撑`,
        });
      }
    }
  }

  return reports;
}

/**
 * 检测反证完整性：04 记录的反证是否在 05 中体现
 * 对标 defects.yaml counterevidence_removed
 */
export function detectCounterevidenceOmission(
  expressionText: string,
  counterevidenceSummary: string | undefined,
): StageDefectReport[] {
  const reports: StageDefectReport[] = [];
  if (!counterevidenceSummary) return reports;

  const text = String(expressionText || "");
  const counterKeywords = counterevidenceSummary
    .split(/[，,]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 3);

  for (const keyword of counterKeywords.slice(0, 5)) {
    if (!text.includes(keyword)) {
      reports.push({
        defect_type: "counterevidence_removed",
        dimension: "R",
        severity: "hard_fail",
        stage: "05",
        location: "expression",
        detail: `反证关键词 "${keyword}" 在 05 正文中缺失`,
        suggestion: `在 05 中体现此反证 (${counterevidenceSummary})，或说明为何不作为关键反证`,
      });
    }
  }

  return reports;
}

/**
 * 综合表达审计 v2 — 包含结构化缺陷检测
 */
export function auditStage05ExpressionsV2(
  expressions: any[],
  claims: any[],
  judgments: any[],
  stage04Facts: string[] = [],
): {
  audit: ExpressionAuditResult;
  defects: StageDefectReport[];
} {
  const audit = auditStage05Expressions(expressions, claims, judgments);
  const defects: StageDefectReport[] = [];
  const claimMap = new Map<string, any>(claims.map((c) => [String(c.id || c.claim_id || ""), c]));
  const judgmentMap = new Map<string, any>(judgments.map((j) => [String(j.id || j.judgment_id || ""), j]));

  // 1. 对每条表达执行结构化缺陷检测
  for (const expression of expressions) {
    const claimId = String(expression.claim_id || expression.claim_ref || "");
    const text = String(expression.text || expression.content || expression.body || "");
    const claim = claimMap.get(claimId);

    if (claim) {
      const judgmentId = String(claim.judgment_id || claim.judgment_ref || "");
      const judgment = judgmentMap.get(judgmentId);
      const level = (judgment?.strength || "J0") as JudgmentLevel;

      // 表达扭曲检测
      defects.push(...detectExpressionDistortion(text, claimId, level));

      // 无支撑新观点检测
      defects.push(...detectUnsupportedNovelty(text, claimId, stage04Facts));

      // 反证完整性检测
      if (judgment?.counterevidence_summary) {
        defects.push(
          ...detectCounterevidenceOmission(text, judgment.counterevidence_summary),
        );
      }
    }
  }

  // 2. 将 audit issues 也映射为结构化缺陷
  for (const entry of audit.entries) {
    for (const issue of entry.issues) {
      const defectType = classifyDefect(issue.type, issue.detail);
      defects.push({
        defect_type: defectType,
        dimension: DEFECT_DIMENSIONS[defectType],
        severity: HARD_FAILURE_DEFECTS.includes(defectType) ? "hard_fail" : "error",
        stage: "05",
        location: `EX=${entry.expression_id}`,
        detail: issue.detail,
        suggestion: getFixSuggestion(defectType, issue.detail),
      });
    }
  }

  return { audit, defects };
}

function getFixSuggestion(defectType: DefectType, detail: string): string {
  const suggestions: Record<DefectType, string> = {
    fact_error: "核实事实数据来源，修正错误",
    scope_extrapolation: "限定结论范围，明确边界条件",
    strength_upgrade: "降低表达强度至与证据等级匹配",
    counterevidence_removed: "在正文中体现关键反证",
    causal_leap: "补充机制证据或改用弱因果关系表述",
    low_research_value: "增加差异化观点或增量信息",
    irrelevant_verbosity: "精简冗余内容，聚焦核心判断",
    unsupported_novelty: "退回 03 补证据，或删除无支撑的新观点",
    over_conservative: "证据充分时提高判断强度",
    expression_distortion: "按 04 handoff 边界重写表达",
    audit_register_voice_in_prose: "用研究语言重写审计腔表述",
  };
  return suggestions[defectType] || "参考对应阶段修复提示";
}

/**
 * 05 交付前自检 — 生成时不使用审计腔措辞
 */
export function sanitizeAuditVoice(text: string): string {
  let result = text;
  // 替换 J 等级标注
  result = result.replace(/J\d[/]\w+/g, "");
  result = result.replace(/RE-SYS-\S+/g, "");
  // 替换审计用词
  result = result.replace(/supported/g, "有证据支持");
  result = result.replace(/indeterminate/g, "暂不可形成判断");
  result = result.replace(/blocked/g, "证据阻断");
  return result;
}

/**
 * 获取等级对应的研究员可读措辞
 */
export function researcherReadableLevel(level: JudgmentLevel): string {
  const map: Record<JudgmentLevel, string> = {
    J0: "暂无法形成判断",
    J1: "初步观察到",
    J2: "在特定条件下倾向于",
    J3: "证据较充分支持",
    J4: "证据充分确认",
  };
  return map[level] || level;
}
