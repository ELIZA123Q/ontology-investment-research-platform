import { compileEvidenceAcquisitionPlan } from "./evidence_source_routes";
import type { EvidenceRequirementProjection } from "./structure_candidates";

export function stage03AutoSupplementMaxRounds(): number {
  const raw = process.env.STAGE03_AUTO_SUPPLEMENT_MAX_ROUNDS;
  const parsed = raw ? Number(raw) : 3;
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : 3;
}

export type Stage03EvidenceBatch = {
  batch_id: string;
  unit_ids: string[];
  requirements: EvidenceRequirementProjection[];
};

/**
 * Stage03 不再把全部判断单元压进一次工具环。批次上限不是丢弃上限：
 * 当单元很多时自动增大每批大小，确保所有单元仍被覆盖。
 */
export function partitionStage03EvidenceBatches(input: {
  judgmentUnitIds: string[];
  requirements?: EvidenceRequirementProjection[];
  preferredUnitsPerBatch?: number;
  maxBatches?: number;
}): Stage03EvidenceBatch[] {
  const unitIds = [...new Set(input.judgmentUnitIds.map(String).filter(Boolean))];
  if (!unitIds.length) return [];
  const preferred = Math.max(1, Math.floor(input.preferredUnitsPerBatch || 2));
  const maxBatches = Math.max(1, Math.floor(input.maxBatches || 4));
  const unitsPerBatch = Math.max(preferred, Math.ceil(unitIds.length / maxBatches));
  const requirements = input.requirements || [];
  const batches: Stage03EvidenceBatch[] = [];
  for (let index = 0; index < unitIds.length; index += unitsPerBatch) {
    const selected = unitIds.slice(index, index + unitsPerBatch);
    const selectedSet = new Set(selected);
    batches.push({
      batch_id: `EB-${String(batches.length + 1).padStart(2, "0")}`,
      unit_ids: selected,
      requirements: requirements.filter((item) =>
        item.judgment_unit_ids.some((id) => selectedSet.has(String(id))),
      ),
    });
  }
  return batches;
}

export function stage03EvidenceBatchConfig() {
  const unitsRaw = Number(process.env.STAGE03_EVIDENCE_UNITS_PER_BATCH || 2);
  const batchesRaw = Number(process.env.STAGE03_EVIDENCE_MAX_BATCHES || 4);
  return {
    preferredUnitsPerBatch: Number.isFinite(unitsRaw) && unitsRaw > 0 ? Math.floor(unitsRaw) : 2,
    maxBatches: Number.isFinite(batchesRaw) && batchesRaw > 0 ? Math.floor(batchesRaw) : 4,
  };
}

export function stage03AcquisitionCallCount(toolUsage: unknown): number {
  if (!toolUsage || typeof toolUsage !== "object" || Array.isArray(toolUsage)) return 0;
  const usage = toolUsage as Record<string, unknown>;
  return ["web_search_calls", "public_page_fetch_calls", "mcp_evidence_calls", "runtime_preacquired_sources"]
    .reduce((sum, key) => {
      const value = Number(usage[key] || 0);
      return sum + (Number.isFinite(value) && value > 0 ? value : 0);
    }, 0);
}

export function stage03ModelAcquisitionCallCount(toolUsage: unknown): number {
  if (!toolUsage || typeof toolUsage !== "object" || Array.isArray(toolUsage)) return 0;
  const usage = toolUsage as Record<string, unknown>;
  return ["web_search_calls", "public_page_fetch_calls", "mcp_evidence_calls"]
    .reduce((sum, key) => sum + Math.max(0, Number(usage[key] || 0) || 0), 0);
}

export function buildStage03AcquisitionQueries(input: {
  question: string;
  requirements?: EvidenceRequirementProjection[];
  targetUnitIds?: string[];
  maxQueries?: number;
  structure?: any;
  cutoffMs?: number;
}): string[] {
  if (input.structure) {
    const plan = compileEvidenceAcquisitionPlan(input);
    // 已编译出任务时必须服从机器路由；route_missing 不得静默退回泛化 Web 查询。
    if (plan.tasks.length) return plan.queries;
  }
  const target = new Set((input.targetUnitIds || []).map(String));
  const requirements = (input.requirements || [])
    .filter((item) => !target.size || item.judgment_unit_ids.some((id) => target.has(String(id))))
    .sort((a, b) => a.id.localeCompare(b.id));
  const question = String(input.question || "").replace(/\s+/g, " ").trim().slice(0, 180);
  const maxQueries = Math.max(1, Math.min(4, Math.floor(input.maxQueries || 4)));
  const support = requirements.filter((item) => item.evidence_role !== "counter");
  const counter = requirements.filter((item) => item.evidence_role === "counter");
  const balanced = [
    support[0],
    ...(maxQueries > 1 ? [counter[0]] : []),
    ...support.slice(1),
    ...counter.slice(1),
  ].filter((item): item is EvidenceRequirementProjection => Boolean(item));
  const queries = balanced.map((item) => {
    const requirement = item.requirement.replace(/\s+/g, " ").trim().slice(0, 180);
    const translated = semiconductorSearchKeywords(requirement, item.evidence_role);
    // 顶层 EvidenceRequirement 是研究语言，不是检索语言。半导体场景优先压缩为
    // 英文产品/指标词，保留年份和一手/行业来源提示；未命中词典时才回退中文。
    return translated || `${requirement} 数据 原文`.trim().slice(0, 240);
  });
  if (!queries.length && question) queries.push(`${question} 数据 原文`);
  return [...new Set(queries)].slice(0, maxQueries);
}

