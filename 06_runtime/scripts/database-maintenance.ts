import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { RuntimeStore, defaultDatabasePath } from "@/src/runtime/store";

const command = process.argv[2] || "check";
const databasePath = resolve(defaultDatabasePath());

if (command === "check") {
  const store = new RuntimeStore(databasePath);
  try {
    const integrity = store.integrityCheck();
    const schemaVersions = store.listSchemaVersions();
    console.log(JSON.stringify({ databasePath, integrity, schemaVersions }, null, 2));
    if (!integrity.passed) process.exitCode = 1;
  } finally {
    store.close();
  }
} else if (command === "backup" || command === "restore") {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const source = command === "backup" ? databasePath : resolve(process.argv[3] || "");
  if (command === "restore" && !process.argv[3]) throw new Error("Restore requires a backup source path");
  const target = resolve(command === "backup"
    ? (process.argv[3] || resolve(process.cwd(), ".data/backups", `vnext-${stamp}.sqlite`))
    : (process.argv[4] || resolve(process.cwd(), ".data/restores", `vnext-restored-${stamp}.sqlite`)));
  if (target === source || target === databasePath) throw new Error("Backup or restore target must be a new path, not the live/source database");
  if (existsSync(target)) throw new Error(`Backup or restore target already exists: ${target}`);
  mkdirSync(dirname(target), { recursive: true });
  const store = new RuntimeStore(source);
  try {
    const integrity = store.integrityCheck();
    if (!integrity.passed) throw new Error(`Refusing to ${command} an invalid database: ${integrity.details.join(", ")}`);
    store.db.exec(`VACUUM INTO '${target.replaceAll("'", "''")}'`);
    const copied = new RuntimeStore(target);
    try {
      const copiedIntegrity = copied.integrityCheck();
      if (!copiedIntegrity.passed) throw new Error(`Copied database integrity check failed: ${copiedIntegrity.details.join(", ")}`);
      console.log(JSON.stringify(command === "backup"
        ? { databasePath, backupPath: target, integrity: copiedIntegrity }
        : { backupPath: source, restoredCopyPath: target, integrity: copiedIntegrity, note: "Live database was not overwritten; switch VNEXT_DB_PATH after validating the restored copy." }, null, 2));
    } finally { copied.close(); }
  } finally {
    store.close();
  }
} else {
  throw new Error("Usage: database-maintenance.ts check | backup [target.sqlite] | restore <backup.sqlite> [restored-copy.sqlite]");
}
