import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, extname, relative, resolve, sep } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type {
  HybridRetrievalQuery,
  HybridRetrievalResult,
  SemanticAssetDocument,
  SemanticAssetKind,
  SemanticGateway,
} from "@/src/semantic/graph-contracts";

const sha256 = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const SUPPORTED_EXTENSIONS = new Set([".md", ".yaml", ".yml", ".json", ".csv"]);
const MAX_ASSET_BYTES = 512_000;

const INDEX_ROOTS: ReadonlyArray<{ path: string; kind: SemanticAssetKind }> = [
  { path: "01_semantic_knowledge/01_ontology", kind: "ontology" },
  { path: "01_semantic_knowledge/02_dictionary", kind: "dictionary" },
  { path: "03_agent_capability/02_skills", kind: "method" },
  { path: "05_control_evaluation/04_verifiers/fixtures/regression", kind: "historical_artifact" },
];

export function resolveRepositoryRoot(start = process.cwd()): string {
  const configured = process.env.VNEXT_REPO_ROOT?.trim();
  const candidates = configured ? [resolve(configured)] : [resolve(start), resolve(start, "..")];
  const found = candidates.find((candidate) => existsSync(resolve(candidate, "01_semantic_knowledge/registry.yaml")));
  if (!found) throw new Error("Cannot locate repository root; set VNEXT_REPO_ROOT.");
  return found;
}

function titleFrom(path: string, body: string): string {
  const markdownTitle = body.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return markdownTitle || basename(path, extname(path));
}

function tokenize(text: string): string[] {
  const normalized = text.toLowerCase();
  const latin = normalized.match(/[a-z0-9][a-z0-9._-]{1,}/g) || [];
  const cjkRuns = normalized.match(/[\u3400-\u9fff]{2,}/g) || [];
  const cjk = cjkRuns.flatMap((run) => run.length <= 4 ? [run] : Array.from({ length: run.length - 1 }, (_, index) => run.slice(index, index + 2)));
  return [...new Set([...latin, ...cjk])].slice(0, 48);
}

function lexicalScore(query: string, document: SemanticAssetDocument): number {
  const haystack = `${document.title}\n${document.path}\n${document.body}`.toLowerCase();
  const terms = tokenize(query);
  if (!terms.length) return 0;
  const matches = terms.filter((term) => haystack.includes(term));
  if (!matches.length) return 0;
  const title = document.title.toLowerCase();
  const titleBoost = matches.filter((term) => title.includes(term)).length * 0.2;
  return Math.min(1, matches.length / Math.max(3, terms.length) + titleBoost);
}

