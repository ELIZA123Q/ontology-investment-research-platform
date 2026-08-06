import { tmpdir } from "node:os";
import { join } from "node:path";

// Tests that do not declare their own fixture DB must never write into the
// persistent researcher workspace. Pool id keeps parallel workers isolated.
const pool = process.env.VITEST_POOL_ID || "main";
process.env.WORKBENCH_DB_PATH ||= join(tmpdir(), `ontology-workbench-vitest-${process.pid}-${pool}.sqlite`);
process.env.WORKBENCH_EXPORT_ROOT ||= join(tmpdir(), `ontology-workbench-vitest-exports-${process.pid}-${pool}`);
