/**
 * Five-domain asset path resolution: primary → compat, with hit audit.
 * Loaders must use this instead of hardcoding a single legacy path.
 */

import { existsSync } from "node:fs";
import { repositoryPath } from "../storage/repo_paths";

export type AssetHitSource = "primary" | "compat" | "legacy_alias";

export type ResolvedAssetPath = {
  /** Repo-relative path that exists and should be read */
  relativePath: string;
  absolutePath: string;
  hit: AssetHitSource;
  /** Candidates tried in order (relative) */
  candidates: string[];
};

export type AssetCandidateSet = {
  /** Preferred five-domain / write_entry paths */
  primary: string[];
  /** Compat / legacy readable paths */
  compat?: string[];
};

/** Well-known dual-location maps used by knowledge / catalog. */
export const ASSET_PATH_ALIASES: Record<string, AssetCandidateSet> = {
  "01_semantic/01_ontology/model_registry.yaml": {
    primary: ["01_semantic/01_ontology/model_registry.yaml"],
    compat: ["90_compat/ontology/01_通用/model_registry.yaml"],
  },
  "90_compat/ontology/01_通用/model_registry.yaml": {
    primary: ["01_semantic/01_ontology/model_registry.yaml"],
    compat: ["90_compat/ontology/01_通用/model_registry.yaml"],
  },
  "05_governance/01_架构/runtime_contexts.yaml": {
    primary: ["05_governance/01_架构/runtime_contexts.yaml"],
    compat: ["90_compat/governance_mirrors/architecture/runtime_contexts.yaml"],
  },
  "05_governance/03_校验/runtime_asset_coverage.yaml": {
    primary: ["05_governance/03_校验/runtime_asset_coverage.yaml"],
    compat: ["90_compat/governance_mirrors/validation/runtime_asset_coverage.yaml"],
  },
  // Dictionary: semantic authority; logical keys used by loaders/tests
  "01_semantic/01_ontology/00_投研本体框架概述.md": {
    primary: ["01_semantic/02_dictionary/00_投研本体框架概述.md"],
    compat: ["90_compat/ontology/01_通用/00_投研本体框架概述.md"],
  },
  "01_semantic/01_ontology/01_语义结构域规范.md": {
    primary: ["01_semantic/02_dictionary/01_语义结构域规范.md"],
    compat: ["90_compat/ontology/01_通用/01_语义结构域规范.md"],
  },
  "01_semantic/01_ontology/02_判断推理域规范.md": {
    primary: ["01_semantic/02_dictionary/02_判断推理域规范.md"],
    compat: ["90_compat/ontology/01_通用/02_判断推理域规范.md"],
  },
  "01_semantic/01_ontology/03_证据域规范.md": {
    primary: ["01_semantic/02_dictionary/03_证据域规范.md"],
    compat: ["90_compat/ontology/01_通用/03_证据域规范.md"],
  },
  "90_compat/ontology/01_通用/00_投研本体框架概述.md": {
    primary: ["01_semantic/02_dictionary/00_投研本体框架概述.md"],
    compat: ["90_compat/ontology/01_通用/00_投研本体框架概述.md"],
  },
  "90_compat/ontology/01_通用/01_语义结构域规范.md": {
    primary: ["01_semantic/02_dictionary/01_语义结构域规范.md"],
    compat: ["90_compat/ontology/01_通用/01_语义结构域规范.md"],
  },
  "90_compat/ontology/01_通用/02_判断推理域规范.md": {
    primary: ["01_semantic/02_dictionary/02_判断推理域规范.md"],
    compat: ["90_compat/ontology/01_通用/02_判断推理域规范.md"],
  },
  "90_compat/ontology/01_通用/03_证据域规范.md": {
    primary: ["01_semantic/02_dictionary/03_证据域规范.md"],
    compat: ["90_compat/ontology/01_通用/03_证据域规范.md"],
  },
  "01_semantic/01_ontology/domains/semiconductor/00_半导体领域本体概述.md": {
    primary: ["01_semantic/01_ontology/domains/semiconductor/00_半导体领域本体概述.md"],
    compat: ["90_compat/ontology/02_领域/semiconductor/00_半导体领域本体概述.md"],
  },
  "01_semantic/01_ontology/domains/semiconductor/01_半导体语义结构域说明.md": {
    primary: ["01_semantic/01_ontology/domains/semiconductor/01_半导体语义结构域说明.md"],
    compat: ["90_compat/ontology/02_领域/semiconductor/01_半导体语义结构域说明.md"],
  },
  "01_semantic/01_ontology/domains/semiconductor/02_半导体判断推理域说明.md": {
    primary: ["01_semantic/01_ontology/domains/semiconductor/02_半导体判断推理域说明.md"],
    compat: ["90_compat/ontology/02_领域/semiconductor/02_半导体判断推理域说明.md"],
  },
  "01_semantic/01_ontology/domains/semiconductor/03_半导体证据域说明.md": {
    primary: ["01_semantic/01_ontology/domains/semiconductor/03_半导体证据域说明.md"],
    compat: ["90_compat/ontology/02_领域/semiconductor/03_半导体证据域说明.md"],
  },
  "90_compat/ontology/02_领域/semiconductor/00_半导体领域本体概述.md": {
    primary: ["01_semantic/01_ontology/domains/semiconductor/00_半导体领域本体概述.md"],
    compat: ["90_compat/ontology/02_领域/semiconductor/00_半导体领域本体概述.md"],
  },
  "90_compat/ontology/02_领域/semiconductor/01_半导体语义结构域说明.md": {
    primary: ["01_semantic/01_ontology/domains/semiconductor/01_半导体语义结构域说明.md"],
    compat: ["90_compat/ontology/02_领域/semiconductor/01_半导体语义结构域说明.md"],
  },
  "90_compat/ontology/02_领域/semiconductor/02_半导体判断推理域说明.md": {
    primary: ["01_semantic/01_ontology/domains/semiconductor/02_半导体判断推理域说明.md"],
    compat: ["90_compat/ontology/02_领域/semiconductor/02_半导体判断推理域说明.md"],
  },
  "90_compat/ontology/02_领域/semiconductor/03_半导体证据域说明.md": {
    primary: ["01_semantic/01_ontology/domains/semiconductor/03_半导体证据域说明.md"],
    compat: ["90_compat/ontology/02_领域/semiconductor/03_半导体证据域说明.md"],
  },
  // B00–OPS: methods is sole prose authority
  "90_compat/methods/03_取证/B00_来源选择与使用边界.md": {
    primary: ["90_compat/methods/03_取证/B00_来源选择与使用边界.md"],
  },
  "90_compat/methods/03_取证/B01_通用来源速查.md": {
    primary: ["90_compat/methods/03_取证/B01_通用来源速查.md"],
  },
  "90_compat/methods/03_取证/B02_半导体来源速查.md": {
    primary: ["90_compat/methods/03_取证/B02_半导体来源速查.md"],
  },
  "90_compat/methods/03_取证/B03_MCP通道注册.md": {
    primary: ["90_compat/methods/03_取证/B03_MCP通道注册.md"],
  },
  "90_compat/methods/03_取证/OPS_MCP查询快速参考.md": {
    primary: ["90_compat/methods/03_取证/OPS_MCP查询快速参考.md"],
  },
};

