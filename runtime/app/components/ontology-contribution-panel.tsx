import Link from "next/link";
import { researcherLanguage } from "@/app/lib/researcher-stage-output";
import {
  ontologyContributionKindLabel,
  type OntologyContributionSummary,
} from "@/skills/ontology/contribution_summary";

type OntologyContributionPanelProps = {
  summary: OntologyContributionSummary;
  title?: string;
  href?: string;
  linkLabel?: string;
};

/** 概览与判断页共用的本体贡献摘要。 */
export function OntologyContributionPanel({
  summary,
  title = "本体如何约束本轮",
  href = "/ontology",
  linkLabel = "查看知识库解释 →",
}: OntologyContributionPanelProps) {
  if (!summary.lines.length && summary.headline === "本轮尚未形成可展示的本体约束生效记录") {
    return null;
  }
  return (
    <aside className="ontology-contribution-summary" aria-label="本轮本体生效摘要">
      <div className="panel-title">
        <div><span>{title}</span></div>
        <Link href={href}>{linkLabel}</Link>
      </div>
      <p className="evidence-ready-line">{researcherLanguage(summary.headline)}</p>
      {summary.lines.length ? (
        <ul className="ontology-contribution-list">
          {summary.lines.map((line) => (
            <li key={`${line.kind}-${line.title}`}>
              <span className={`gap-tier tier-${line.kind === "constraint" || line.kind === "precheck" ? "limiting" : "supplementary"}`}>
                {ontologyContributionKindLabel(line.kind)}
              </span>
              <strong>{researcherLanguage(line.title)}</strong>
              <small>{researcherLanguage(line.detail)}</small>
            </li>
          ))}
        </ul>
      ) : null}
    </aside>
  );
}
