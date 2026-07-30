/**
 * 存量修复：以「实际已批准（approved）的 stage 产出」为进度唯一真相源，
 * 重算所有 run 的 current_stage 与 status，修正 approveArtifact 单向推进、
 * 以及 supersede 降级已批准产出时不回退导致的进度漂移。
 *
 * 使用 node:sqlite 直接操作，避开 server-only，可独立运行。
 *
 * Usage:
 *   node --experimental-strip-types scripts/recompute-run-progress.ts
 *   npm run recompute:run-progress
 */
import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";

const repoRoot = resolve(process.cwd(), "..");
const defaultDb = resolve(repoRoot, "instances/00_本机运行/workbench.sqlite");
const dbPath = process.env.RESEARCH_WORKBENCH_DB || process.env.WORKBENCH_DB_PATH || defaultDb;

const db = new DatabaseSync(dbPath);
db.exec("PRAGMA busy_timeout = 5000;");

const runs = db.prepare("SELECT id, current_stage, status FROM research_runs").all() as Array<{
  id: string;
  current_stage: number;
  status: string;
}>;

let fixed = 0;
const cases: Array<{ id: string; before: string; after: string }> = [];
for (const run of runs) {
  const row = db.prepare(
    "SELECT MAX(CAST(SUBSTR(kind,-2) AS INT)) AS m FROM artifacts WHERE run_id=? AND status='approved' AND kind LIKE 'stage_%'",
  ).get(run.id) as { m: number | null };
  const maxStage = Number(row?.m || 0);
  let status = run.status;
  if (maxStage >= 5) status = "complete";
  else if (maxStage > 0) status = "in_progress";
  // maxStage === 0 时保持原 status（草稿/归档语义不被误改）
  if (maxStage !== run.current_stage || status !== run.status) {
    db.prepare("UPDATE research_runs SET current_stage=?, status=?, updated_at=? WHERE id=?").run(
      maxStage,
      status,
      new Date().toISOString(),
      run.id,
    );
    fixed++;
    cases.push({ id: run.id, before: `${run.current_stage}/${run.status}`, after: `${maxStage}/${status}` });
  }
}

console.log(`共检查 ${runs.length} 个 run，修正 ${fixed} 个进度漂移：`);
for (const c of cases) console.log(`  ${c.id}: ${c.before} -> ${c.after}`);
if (fixed === 0) console.log("  无漂移，无需修正。");
