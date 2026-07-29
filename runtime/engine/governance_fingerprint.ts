/**
 * 三库治理指纹：knowledge + ontology slice + method guidance。
 * knowledge_version DB 列保留为兼容别名，内容为本组合指纹。
 */

import { createHash } from "node:crypto";
import type { KnowledgeFileInjection } from "./context_assembler";
import type { MethodGuidanceExcerpt } from "./method_guidance";

export type GovernanceLibraryFingerprint = {
  source_version: string;
  injected_version: string;
  files: string[];
  omitted: Array<{ file?: string; method_id?: string; reason: string }>;
  file_injections?: KnowledgeFileInjection[];
};

export type GovernanceFingerprintDetail = {
  knowledge: GovernanceLibraryFingerprint;
  ontology: GovernanceLibraryFingerprint;
  method_guidance: GovernanceLibraryFingerprint;
  scenario_card_ids: string[];
  structured_keys: string[];
  route?: {
    judgment_types?: string[];
    ontology_node_ids?: string[];
    judgment_unit_ids?: string[];
  };
};

export function hashText(text: string): string {
  return `sha256:${createHash("sha256").update(text).digest("hex")}`;
}

export function buildGovernanceFingerprint(input: {
  knowledge_source_version: string;
  knowledge_injected_version: string;
  knowledge_files: string[];
  knowledge_file_injections?: KnowledgeFileInjection[];
  ontology_source_version?: string;
  ontology_injected_text: string;
  ontology_files: string[];
  method_guidance?: MethodGuidanceExcerpt[];
  scenario_card_ids?: string[];
  structured_keys?: string[];
  route?: GovernanceFingerprintDetail["route"];
}): { governance_version: string; detail: GovernanceFingerprintDetail } {
  const injections = input.knowledge_file_injections || [];
  const knowledgeOmitted = injections
    .filter((item) => !item.loaded)
    .map((item) => ({ file: item.file, reason: item.omitted_reason || "not_loaded" }));
  const guidance = input.method_guidance || [];
  const guidanceInjected = hashText(
    guidance.map((item) => `${item.method_id}\0${item.file}\0${item.excerpt}`).join("\n"),
  );
  const guidanceSource = hashText(
    guidance.map((item) => `${item.method_id}\0${item.file}\0${item.content_hash || ""}`).join("\n"),
  );
  const ontologyInjected = hashText(input.ontology_injected_text || "");
  const detail: GovernanceFingerprintDetail = {
    knowledge: {
      source_version: input.knowledge_source_version || "none",
      injected_version: input.knowledge_injected_version || "none",
      files: [...input.knowledge_files],
      omitted: knowledgeOmitted,
      file_injections: injections,
    },
    ontology: {
      source_version: input.ontology_source_version || ontologyInjected,
      injected_version: ontologyInjected,
      files: [...input.ontology_files],
      omitted: [],
    },
    method_guidance: {
      source_version: guidanceSource,
      injected_version: guidanceInjected,
      files: guidance.map((item) => item.file),
      omitted: [],
    },
    scenario_card_ids: [...(input.scenario_card_ids || [])],
    structured_keys: [...(input.structured_keys || [])],
    route: input.route,
  };
  const governance_version = hashText(JSON.stringify({
    knowledge: {
      source: detail.knowledge.source_version,
      injected: detail.knowledge.injected_version,
      files: detail.knowledge.files,
      injections: (detail.knowledge.file_injections || []).map((item) => ({
        file: item.file,
        included_chars: item.included_chars,
        truncated: item.truncated,
        omitted_reason: item.omitted_reason,
        content_hash: item.content_hash,
        loaded: item.loaded,
      })),
    },
    ontology: {
      source: detail.ontology.source_version,
      injected: detail.ontology.injected_version,
      files: detail.ontology.files,
    },
    method_guidance: {
      source: detail.method_guidance.source_version,
      injected: detail.method_guidance.injected_version,
      ids: guidance.map((item) => item.method_id),
      files: detail.method_guidance.files,
      hashes: guidance.map((item) => item.content_hash || ""),
    },
    scenario_card_ids: detail.scenario_card_ids,
    structured_keys: detail.structured_keys,
    route: detail.route || null,
  }));
  return { governance_version, detail };
}
