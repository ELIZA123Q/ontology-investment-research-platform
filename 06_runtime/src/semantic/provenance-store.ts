import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { EvidenceFact, ProvenanceEdge, SourceSnapshot } from "@/src/contracts";
import { verifyEvidenceFactPromotion, verifySourceSnapshot } from "@/src/governance/provenance-verifier";

const now = () => new Date().toISOString();
const stableId = (prefix: string, value: string) => `${prefix}:${createHash("sha256").update(value).digest("hex").slice(0, 24)}`;

export class ResearchProvenanceStore {
  constructor(readonly db: DatabaseSync) {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS source_snapshots (
        id TEXT PRIMARY KEY, candidate_id TEXT NOT NULL, uri TEXT NOT NULL, title TEXT NOT NULL,
        source_type TEXT NOT NULL DEFAULT 'secondary', repository_path TEXT, locator TEXT NOT NULL, quote TEXT NOT NULL, body TEXT NOT NULL,
        content_hash TEXT NOT NULL, captured_at TEXT NOT NULL, permission_scope TEXT NOT NULL,
        verification TEXT NOT NULL, published_at TEXT, publisher_id TEXT,
        connector_id TEXT NOT NULL DEFAULT 'legacy', upstream_source_id TEXT NOT NULL DEFAULT '',
        request_fingerprint TEXT NOT NULL DEFAULT '', request_parameters_json TEXT NOT NULL DEFAULT '{}',
        raw_response_hash TEXT NOT NULL DEFAULT '', retrieved_at TEXT NOT NULL DEFAULT '',
        document_raw_content_hash TEXT, document_byte_length INTEGER, document_mime_type TEXT,
        UNIQUE(candidate_id, content_hash)
      );
      CREATE TABLE IF NOT EXISTS evidence_facts (
        id TEXT PRIMARY KEY, snapshot_id TEXT NOT NULL REFERENCES source_snapshots(id), statement TEXT NOT NULL,
        fact_type TEXT NOT NULL, business_time TEXT, confidence TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL,
        UNIQUE(snapshot_id, statement)
      );
      CREATE TABLE IF NOT EXISTS provenance_edges (
        id TEXT PRIMARY KEY, from_id TEXT NOT NULL, to_id TEXT NOT NULL, predicate TEXT NOT NULL,
        created_at TEXT NOT NULL, UNIQUE(from_id, to_id, predicate)
      );
      CREATE INDEX IF NOT EXISTS evidence_facts_snapshot ON evidence_facts(snapshot_id);
      CREATE INDEX IF NOT EXISTS provenance_edges_from ON provenance_edges(from_id, predicate);
      CREATE INDEX IF NOT EXISTS provenance_edges_to ON provenance_edges(to_id, predicate);
    `);
    const columns = this.db.prepare("PRAGMA table_info(source_snapshots)").all() as Array<{ name: string }>;
    const migrations: Array<[string, string]> = [
      ["source_type", "TEXT NOT NULL DEFAULT 'secondary'"],
      ["published_at", "TEXT"],
      ["publisher_id", "TEXT"],
      ["connector_id", "TEXT NOT NULL DEFAULT 'legacy'"],
      ["upstream_source_id", "TEXT NOT NULL DEFAULT ''"],
      ["request_fingerprint", "TEXT NOT NULL DEFAULT ''"],
      ["request_parameters_json", "TEXT NOT NULL DEFAULT '{}'"],
      ["raw_response_hash", "TEXT NOT NULL DEFAULT ''"],
      ["retrieved_at", "TEXT NOT NULL DEFAULT ''"],
      ["document_raw_content_hash", "TEXT"],
      ["document_byte_length", "INTEGER"],
      ["document_mime_type", "TEXT"],
    ];
    for (const [name, definition] of migrations) {
      if (!columns.some((column) => column.name === name)) this.db.exec(`ALTER TABLE source_snapshots ADD COLUMN ${name} ${definition}`);
    }
  }

  saveSnapshot(input: Omit<SourceSnapshot, "id" | "verification">): SourceSnapshot {
    const proposed: SourceSnapshot = { ...input, id: stableId("snapshot", `${input.candidateId}:${input.contentHash}`), verification: "unverified" };
    const verification = verifySourceSnapshot(proposed);
    const snapshot = { ...proposed, verification: verification.passed ? "verified" as const : "rejected" as const };
    this.db.prepare(`INSERT INTO source_snapshots
      (id,candidate_id,uri,title,source_type,repository_path,locator,quote,body,content_hash,captured_at,permission_scope,verification,
       published_at,publisher_id,connector_id,upstream_source_id,request_fingerprint,request_parameters_json,raw_response_hash,retrieved_at,
       document_raw_content_hash,document_byte_length,document_mime_type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(candidate_id,content_hash) DO UPDATE SET locator=excluded.locator,quote=excluded.quote,
      body=excluded.body,captured_at=excluded.captured_at,permission_scope=excluded.permission_scope,verification=excluded.verification,
      published_at=excluded.published_at,publisher_id=excluded.publisher_id,connector_id=excluded.connector_id,
      upstream_source_id=excluded.upstream_source_id,request_fingerprint=excluded.request_fingerprint,
      request_parameters_json=excluded.request_parameters_json,raw_response_hash=excluded.raw_response_hash,retrieved_at=excluded.retrieved_at,
      document_raw_content_hash=excluded.document_raw_content_hash,document_byte_length=excluded.document_byte_length,document_mime_type=excluded.document_mime_type`)
      .run(snapshot.id, snapshot.candidateId, snapshot.uri, snapshot.title, snapshot.sourceType, snapshot.repositoryPath ?? null,
        snapshot.locator, snapshot.quote, snapshot.body, snapshot.contentHash, snapshot.capturedAt,
        snapshot.permissionScope, snapshot.verification, snapshot.publishedAt ?? null, snapshot.publisherId ?? null,
        snapshot.acquisition.connectorId, snapshot.acquisition.upstreamSourceId, snapshot.acquisition.requestFingerprint,
        JSON.stringify(snapshot.acquisition.requestParameters), snapshot.acquisition.rawResponseHash, snapshot.acquisition.retrievedAt,
        snapshot.documentAttestation?.rawContentHash ?? null, snapshot.documentAttestation?.byteLength ?? null, snapshot.documentAttestation?.mimeType ?? null);
    this.addEdge(snapshot.candidateId, snapshot.id, "captured_as");
    return snapshot;
  }

  getSnapshot(id: string): SourceSnapshot | null {
    const row = this.db.prepare("SELECT * FROM source_snapshots WHERE id=?").get(id) as Record<string, unknown> | undefined;
    return row ? this.mapSnapshot(row) : null;
  }

  promoteFact(input: {
    snapshotId: string;
    statement: string;
    factType: EvidenceFact["factType"];
    businessTime?: string;
    confidence: EvidenceFact["confidence"];
  }): EvidenceFact {
    const snapshot = this.getSnapshot(input.snapshotId);
    if (!snapshot) throw new Error(`Source snapshot not found: ${input.snapshotId}`);
    const verification = verifyEvidenceFactPromotion(snapshot, input);
    if (!verification.passed) throw new Error(verification.errors.join("; "));
    const fact: EvidenceFact = {
      ...input,
      id: stableId("fact", `${input.snapshotId}:${input.statement}`),
      status: "verified",
      createdAt: now(),
    };
    this.db.prepare(`INSERT INTO evidence_facts (id,snapshot_id,statement,fact_type,business_time,confidence,status,created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(snapshot_id,statement) DO NOTHING`)
      .run(fact.id, fact.snapshotId, fact.statement, fact.factType, fact.businessTime ?? null, fact.confidence, fact.status, fact.createdAt);
    this.addEdge(snapshot.id, fact.id, "derived_from");
    return this.getFact(fact.id) || fact;
  }

  getFact(id: string): EvidenceFact | null {
    const row = this.db.prepare("SELECT * FROM evidence_facts WHERE id=?").get(id) as Record<string, unknown> | undefined;
    return row ? this.mapFact(row) : null;
  }

  listFacts(snapshotIds?: string[]): EvidenceFact[] {
    if (!snapshotIds?.length) return (this.db.prepare("SELECT * FROM evidence_facts ORDER BY created_at").all() as Record<string, unknown>[]).map((row) => this.mapFact(row));
    const placeholders = snapshotIds.map(() => "?").join(",");
    return (this.db.prepare(`SELECT * FROM evidence_facts WHERE snapshot_id IN (${placeholders}) ORDER BY created_at`).all(...snapshotIds) as Record<string, unknown>[]).map((row) => this.mapFact(row));
  }

  addEdge(fromId: string, toId: string, predicate: ProvenanceEdge["predicate"]): ProvenanceEdge {
    const edge: ProvenanceEdge = { id: stableId("edge", `${fromId}:${predicate}:${toId}`), fromId, toId, predicate, createdAt: now() };
    this.db.prepare("INSERT OR IGNORE INTO provenance_edges VALUES (?, ?, ?, ?, ?)").run(edge.id, edge.fromId, edge.toId, edge.predicate, edge.createdAt);
    return edge;
  }

  lineage(id: string): { upstream: ProvenanceEdge[]; downstream: ProvenanceEdge[] } {
    const upstream = (this.db.prepare("SELECT * FROM provenance_edges WHERE to_id=? ORDER BY created_at").all(id) as Record<string, unknown>[]).map(this.mapEdge);
    const downstream = (this.db.prepare("SELECT * FROM provenance_edges WHERE from_id=? ORDER BY created_at").all(id) as Record<string, unknown>[]).map(this.mapEdge);
    return { upstream, downstream };
  }

  private mapSnapshot(row: Record<string, unknown>): SourceSnapshot {
    return { id: String(row.id), candidateId: String(row.candidate_id), uri: String(row.uri), title: String(row.title), sourceType: row.source_type as SourceSnapshot["sourceType"],
      repositoryPath: row.repository_path ? String(row.repository_path) : undefined, locator: String(row.locator), quote: String(row.quote),
      body: String(row.body), contentHash: String(row.content_hash), capturedAt: String(row.captured_at),
      publishedAt: row.published_at ? String(row.published_at) : undefined, publisherId: row.publisher_id ? String(row.publisher_id) : undefined,
      permissionScope: row.permission_scope as SourceSnapshot["permissionScope"], verification: row.verification as SourceSnapshot["verification"],
      documentAttestation: row.document_raw_content_hash ? { rawContentHash: String(row.document_raw_content_hash), byteLength: Number(row.document_byte_length), mimeType: String(row.document_mime_type) } : undefined,
      acquisition: {
        connectorId: String(row.connector_id || "legacy"), upstreamSourceId: String(row.upstream_source_id || row.candidate_id),
        requestFingerprint: String(row.request_fingerprint || row.content_hash),
        requestParameters: parseJsonObject(row.request_parameters_json), rawResponseHash: String(row.raw_response_hash || row.content_hash),
        retrievedAt: String(row.retrieved_at || row.captured_at),
      } };
  }

  private mapFact(row: Record<string, unknown>): EvidenceFact {
    return { id: String(row.id), snapshotId: String(row.snapshot_id), statement: String(row.statement), factType: row.fact_type as EvidenceFact["factType"],
      businessTime: row.business_time ? String(row.business_time) : undefined, confidence: row.confidence as EvidenceFact["confidence"],
      status: row.status as EvidenceFact["status"], createdAt: String(row.created_at) };
  }

  private mapEdge = (row: Record<string, unknown>): ProvenanceEdge => ({ id: String(row.id || randomUUID()), fromId: String(row.from_id), toId: String(row.to_id), predicate: row.predicate as ProvenanceEdge["predicate"], createdAt: String(row.created_at) });
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}
