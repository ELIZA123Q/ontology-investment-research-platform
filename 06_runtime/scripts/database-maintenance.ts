import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { RuntimeStore, defaultDatabasePath } from "@/src/runtime/store";

const command = process.argv[2] || "check";
const databasePath = resolve(defaultDatabasePath());

if (command === "check") {
  const store = new RuntimeStore(databasePath);
  try {
    const integrity = store.integrityCheck();
    const migrations = store.listSchemaMigrations();
    console.log(JSON.stringify({ databasePath, integrity, migrations }, null, 2));
    if (!integrity.passed) process.exitCode = 1;
  } finally {
    store.close();
  }
} else if (command === "backup") {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const target = resolve(process.argv[3] || resolve(process.cwd(), ".data/backups", `vnext-${stamp}.sqlite`));
  if (target === databasePath) throw new Error("Backup target must differ from the live database");
  if (existsSync(target)) throw new Error(`Backup target already exists: ${target}`);
  mkdirSync(dirname(target), { recursive: true });
  const store = new RuntimeStore(databasePath);
  try {
    const integrity = store.integrityCheck();
    if (!integrity.passed) throw new Error(`Refusing to back up an invalid database: ${integrity.details.join(", ")}`);
    store.db.exec(`VACUUM INTO '${target.replaceAll("'", "''")}'`);
    console.log(JSON.stringify({ databasePath, backupPath: target, integrity }, null, 2));
  } finally {
    store.close();
  }
} else {
  throw new Error("Usage: database-maintenance.ts check | backup [target.sqlite]");
}