export function semiconductorSearchKeywords(
  requirement: string,
  role: EvidenceRequirementProjection["evidence_role"] = "support",
): string {
  const text = String(requirement || "");
  const isDisplacement = /转换|挤占|挤压|晶圆面积占比|HBM晶圆投片/i.test(text);
  const product = /企业级\s*(?:SSD|NAND)|enterprise/i.test(text)
    ? "enterprise SSD NAND"
    : /消费级\s*(?:SSD|NAND)|客户端\s*SSD|UFS|client/i.test(text)
      ? "client SSD NAND UFS"
      : /通用\s*DRAM|非\s*HBM\s*DRAM/i.test(text)
        ? "conventional DRAM"
        : isDisplacement && /HBM/i.test(text) && /DRAM/i.test(text)
          ? "HBM DRAM"
        : /HBM/i.test(text)
          ? "HBM"
          : /DRAM/i.test(text)
            ? "DRAM"
            : /NAND|SSD/i.test(text) ? "NAND SSD" : "";
  const terms: string[] = [];
  const add = (term: string) => {
    if (term && !terms.includes(term)) terms.push(term);
  };
  const mappings: Array<[RegExp, string]> = [
    [/合约价/i, "contract price"],
    [/现货价/i, "spot price"],
    [/报价|价格|涨价|跌幅/i, "pricing"],
    [/库存天数|库存/i, "inventory"],
    [/渠道/i, "channel inventory"],
    [/客户/i, "customer inventory"],
    [/AI\s*系统|AI\s*服务器|加速卡/i, "AI server accelerator shipments"],
    [/终端出货|PC|手机|笔记本/i, "PC smartphone shipments"],
    [/资本开支|数据中心/i, "data center capex"],
    [/晶圆投片|晶圆投入|晶圆面积|晶圆厂/i, "wafer allocation"],
    [/产能利用率|有效产出|产能/i, "capacity utilization"],
    [/良率/i, "yield"],
    [/封装|CoWoS/i, "advanced packaging capacity"],
    [/代际切换|层数|die|世代/i, "generation transition die density"],
    [/减产/i, "production cuts"],
    [/需求下修|需求持续低迷|需求转弱|部署受限/i, "demand slowdown"],
    [/订单|覆盖期|长协/i, "orders"],
    [/转换|挤占|挤压/i, "capacity conversion displacement"],
    [/促销/i, "promotion"],
  ];
  for (const [pattern, term] of mappings) {
    if (pattern.test(text)) add(term);
  }
  if (!product && !terms.length) return "";
  const preferredSite = product === "HBM DRAM"
    ? role === "support" ? "site:investors.micron.com" : "site:trendforce.com"
    : product.startsWith("HBM")
    ? role === "support" ? "site:news.samsung.com" : "site:trendforce.com"
    : product.startsWith("conventional DRAM") || product === "DRAM"
      ? role === "support" ? "site:investors.micron.com" : "site:trendforce.com"
      : product.startsWith("enterprise")
        ? role === "support" ? "site:investor.sandisk.com" : "site:trendforce.com"
        : product.startsWith("client")
          ? role === "support" ? "site:trendforce.com" : "site:counterpointresearch.com"
          : role === "support" ? "site:investors.micron.com" : "site:trendforce.com";
  const hasPricing = terms.some((term) => ["contract price", "spot price", "pricing"].includes(term));
  const hasInventory = terms.some((term) => term.includes("inventory"));
  const hasDemand = terms.some((term) =>
    ["demand slowdown", "AI server accelerator shipments", "PC smartphone shipments", "data center capex", "orders"].includes(term),
  );
  const hasCapacity = terms.some((term) =>
    ["wafer allocation", "capacity utilization", "yield", "advanced packaging capacity", "capacity conversion displacement"].includes(term),
  );
  // 搜索引擎对把整个 EvidenceRequirement 塞进 query 的召回很差。
  // 这里保留产品、来源、年份和至多两个判别维度；详细指标仍留在
  // EvidenceRequirement 与模型取证 brief 中，不因压缩检索式而丢失。
  const dimensions = [
    ...(hasPricing ? ["pricing"] : []),
    ...(hasInventory ? ["inventory"] : []),
    ...(hasDemand ? [role === "counter" ? "demand slowdown" : "demand"] : []),
    ...(hasCapacity ? ["capacity"] : []),
  ].slice(0, 2);
  const canonical = product === "HBM DRAM"
    ? ["HBM", "DRAM", "wafer", "capacity"]
    : product.startsWith("HBM")
      ? role === "support" ? ["HBM4", "mass production"] : ["HBM", "demand", "inventory"]
      : product.startsWith("conventional DRAM")
        ? role === "support" ? ["DRAM", "supply", "inventory"] : ["DRAM", "contract price", "inventory"]
        : product === "DRAM"
          ? [
              "DRAM",
              terms.includes("contract price") ? "contract price" : hasPricing ? "pricing" : "supply",
              hasInventory ? "inventory" : role === "counter" ? "demand slowdown" : "demand",
            ]
        : product.startsWith("enterprise")
          ? role === "support" ? ["enterprise SSD", "demand"] : ["enterprise SSD", "inventory"]
          : product.startsWith("client")
            ? role === "support" ? ["client SSD", "NAND", "price"] : ["smartphone", "PC", "demand"]
            : dimensions;
  return [...new Set([preferredSite, ...canonical, "2026"])]
    .join(" ")
    .slice(0, 180);
}
