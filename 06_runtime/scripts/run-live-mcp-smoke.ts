import { readFileSync } from "node:fs";
import { AgentKernel } from "@/src/runtime/kernel";
import { RuntimeStore } from "@/src/runtime/store";
import {
  mapHtscIndustrySentimentReceipt,
  parseHtscIndustrySentimentMcpPayload,
} from "@/src/tools/htsc-industry-sentiment-mapper";

const args = new Map<string, string>();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1]);
const rawPath = args.get("--raw");
const dbPath = args.get("--db");
const requestedAt = args.get("--requested-at");
const retrievedAt = args.get("--retrieved-at");
if (!rawPath || !dbPath || !requestedAt || !retrievedAt) {
  throw new Error("usage: --raw <private MCP response JSON> --db <isolated sqlite path> --requested-at <ISO> --retrieved-at <ISO>");
}

const rawBytes = readFileSync(rawPath);
const receipt = parseHtscIndustrySentimentMcpPayload({
  rawResponseBody: rawBytes.toString("utf8"),
  request: { industryLevel: "二级行业", industry: "半导体", startDate: "2026-05-01", endDate: "2026-08-11" },
  requestedAt,
  retrievedAt,
});
const store = new RuntimeStore(dbPath);
try {
  const kernel = new AgentKernel(store);
  const conversation = store.createConversation("真实 MCP 摄取验收");
  const submitted = kernel.submitGoal(conversation.id, "核验半导体行业景气度变化，只形成证据候选，不直接形成投资结论");
  const artifact = kernel.ingestFinancialData(submitted.task.id, mapHtscIndustrySentimentReceipt(receipt));
  const providerResponseRef = store.getConnectorResponseBlobMetadata(receipt.responseFingerprint);
  const data = artifact.data as { facts: Array<{ id: string; statement: string; metric: { value: number; unit: string } }> };
  process.stdout.write(`${JSON.stringify({
    source: "华泰智研MCP数据服务",
    taskId: submitted.task.id,
    artifactId: artifact.id,
    artifactStatus: artifact.status,
    permissionScope: "authorized_research_use",
    responseFingerprint: receipt.responseFingerprint,
    providerResponseRef,
    observations: data.facts.map((fact) => ({ id: fact.id, statement: fact.statement, value: fact.metric.value, unit: fact.metric.unit })),
    claimBoundary: "真实结构化观测已进入证据链；仍需独立来源与研究员确认，不能单独形成投资结论。",
  }, null, 2)}\n`);
} finally {
  store.close();
}