export class LocalSemanticGateway implements SemanticGateway {
  constructor(readonly db: DatabaseSync, readonly repositoryRoot = resolveRepositoryRoot()) {
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS semantic_assets (
        id TEXT PRIMARY KEY, kind TEXT NOT NULL, path TEXT UNIQUE NOT NULL, title TEXT NOT NULL,
        version INTEGER NOT NULL, content_hash TEXT NOT NULL, modified_at TEXT NOT NULL, body TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS semantic_assets_kind_path ON semantic_assets(kind, path);
    `);
    try {
      this.db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS semantic_assets_fts USING fts5(asset_id UNINDEXED, title, body)");
    } catch {
      // Structured and deterministic lexical retrieval remain available without FTS5.
    }
  }

  buildIndex(): { indexed: number; unchanged: number; removed: number } {
    const seen = new Set<string>();
    let indexed = 0;
    let unchanged = 0;
    for (const root of INDEX_ROOTS) {
      const absoluteRoot = resolve(this.repositoryRoot, root.path);
      if (!existsSync(absoluteRoot)) continue;
      for (const absolutePath of this.walk(absoluteRoot)) {
        const relativePath = relative(this.repositoryRoot, absolutePath);
        const kind = relativePath.includes(`${sep}source_captures${sep}`) ? "source_snapshot" : root.kind;
        const body = readFileSync(absolutePath, "utf8");
        const contentHash = sha256(body);
        const prior = this.db.prepare("SELECT version, content_hash FROM semantic_assets WHERE path=?").get(relativePath) as { version?: number; content_hash?: string } | undefined;
        const id = `asset:${createHash("sha256").update(relativePath).digest("hex").slice(0, 24)}`;
        seen.add(relativePath);
        if (prior?.content_hash === contentHash) { unchanged += 1; continue; }
        const document: SemanticAssetDocument = {
          id,
          kind,
          path: relativePath,
          title: titleFrom(relativePath, body),
          version: Number(prior?.version || 0) + 1,
          contentHash,
          modifiedAt: statSync(absolutePath).mtime.toISOString(),
          body,
        };
        this.db.prepare(`INSERT INTO semantic_assets (id,kind,path,title,version,content_hash,modified_at,body)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(path) DO UPDATE SET kind=excluded.kind,title=excluded.title,version=excluded.version,
          content_hash=excluded.content_hash,modified_at=excluded.modified_at,body=excluded.body`)
          .run(document.id, document.kind, document.path, document.title, document.version, document.contentHash, document.modifiedAt, document.body);
        try {
          this.db.prepare("DELETE FROM semantic_assets_fts WHERE asset_id=?").run(document.id);
          this.db.prepare("INSERT INTO semantic_assets_fts (asset_id,title,body) VALUES (?, ?, ?)").run(document.id, document.title, document.body);
        } catch { /* optional FTS */ }
        indexed += 1;
      }
    }
    const existing = this.db.prepare("SELECT path,id FROM semantic_assets").all() as Array<{ path: string; id: string }>;
    const stale = existing.filter((row) => !seen.has(row.path));
    for (const row of stale) {
      this.db.prepare("DELETE FROM semantic_assets WHERE path=?").run(row.path);
      try { this.db.prepare("DELETE FROM semantic_assets_fts WHERE asset_id=?").run(row.id); } catch { /* optional FTS */ }
    }
    return { indexed, unchanged, removed: stale.length };
  }

  async search(query: HybridRetrievalQuery): Promise<HybridRetrievalResult[]> {
    return this.searchSync(query);
  }

  searchSync(query: HybridRetrievalQuery): HybridRetrievalResult[] {
    const allowedKinds = query.kinds?.length ? new Set(query.kinds) : null;
    const rows = this.db.prepare("SELECT * FROM semantic_assets").all() as Array<Record<string, unknown>>;
    const ftsIds = new Set<string>();
    if (query.strategies.includes("fts")) {
      const terms = tokenize(query.text).filter((term) => /^[a-z0-9._-]+$/i.test(term)).slice(0, 8);
      if (terms.length) {
        try {
          const ftsQuery = terms.map((term) => `\"${term.replaceAll("\"", "\"\"")}\"`).join(" OR ");
          const matches = this.db.prepare("SELECT asset_id FROM semantic_assets_fts WHERE semantic_assets_fts MATCH ? LIMIT 100").all(ftsQuery) as Array<{ asset_id: string }>;
          for (const match of matches) ftsIds.add(match.asset_id);
        } catch { /* deterministic lexical fallback below */ }
      }
    }
    return rows
      .map((row) => this.mapDocument(row))
      .filter((document) => !allowedKinds || allowedKinds.has(document.kind))
      .map((document) => {
        const lexical = lexicalScore(query.text, document);
        const ftsBoost = ftsIds.has(document.id) ? 0.25 : 0;
        const structuredBoost = query.strategies.includes("structured") && document.path.toLowerCase().includes(query.text.toLowerCase()) ? 0.2 : 0;
        const score = Math.min(1, lexical + ftsBoost + structuredBoost);
        return { document, score, ftsBoost };
      })
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score || a.document.path.localeCompare(b.document.path))
      .slice(0, Math.max(1, query.limit))
      .map(({ document, score, ftsBoost }) => ({
        refId: document.id,
        kind: document.kind,
        path: document.path,
        title: document.title,
        version: document.version,
        score,
        reason: ftsBoost ? "FTS 命中并通过确定性词项复核" : "结构化资产词项匹配",
      }));
  }

  getAsset(id: string): SemanticAssetDocument | null {
    const row = this.db.prepare("SELECT * FROM semantic_assets WHERE id=?").get(id) as Record<string, unknown> | undefined;
    return row ? this.mapDocument(row) : null;
  }

  private walk(root: string): string[] {
    const files: string[] = [];
    const visit = (directory: string) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
        const path = resolve(directory, entry.name);
        if (entry.isDirectory()) visit(path);
        else if (SUPPORTED_EXTENSIONS.has(extname(entry.name).toLowerCase()) && statSync(path).size <= MAX_ASSET_BYTES) files.push(path);
      }
    };
    visit(root);
    return files.sort();
  }

  private mapDocument(row: Record<string, unknown>): SemanticAssetDocument {
    return {
      id: String(row.id),
      kind: row.kind as SemanticAssetKind,
      path: String(row.path),
      title: String(row.title),
      version: Number(row.version),
      contentHash: String(row.content_hash),
      modifiedAt: String(row.modified_at),
      body: String(row.body),
    };
  }
}
