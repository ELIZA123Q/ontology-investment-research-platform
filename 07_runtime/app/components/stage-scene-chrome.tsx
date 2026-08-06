import Link from "next/link";
import type { ReactNode } from "react";
import {
  formatJourneyOutput,
  researchReferenceScene,
  researchStage,
  type ResearchReferenceScene,
} from "@/app/lib/research-journey";

type StageSceneChromeProps = {
  runId: string;
  stage: number;
  status?: string;
  outputCount?: number;
  statusNote?: string;
  outputOverride?: string;
  outputNoteOverride?: string;
  subtitle?: string;
  actions?: ReactNode;
  showNextStep?: boolean;
};

export function StageSceneChrome({
  runId,
  stage,
  status,
  outputCount,
  statusNote,
  outputOverride,
  outputNoteOverride,
  subtitle,
  actions,
  showNextStep,
}: StageSceneChromeProps) {
  const journey = researchStage(stage);
  if (!journey) return null;

  const outputTitle = outputOverride
    ?? formatJourneyOutput(journey, { count: outputCount });
  const outputNote = outputNoteOverride ?? journey.outputNote;
  const awaitingConfirm = status === "needs_review";
  const shouldShowNext = showNextStep ?? status === "approved";
  const nextHref = `/runs/${runId}${journey.nextStep.pathSuffix}`;

  return (
    <>
      <div className="pagehead scene-head">
        <div>
          <div className="eyebrow">阶段 {String(stage).padStart(2, "0")} · {journey.editTitle}</div>
          <h1>{journey.scenarioQuestion}</h1>
          <p className="muted">{journey.scenarioHint}</p>
        </div>
        {actions ? <div className="actions">{actions}</div> : null}
      </div>

      <section className={`stage-decision-strip${awaitingConfirm ? " pending" : ""}`}>
        <div className="stage-decision-question">
          <span>当前要决定</span>
          <strong>{journey.confirmation}</strong>
          <small>{awaitingConfirm
            ? statusNote || "核对下方研究内容后确认。"
            : status === "approved"
              ? "本阶段已确认。"
              : statusNote || "生成可核对版本后再确认。"}</small>
        </div>
        <div className="stage-decision-output">
          <span>当前产出</span>
          <strong>{outputTitle}</strong>
          <small>{subtitle || outputNote}</small>
        </div>
        {shouldShowNext ? (
          <Link className="button" href={nextHref}>{journey.nextStep.label}</Link>
        ) : null}
      </section>
    </>
  );
}

type ReferenceSceneChromeProps = {
  sceneId: ResearchReferenceScene["id"];
  actions?: ReactNode;
  banner?: {
    label?: string;
    title: string;
    subtitle?: string;
    note?: string;
  };
  hintOverride?: string;
};

export function ReferenceSceneChrome({
  sceneId,
  actions,
  banner,
  hintOverride,
}: ReferenceSceneChromeProps) {
  const scene = researchReferenceScene(sceneId);
  if (!scene) return null;

  return (
    <>
      <div className="pagehead scene-head">
        <div>
          <div className="eyebrow">{scene.eyebrow}</div>
          <h1>{scene.title}</h1>
          <p className="muted">{hintOverride || scene.hint}</p>
        </div>
        {actions ? <div className="actions">{actions}</div> : null}
      </div>
      {banner ? (
        <section className="stage-output-banner">
          <div>
            <span>{banner.label || "本页输出"}</span>
            <strong>{banner.title}</strong>
            {banner.subtitle ? <small>{banner.subtitle}</small> : null}
          </div>
          {banner.note ? <p>{banner.note}</p> : null}
        </section>
      ) : null}
    </>
  );
}
