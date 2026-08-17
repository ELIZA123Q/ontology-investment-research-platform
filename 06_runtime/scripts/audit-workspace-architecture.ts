import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const root = resolve(process.cwd());
const packagesRoot = join(root, "packages");
const failures: string[] = [];
const allowed: Record<string, Set<string>> = {
  domain: new Set(),
  knowledge: new Set(["domain"]),
  orchestrator: new Set(["domain"]),
  "persistence-sqlite": new Set(["domain", "orchestrator"]),
  adapters: new Set(["domain", "orchestrator"]),
};

function files(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? files(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

for (const [packageName, dependencies] of Object.entries(allowed)) {
  const packageRoot = join(packagesRoot, packageName);
  for (const path of files(packageRoot)) {
    const source = readFileSync(path, "utf8");
    for (const match of source.matchAll(/(?:from\s+|import\s*\()["']@investment\/([^"'/]+)(?:\/[^"']*)?["']/g)) {
      const target = match[1];
      if (!dependencies.has(target)) failures.push(`${relative(root, path)}: ${packageName} cannot depend on ${target}`);
      if (match[0].includes(`@investment/${target}/`)) failures.push(`${relative(root, path)}: deep package import is forbidden`);
    }
    if (packageName === "domain" && /(?:node:sqlite|next\/|react|@\/src)/.test(source)) failures.push(`${relative(root, path)}: domain must remain pure`);
  }
}

for (const path of files(join(root, "app"))) {
  const source = readFileSync(path, "utf8");
  if (/node:sqlite/.test(source)) failures.push(`${relative(root, path)}: workbench cannot import SQLite directly`);
  if (path.endsWith("route.ts") && /@\/src\/(runtime\/(?:store|kernel)|runtime-v2)/.test(source)) {
    failures.push(`${relative(root, path)}: HTTP routes must enter through the application layer`);
  }
}

const productionEntrypoints = [join(root, "src", "worker.ts")];
for (const path of productionEntrypoints) {
  const source = readFileSync(path, "utf8");
  if (/@\/src\/(?:runtime\/(?:store|kernel)|knowledge\/service|providers\/model-provider)/.test(source)) {
    failures.push(`${relative(root, path)}: production entrypoints must depend on an application port, not compatibility implementations`);
  }
}

const quarantined = [
  { path: join(root, "src", "runtime", "kernel.ts"), importId: "@/src/runtime/kernel", maxLines: 1409, maxImporters: 18 },
  { path: join(root, "src", "runtime", "store.ts"), importId: "@/src/runtime/store", maxLines: 669, maxImporters: 44 },
  { path: join(root, "src", "contracts.ts"), importId: "@/src/contracts", maxLines: 615, maxImporters: 40 },
];
const runtimeStoreSource = readFileSync(join(root, "src", "runtime", "store.ts"), "utf8");
const persistenceSource = readFileSync(join(root, "packages", "persistence-sqlite", "src", "index.ts"), "utf8");
const researchRecordSource = readFileSync(join(root, "src", "persistence", "research-record-repository.ts"), "utf8");
if (/CREATE TABLE IF NOT EXISTS/.test(runtimeStoreSource)) {
  failures.push("src/runtime/store.ts: schema ownership belongs to @investment/persistence-sqlite");
}
if (!/export function migrateLegacyRuntimeSchema/.test(persistenceSource)) {
  failures.push("packages/persistence-sqlite: versioned Runtime schema migration entry is missing");
}
if (/(?:INSERT INTO|UPDATE|SELECT .* FROM)\s+(?:artifacts|approvals|run_events)\b/i.test(runtimeStoreSource)) {
  failures.push("src/runtime/store.ts: artifact, approval and audit-event SQL belongs to SqliteResearchRecordRepository");
}
if (!/export class SqliteResearchRecordRepository/.test(researchRecordSource)) {
  failures.push("src/persistence: research record repository boundary is missing");
}
const migrationFiles = ["app", "src", "scripts", "tests", "packages"].flatMap((directory) => files(join(root, directory)));
for (const item of quarantined) {
  const lineCount = readFileSync(item.path, "utf8").split("\n").length - 1;
  if (lineCount > item.maxLines) failures.push(`${relative(root, item.path)}: quarantined compatibility file grew from ${item.maxLines} to ${lineCount} lines`);
  const importers = migrationFiles.filter((path) => readFileSync(path, "utf8").includes(`from "${item.importId}"`) || readFileSync(path, "utf8").includes(`from '${item.importId}'`)).length;
  if (importers > item.maxImporters) failures.push(`${item.importId}: quarantined dependency gained importers (${item.maxImporters} -> ${importers})`);
}

const obsoleteRuntimeV2 = join(root, "src", "runtime-v2");
try { if (statSync(obsoleteRuntimeV2).isDirectory() && files(obsoleteRuntimeV2).length) failures.push("src/runtime-v2: obsolete parallel runtime boundary must not contain implementation files"); }
catch { /* expected after cutover */ }

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("workspace architecture audit passed: directed package dependencies and pure domain boundary");
