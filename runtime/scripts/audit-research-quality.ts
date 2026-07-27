/**
 * Offline regression audit: compare an approved Runtime run with the
 * in-repo memory-cycle formal_pack reference and fail on deterministic-degradation paths.
 *
 * Usage:
 *   npm run audit:research-quality -- --run=<run_id>
 *   npm run audit:research-quality
 */
import { DatabaseSync } from "node:sqlite";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

type ArtifactRow = {
  kind: string;
  markdown_content: string;
  json_content: string;
  model_name: string | null;
};

const repoRoot = resolve(process.cwd(), "..");
const defaultDb = resolve(repoRoot, "instances/00_本机运行/workbench.sqlite");
const dbPath = process.env.RESEARCH_WORKBENCH_DB || defaultDb;
const runArg = process.argv.find((arg) => arg.startsWith("--run="));
const requestedRunId = runArg?.slice("--run=".length).trim();

if (!existsSync(dbPath)) {
  throw new Error(`workbench database not found: ${dbPath}`);
}

const db = new DatabaseSync(dbPath, { readOnly: true });
const run = requestedRunId
  ? db.prepare("SELECT id, question, created_at FROM research_runs WHERE id = ?").get(requestedRunId)
  : db.prepare(`
      SELECT r.id, r.question, r.created_at
      FROM research_runs r
      WHERE r.question <> '归档测试'
        AND (
          SELECT COUNT(DISTINCT a.kind)
          FROM artifacts a
          WHERE a.run_id = r.id
            AND a.status = 'approved'
            AND a.kind IN ('stage_01','stage_02','stage_03','stage_04','stage_05')
        ) = 5
      ORDER BY r.created_at DESC
      LIMIT 1
    `).get();

if (!run) {
  throw new Error(requestedRunId
    ? `run not found: ${requestedRunId}`
    : "no non-archive run has five approved stages");
}

const runId = String((run as any).id);
const artifacts = db.prepare(`
  SELECT a.kind, a.markdown_content, a.json_content, a.model_name
  FROM artifacts a
  JOIN (
    SELECT kind, MAX(version) AS version
    FROM artifacts
    WHERE run_id = ? AND status = 'approved'
      AND kind IN ('stage_01','stage_02','stage_03','stage_04','stage_05')
    GROUP BY kind
  ) latest ON latest.kind = a.kind AND latest.version = a.version
  WHERE a.run_id = ?
  ORDER BY a.kind
`).all(runId, runId) as unknown as ArtifactRow[];

const goldDir = resolve(repoRoot, "instances/03_回归/02_memory-cycle-formal-pack");
const goldChars = new Map<string, number>();
for (const stage of ["01", "02", "03", "04", "05"]) {
  const filename = readdirSync(goldDir).find((name) =>
    name.startsWith(`${stage}-`) && name.endsWith(".md"),
  );
  if (!filename) throw new Error(`missing formal_pack Stage${stage} markdown fixture in ${goldDir}`);
  goldChars.set(`stage_${stage}`, readFileSync(resolve(goldDir, filename), "utf8").length);
}

function parseJson(value: string): any {
  try { return JSON.parse(value || "{}"); } catch { return {}; }
}

function judgmentLevel(item: any): string {
  return String(item?.judgment_level || item?.level || item?.strength || "unknown");
}

function stageMetrics(row: ArtifactRow): string {
  const data = parseJson(row.json_content);
  if (row.kind === "stage_03") {
    const drafts = Array.isArray(data.evidence_drafts) ? data.evidence_drafts : [];
    const facts = drafts.filter((item: any) => String(item?.kind || "") !== "gap").length;
    const gaps = drafts.filter((item: any) => String(item?.kind || "") === "gap").length;
    const sources = Array.isArray(data.sources) ? data.sources.length : 0;
    return `facts=${facts}, gaps=${gaps}, sources=${sources}`;
  }
  if (row.kind === "stage_04") {
    const judgments = Array.isArray(data.judgments)
      ? data.judgments
      : Array.isArray(data.judgment_outputs) ? data.judgment_outputs : [];
    const levels = judgments.map(judgmentLevel);
    return levels.length ? `judgments=${levels.join("/")}` : "judgments=0";
  }
  if (row.kind === "stage_05") {
    const review = data.research_value_review;
    return `research_value=${String(review?.status || "missing")}, score=${Number(review?.total_score || 0)}/20`;
  }
  return "";
}

const blockers: string[] = [];
const rows = artifacts.map((artifact) => {
  const current = artifact.markdown_content.length;
  const baseline = goldChars.get(artifact.kind) || 0;
  const ratio = baseline ? current / baseline : 0;
  const data = parseJson(artifact.json_content);
  if (/^runtime-deterministic-.*fallback$/.test(String(artifact.model_name || ""))) {
    blockers.push(`${artifact.kind} used ${artifact.model_name}`);
  }
  if (artifact.kind === "stage_03") {
    const drafts = Array.isArray(data.evidence_drafts) ? data.evidence_drafts : [];
    const facts = drafts.filter((item: any) => String(item?.kind || "") !== "gap").length;
    if (!facts) blockers.push("stage_03 has zero non-gap evidence drafts");
  }
  if (artifact.kind === "stage_04") {
    const judgments = Array.isArray(data.judgments)
      ? data.judgments
      : Array.isArray(data.judgment_outputs) ? data.judgment_outputs : [];
    if (judgments.length && judgments.every((item: any) =>
      judgmentLevel(item) === "J0",
    )) blockers.push("stage_04 contains only J0 judgments");
  }
  if (artifact.kind === "stage_05") {
    if (current < 5_000) blockers.push(`stage_05 is too thin for researcher delivery (${current} chars)`);
    if (data.research_value_review?.status !== "pass") {
      blockers.push("stage_05 research_value_review is missing or failed");
    }
  }
  return {
    stage: artifact.kind,
    current_chars: current,
    gold_chars: baseline,
    ratio: `${Math.round(ratio * 100)}%`,
    model: artifact.model_name || "",
    research_signal: stageMetrics(artifact),
  };
});

if (artifacts.length !== 5) blockers.push(`approved stages=${artifacts.length}/5`);

console.log(`Run: ${runId}`);
console.log(`Question: ${String((run as any).question || "")}`);
console.table(rows);
if (blockers.length) {
  console.error("Research-quality blockers:");
  for (const blocker of blockers) console.error(`- ${blocker}`);
  process.exitCode = 1;
} else {
  console.log("Research-quality regression audit: PASS");
}