function flattenCandidates(set: AssetCandidateSet): Array<{ path: string; hit: AssetHitSource }> {
  const out: Array<{ path: string; hit: AssetHitSource }> = [];
  for (const path of set.primary) out.push({ path, hit: "primary" });
  for (const path of set.compat || []) out.push({ path, hit: "compat" });
  return out;
}

export function resolveAssetPath(
  logicalPath: string,
  override?: AssetCandidateSet,
): ResolvedAssetPath | null {
  const set = override || ASSET_PATH_ALIASES[logicalPath] || { primary: [logicalPath] };
  const ordered = flattenCandidates(set);
  const candidates = ordered.map((item) => item.path);

  for (const item of ordered) {
    const absolutePath = repositoryPath(item.path);
    if (existsSync(absolutePath)) {
      return {
        relativePath: item.path,
        absolutePath,
        hit: item.hit,
        candidates,
      };
    }
  }
  return null;
}

export function requireAssetPath(logicalPath: string, override?: AssetCandidateSet): ResolvedAssetPath {
  const resolved = resolveAssetPath(logicalPath, override);
  if (!resolved) {
    const set = override || ASSET_PATH_ALIASES[logicalPath] || { primary: [logicalPath] };
    const joined = [...set.primary, ...(set.compat || [])].join(", ");
    throw new Error(`asset not found in candidates: ${joined}`);
  }
  return resolved;
}

/** Ontology model YAML: machine truth under 01_semantic/01_ontology/models/. */
export function ontologyModelFileCandidates(fileName: string): AssetCandidateSet {
  return {
    primary: [`01_semantic/01_ontology/models/${fileName}`],
    compat: [`90_compat/ontology/01_通用/models/${fileName}`],
  };
}

export function ontologyModelRegistryCandidates(): AssetCandidateSet {
  return {
    primary: ["01_semantic/01_ontology/model_registry.yaml"],
    compat: ["90_compat/ontology/01_通用/model_registry.yaml"],
  };
}
