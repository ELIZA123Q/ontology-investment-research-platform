/**
 * 三库 → Runtime 注入覆盖：加载 coverage 矩阵并与 runtime_contexts 交叉校验。
 */

import { existsSync, readFileSync } from "node:fs";
import YAML from "yaml";
import { repositoryPath } from "../adapters/repo-paths";
import { registeredFiles } from "./knowledge";
import type { StageKind } from "./types";

const COVERAGE_PATH = "governance/03_校验/runtime_asset_coverage.yaml";

export type InjectionMode =
  | "knowledge"
  | "registry_routed"
  | "guidance_excerpt"
  | "ontology_slice"
  | "structured_input"
  | "missing_critical";

export type CoverageAsset = {
  id: string;
  path: string;
  injection_mode: InjectionMode;
  stages: StageKind[];
  critical: boolean;
  note?: string;
};

export type RuntimeAssetCoverage = {
  schema_name: string;
  knowledge_expected: Record<string, string[]>;
  assets: CoverageAsset[];
  intentionally_excluded: Array<{ path: string; reason: string }>;
};

export function loadRuntimeAssetCoverage(): RuntimeAssetCoverage {
  const raw = YAML.parse(readFileSync(repositoryPath(COVERAGE_PATH), "utf8")) as any;
  return {
    schema_name: String(raw.schema_name || ""),
    knowledge_expected: raw.knowledge_expected || {},
    assets: (raw.assets || []).map((item: any) => ({
      id: String(item.id),
      path: String(item.path),
      injection_mode: String(item.injection_mode) as InjectionMode,
      stages: [...(item.stages || [])].map(String) as StageKind[],
      critical: Boolean(item.critical),
      note: item.note ? String(item.note) : undefined,
    })),
    intentionally_excluded: (raw.intentionally_excluded || []).map((item: any) => ({
      path: String(item.path),
      reason: String(item.reason),
    })),
  };
}

export function criticalMissingAssets(coverage: RuntimeAssetCoverage = loadRuntimeAssetCoverage()): CoverageAsset[] {
  return coverage.assets.filter((item) => item.critical && item.injection_mode === "missing_critical");
}

/** knowledge 模式资产路径必须出现在对应阶段 registeredFiles 中。 */
export function knowledgeCoverageGaps(
  coverage: RuntimeAssetCoverage = loadRuntimeAssetCoverage(),
): Array<{ asset_id: string; stage: StageKind; path: string }> {
  const gaps: Array<{ asset_id: string; stage: StageKind; path: string }> = [];
  for (const asset of coverage.assets) {
    if (asset.injection_mode !== "knowledge" || !asset.critical) continue;
    for (const stage of asset.stages) {
      const files = registeredFiles(stage, {
        deliveryArchetype: stage === "stage_05" ? "industry_cycle_report" : undefined,
        judgmentTypes: stage === "stage_04"
          ? ["transmission_path", "mechanism_validation", "causal_attribution"]
          : undefined,
      });
      if (!files.includes(asset.path)) {
        gaps.push({ asset_id: asset.id, stage, path: asset.path });
      }
    }
  }
  return gaps;
}

/** knowledge_expected 与 runtime_contexts 实际白名单必须一致（子集校验）。 */
export function expectedKnowledgeMismatch(
  coverage: RuntimeAssetCoverage = loadRuntimeAssetCoverage(),
): Array<{ stage: string; missing: string[] }> {
  const out: Array<{ stage: string; missing: string[] }> = [];
  for (const [stage, expected] of Object.entries(coverage.knowledge_expected || {})) {
    const files = registeredFiles(stage as StageKind, {
      deliveryArchetype: stage === "stage_05" ? "industry_cycle_report" : undefined,
    });
    const missing = expected.filter((path) => !files.includes(path));
    if (missing.length) out.push({ stage, missing });
  }
  return out;
}

/** critical 资产 path 在仓库中存在（目录则存在即可）。 */
export function missingCriticalPaths(
  coverage: RuntimeAssetCoverage = loadRuntimeAssetCoverage(),
): string[] {
  return coverage.assets
    .filter((item) => item.critical)
    .map((item) => item.path)
    .filter((path) => !existsSync(repositoryPath(path)));
}

export type InjectedAssetSummary = {
  knowledge_files: string[];
  method_guidance_ids: string[];
  scenario_card_ids: string[];
  structured_keys: string[];
};

export function summarizeInjectedAssets(input: {
  knowledge_files?: string[];
  method_guidance?: Array<{ method_id?: string }>;
  scenario_card_ids?: string[];
  structured_keys?: string[];
}): InjectedAssetSummary {
  return {
    knowledge_files: [...(input.knowledge_files || [])],
    method_guidance_ids: (input.method_guidance || [])
      .map((item) => String(item.method_id || ""))
      .filter(Boolean),
    scenario_card_ids: [...(input.scenario_card_ids || [])],
    structured_keys: [...(input.structured_keys || [])],
  };
}
