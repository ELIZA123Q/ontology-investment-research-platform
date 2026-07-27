import "server-only";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { repositoryPath } from "../repo-paths";
import { runDatabaseMigrations, recoverOrphanedRunningArtifacts } from "../db_migrations";
const dbPath = process.env.WORKBENCH_DB_PATH
  ? path.resolve(/* turbopackIgnore: true */ process.cwd(), process.env.WORKBENCH_DB_PATH)
  : repositoryPath("instances", "00_本机运行", "workbench.sqlite");
mkdirSync(path.dirname(dbPath), { recursive: true });

export function getWorkbenchDatabaseIdentity() {
  const resolvedPath = path.resolve(dbPath);
  const temporaryRoots = [tmpdir(), "/tmp", "/private/tmp"]
    .map((root) => `${path.resolve(root)}${path.sep}`);
  const isTemporary = temporaryRoots.some((root) => resolvedPath.startsWith(root));
  return {
    path: resolvedPath,
    scope: isTemporary ? "temporary" as const : process.env.WORKBENCH_DB_PATH ? "custom" as const : "persistent_default" as const,
    cohort_eligible: !isTemporary,
  };
}

const globalDb = globalThis as unknown as { workbenchDb?: DatabaseSync };
function getDb() {
  if (globalDb.workbenchDb) return globalDb.workbenchDb;
  const connection = new DatabaseSync(dbPath);
  connection.exec("PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;");
  runDatabaseMigrations(connection);
  // 多进程 worker 会各自打开 SQLite；新进程启动不能误杀其他 worker
  // 仍持有有效 job 租约的 running artifact。仅回收无任务或租约已失效的遗留产物。
  recoverOrphanedRunningArtifacts(connection);
  globalDb.workbenchDb = connection;
  return connection;
}

/** Shared SQLite connection for page-oriented read models. */
export function getWorkbenchDb(): DatabaseSync {
  return getDb();
}

export const db = new Proxy({} as DatabaseSync, {
  get(_target, property) {
    const connection: any = getDb();
    const value = connection[property];
    return typeof value === "function" ? value.bind(connection) : value;
  },
});

export function withImmediateTransaction<T>(operation: () => T): T {
  const connection = getDb();
  connection.exec("BEGIN IMMEDIATE");
  try {
    const result = operation();
    connection.exec("COMMIT");
    return result;
  } catch (error) {
    connection.exec("ROLLBACK");
    throw error;
  }
}
