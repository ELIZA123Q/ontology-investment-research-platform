import Link from "next/link";
import { notFound } from "next/navigation";
import { getRun, latestArtifact } from "@/adapters/db";
import { StageWorkspace } from "@/app/components/stage-workspace";
import { RunChrome } from "@/app/components/run-chrome";
import { STAGES, parseJson } from "@/engine/types";

export const dynamic = "force-dynamic";

const names = ["问题定义", "判断结构", "来源收集与证据草稿", "判断裁决", "研究表达"];

function compactScopeSummary(jsonContent: string | undefined) {
  const data = parseJson<any>(jsonContent || "{}", {});
  const time = data.time_scope || {};
  return {
    coreObject: String(data.core_object || "").trim(),
    judgmentAction: String(data.judgment_action || "").trim(),
    asOf: String(time.as_of || "").trim(),
    lookback: String(time.lookback || "").trim(),
    forward: String(time.forward || "").trim(),
  };
}

export default async function StagePage({ params }: { params: Promise<{ id: string; stage: string }> }) {
  const { id, stage } = await params;
  const n = Number(stage);
  const run = getRun(id);
  if (!run || n < 1 || n > 5) notFound();
  const kind = STAGES[n - 1];
  const artifactRow = latestArtifact(id, kind);
  const artifact = artifactRow ? { ...artifactRow } : undefined;
  const unlocked = n === 1 || Boolean(latestArtifact(id, STAGES[n - 2], ["approved"]));
  const active = ["scope", "structure", "evidence", "judgment", "delivery"][n - 1];
  const approvedScope = n === 2
    ? compactScopeSummary(latestArtifact(id, "stage_01", ["approved"])?.json_content)
    : undefined;
  const statusLabel = ({
    draft: "草稿",
    running: "生成中",
    needs_review: "待确认",
    approved: "已确认",
    failed: "失败",
    cancelled: "已取消",
    superseded: "已被新版取代",
  } as Record<string, string>)[artifact?.status || ""] || artifact?.status || "尚未开始";

  return <>
    <RunChrome runId={id} active={active} />
    <div className="pagehead scene-head">
      <div>
        <div className="eyebrow">高级阶段编辑 · 第 {n} 阶段 · {statusLabel}</div>
        <h1>{names[n - 1]}</h1>
        <p className="muted">
          {n === 1
            ? "左侧编辑研究范围，右侧为后台同步的可读稿；日常审阅请优先使用上方工作场景。"
            : n === 2
              ? "范围只读；结构改用右下角改稿。手改仅限必要证据与反证/竞争；确认前会做 AI 校验。"
              : "这里保留阶段生成和原始结构编辑；日常审阅请优先使用上方工作场景。"}
        </p>
      </div>
      {n > 1 && (
        <Link
          className="button-secondary"
          href={n === 2 ? `/runs/${id}/structure` : n === 3 ? `/runs/${id}/evidence` : n === 4 ? `/runs/${id}/judgments` : `/runs/${id}/report`}
        >
          返回审阅视图 ↗
        </Link>
      )}
    </div>
    <StageWorkspace
      runId={id}
      question={run.question}
      stage={n}
      artifact={artifact}
      unlocked={unlocked}
      approvedScope={approvedScope}
    />
  </>;
}
