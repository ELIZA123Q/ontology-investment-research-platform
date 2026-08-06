/**
 * Stage03 MCP 证据通道冒烟：只验证三通道配置可读 + 缺省 api_name 的 list 提示路径（注入调用，不连外网）。
 * 真实通联 HTTP 会话会残留句柄拖住 Node 进程，不在此脚本里做长连接。
 */
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { join } from "node:path";

const require = createRequire(import.meta.url);
require("module")._cache[require.resolve("server-only")] = { id: "server-only", exports: {} };

async function main() {
  const modPath = join(process.cwd(), "adapters/mcp_evidence.ts");
  const {
    getEvidenceMcpServerConfig,
    queryDatayesFinoper,
    setMcpEvidenceCallerForTests,
    EVIDENCE_MCP_CHANNELS,
  } = await import(pathToFileURL(modPath).href);

  for (const ch of EVIDENCE_MCP_CHANNELS) {
    const cfg = getEvidenceMcpServerConfig(ch);
    if (!cfg) {
      console.error("MISSING config", ch);
      process.exit(1);
    }
    console.log(
      ch,
      `config_ok type=${cfg.type || (cfg.command ? "stdio" : "?")} has_url=${Boolean(cfg.url)} cmd=${cfg.command || "-"}`,
    );
  }

  setMcpEvidenceCallerForTests(async (input: { arguments?: Record<string, unknown> }) => {
    if (input.arguments?.__list_only !== true) throw new Error("expected list_only");
    return {
      tools: [
        { name: "stock_finoper_get_info", description: "info" },
        { name: "stock_finoper_get_data", description: "data" },
      ],
      contentText: "",
      structured: { list_only: true },
    };
  });

  const listed = await queryDatayesFinoper({ stock_code: "688981" });
  const ok = !listed.ok && /api_name/.test(String(listed.error || ""));
  console.log(JSON.stringify({
    phase: "list_without_api_name",
    ok: listed.ok,
    error: listed.error,
    tools: (listed.available_tools || []).map((t: { name: string }) => t.name),
    expects_api_name_hint: ok,
  }, null, 2));

  process.exit(ok ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
