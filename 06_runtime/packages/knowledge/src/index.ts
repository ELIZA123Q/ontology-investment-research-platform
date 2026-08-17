import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { Fingerprint, KnowledgeRef } from "@investment/domain";

const fingerprintSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/).transform((value) => value as Fingerprint);
export const knowledgeBundleManifestSchema = z.object({
  schemaName: z.literal("investment_knowledge_bundle_manifest"),
  schemaVersion: z.string().min(1),
  bundleId: fingerprintSchema,
  createdAt: z.string().datetime(),
  sourceFingerprint: fingerprintSchema,
  compatibility: z.object({ runtime: z.string().min(1), ontology: z.string().min(1) }),
  components: z.record(z.string(), z.object({ fingerprint: fingerprintSchema, assetCount: z.number().int().nonnegative() })),
  sourceFingerprints: z.record(z.string(), fingerprintSchema),
});

export const knowledgeBundleSchema = z.object({
  schemaName: z.literal("investment_knowledge_bundle"),
  schemaVersion: z.string().min(1),
  bundleId: fingerprintSchema,
  domain: z.record(z.string(), z.unknown()),
  ontology: z.record(z.string(), z.unknown()),
  index: z.object({
    assetsById: z.record(z.string(), z.object({ component: z.string(), authorityRef: z.string(), version: z.string() })),
    referencesByAsset: z.record(z.string(), z.array(z.string())),
  }),
});

export type KnowledgeBundleManifest = z.infer<typeof knowledgeBundleManifestSchema>;
export type KnowledgeBundle = z.infer<typeof knowledgeBundleSchema>;

export interface ReleasedKnowledgeAsset {
  assetId: string;
  kind: string;
  version: number;
  fingerprint: string;
  authorityRef: string;
  content: unknown;
  provenanceRefs: string[];
}

export class KnowledgeBundleCompatibilityError extends Error {
  readonly code = "knowledge_bundle_incompatible";
}

export class KnowledgeBundleLoader {
  constructor(readonly bundleRoot: string, readonly supportedRuntime = "1.x") {}

  load(bundleId: string): { manifest: KnowledgeBundleManifest; bundle: KnowledgeBundle } {
    const directory = resolve(this.bundleRoot, bundleId.replace("sha256:", ""));
    const manifest = knowledgeBundleManifestSchema.parse(JSON.parse(readFileSync(resolve(directory, "manifest.json"), "utf8")));
    const bundle = knowledgeBundleSchema.parse(JSON.parse(readFileSync(resolve(directory, "bundle.json"), "utf8")));
    if (manifest.bundleId !== bundle.bundleId || manifest.bundleId !== bundleId) throw new KnowledgeBundleCompatibilityError("Knowledge bundle identity mismatch");
    if (manifest.compatibility.runtime !== this.supportedRuntime) throw new KnowledgeBundleCompatibilityError(`Runtime requires ${this.supportedRuntime}, bundle requires ${manifest.compatibility.runtime}`);
    return { manifest, bundle };
  }

  loadCurrent(): { manifest: KnowledgeBundleManifest; bundle: KnowledgeBundle } {
    const pointer = z.object({ bundleId: fingerprintSchema }).parse(JSON.parse(readFileSync(resolve(this.bundleRoot, "current.json"), "utf8")));
    return this.load(pointer.bundleId);
  }

  references(bundle: KnowledgeBundle, assetIds: readonly string[]): KnowledgeRef[] {
    return assetIds.map((assetId) => {
      const asset = bundle.index.assetsById[assetId];
      if (!asset) throw new Error(`Knowledge asset not found: ${assetId}`);
      return { bundleId: bundle.bundleId, assetId, version: asset.version, authorityRef: asset.authorityRef };
    });
  }

  materializeRelease(input: { releaseId: string; assets: ReleasedKnowledgeAsset[] }): { manifest: KnowledgeBundleManifest; bundle: KnowledgeBundle } {
    const base = this.loadCurrent();
    if (!input.assets.length) return base;
    const domain = structuredClone(base.bundle.domain);
    domain.releasedKnowledge = {
      releaseId: input.releaseId,
      assets: Object.fromEntries([...input.assets].sort((a, b) => a.assetId.localeCompare(b.assetId)).map((asset) => [asset.assetId, asset])),
    };
    const assetsById = structuredClone(base.bundle.index.assetsById);
    const referencesByAsset = structuredClone(base.bundle.index.referencesByAsset);
    for (const asset of input.assets) {
      const assetId = `released:${asset.assetId}`;
      assetsById[assetId] = { component: "releasedKnowledge", authorityRef: asset.authorityRef, version: String(asset.version) };
      referencesByAsset[assetId] = [];
    }
    const body = {
      schemaName: "investment_knowledge_bundle" as const,
      schemaVersion: "1.0.0",
      domain,
      ontology: base.bundle.ontology,
      index: { assetsById, referencesByAsset },
    };
    const stableHash = (value: unknown): Fingerprint => {
      const normalize = (item: unknown): unknown => Array.isArray(item) ? item.map(normalize) : item && typeof item === "object"
        ? Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, nested]) => [key, normalize(nested)])) : item;
      return `sha256:${createHash("sha256").update(JSON.stringify(normalize(value))).digest("hex")}` as Fingerprint;
    };
    const bundleId = stableHash(body);
    const bundle = knowledgeBundleSchema.parse({ ...body, bundleId });
    const releaseFingerprint = stableHash(input.assets);
    const manifest = knowledgeBundleManifestSchema.parse({
      ...base.manifest,
      bundleId,
      createdAt: new Date().toISOString(),
      sourceFingerprint: stableHash({ base: base.manifest.sourceFingerprint, release: releaseFingerprint }),
      components: {
        ...base.manifest.components,
        releasedKnowledge: { fingerprint: releaseFingerprint, assetCount: input.assets.length },
      },
    });
    const directory = resolve(this.bundleRoot, bundleId.replace("sha256:", ""));
    mkdirSync(directory, { recursive: true });
    const bundlePath = resolve(directory, "bundle.json");
    const manifestPath = resolve(directory, "manifest.json");
    if (existsSync(bundlePath) && existsSync(manifestPath)) return this.load(bundleId);
    if (!existsSync(bundlePath)) writeFileSync(bundlePath, JSON.stringify(bundle, null, 2), "utf8");
    if (!existsSync(manifestPath)) writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
    return { manifest, bundle };
  }
}
