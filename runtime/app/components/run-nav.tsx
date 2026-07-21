import Link from "next/link";

const items = [
  { id: "overview", label: "概览", path: "" },
  { id: "scope", label: "范围", path: "/stages/1" },
  { id: "structure", label: "结构", path: "/structure" },
  { id: "evidence", label: "证据", path: "/evidence" },
  { id: "judgment", label: "判断", path: "/judgments" },
  { id: "delivery", label: "交付", path: "/report" },
  { id: "history", label: "历史", path: "/history" },
  { id: "object-set", label: "关系图", path: "/object-set" },
];

export function RunNav({ runId, active }: { runId: string; active: string }) {
  return <nav className="run-scene-nav" aria-label="研究工作场景">
    {items.map((item) => <Link className={active === item.id ? "active" : ""} href={`/runs/${runId}${item.path}`} key={item.id}>{item.label}</Link>)}
  </nav>;
}
