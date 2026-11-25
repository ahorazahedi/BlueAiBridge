import { useApi } from "../lib/hooks";
import type { Check } from "../lib/api";
import { Badge, Card, ErrorBox, Kpi, Skeleton } from "../components/ui";
import { IAlert, ICheckCircle, IRefresh, IXCircle, IHealth } from "../components/icons";

export function Health() {
  const d = useApi<{ checks: Check[]; ok: boolean; summary: { ok: number; warn: number; fail: number } }>("/api/doctor");
  const groups = new Map<string, Check[]>();
  for (const c of d.data?.checks ?? []) groups.set(c.group, [...(groups.get(c.group) ?? []), c]);
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>Health</h2>
          <p>Every piece BlueAIBridge relies on, checked live, with a fix for each problem. Nothing is changed by a check.</p>
        </div>
        <div className="actions">
          <button className="btn" onClick={() => void d.reload()} disabled={d.loading}>
            {d.loading ? <span className="spinner" /> : <IRefresh size={14} />} Run checks again
          </button>
        </div>
      </div>
      {d.error && <ErrorBox error={d.error} retry={d.reload} />}
      <div className="grid kpis four">
        <Kpi label="Overall" icon={<IHealth size={14} />} value={d.data ? (d.data.ok ? <span style={{ color: "var(--good)" }}>Healthy</span> : <span style={{ color: "var(--critical)" }}>Needs attention</span>) : <Skeleton h={28} w={120} />} />
        <Kpi label="Passing" icon={<ICheckCircle size={14} />} value={d.data?.summary.ok ?? "—"} />
        <Kpi label="Warnings" icon={<IAlert size={14} />} value={d.data?.summary.warn ?? "—"} />
        <Kpi label="Problems" icon={<IXCircle size={14} />} value={d.data?.summary.fail ?? "—"} />
      </div>
      {!d.data && !d.error && <Card><Skeleton h={260} /></Card>}
      {[...groups.entries()].map(([g, checks]) => (
        <Card key={g} title={g} flush right={<Badge tone={checks.some((c) => c.status === "fail") ? "critical" : checks.some((c) => c.status === "warn") ? "warning" : "good"}>{checks.filter((c) => c.status === "ok").length}/{checks.length} ok</Badge>}>
          {checks.map((c) => (
            <div className="check" key={c.name}>
              <span style={{ color: c.status === "ok" ? "var(--good)" : c.status === "warn" ? "var(--warning)" : "var(--critical)" }} aria-label={c.status}>
                {c.status === "ok" ? <ICheckCircle size={17} /> : c.status === "warn" ? <IAlert size={17} /> : <IXCircle size={17} />}
              </span>
              <strong>{c.name}</strong>
              <span style={{ overflowWrap: "anywhere" }}>{c.detail}</span>
              {c.fix && <span className="fix">→ {c.fix}</span>}
            </div>
          ))}
        </Card>
      ))}
    </div>
  );
}
