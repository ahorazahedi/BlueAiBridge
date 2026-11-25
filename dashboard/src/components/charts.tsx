// Hand-built SVG charts following the data-viz method: thin marks, rounded
// data ends anchored to the baseline, 2px surface gaps between stacked
// segments, recessive grid, a legend for every multi-series chart, and a
// hover layer on every plot.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { SeriesPoint } from "../lib/api";
import { num, bytes as fmtBytes } from "../lib/format";

const SERIES = [
  { key: "claudeToChatgpt", label: "Claude → ChatGPT", color: "var(--series-claude)" },
  { key: "chatgptToClaude", label: "ChatGPT → Claude", color: "var(--series-gpt)" },
  { key: "bridge", label: "BlueAIBridge notices", color: "var(--series-bridge)" },
] as const;

function niceMax(v: number) {
  if (v <= 4) return 4;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

/** Fill buckets with no messages so the time axis is continuous. */
function densify(points: SeriesPoint[], since: number, bucketMs: number, now = Date.now()): SeriesPoint[] {
  const map = new Map(points.map((p) => [p.t, p]));
  const out: SeriesPoint[] = [];
  const start = Math.floor(since / bucketMs) * bucketMs;
  for (let t = start; t <= now; t += bucketMs) out.push(map.get(t) ?? { t, claudeToChatgpt: 0, chatgptToClaude: 0, bridge: 0, bytes: 0, failed: 0 });
  return out;
}

export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="legend">
      {items.map((i) => (
        <span key={i.label}>
          <i style={{ background: i.color }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

export function TrafficChart({ points, bucketMs, rangeMs, height = 240 }: { points: SeriesPoint[]; bucketMs: number; rangeMs: number; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [width, setWidth] = useState(800);
  const data = useMemo(() => densify(points, Date.now() - rangeMs, bucketMs), [points, bucketMs, rangeMs]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth || 800));
    ro.observe(el);
    setWidth(el.clientWidth || 800);
    return () => ro.disconnect();
  }, []);
  const totals = data.map((d) => d.claudeToChatgpt + d.chatgptToClaude + d.bridge);
  const max = niceMax(Math.max(1, ...totals));
  const padL = 36;
  const padB = 24;
  const padT = 8;
  const innerW = Math.max(100, width - padL - 8);
  const innerH = height - padB - padT;
  const step = innerW / Math.max(1, data.length);
  const barW = Math.max(2, Math.min(28, step - 2));
  const y = (v: number) => padT + innerH - (v / max) * innerH;
  const ticks = [0, max / 2, max];
  const labelEvery = Math.ceil(data.length / Math.max(2, Math.floor(innerW / 90)));
  const fmtT = (t: number) => (bucketMs >= 3 * 3600_000 ? new Date(t).toLocaleDateString([], { month: "short", day: "numeric" }) : new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));

  return (
    <div
      className="chart"
      ref={ref}
      onMouseLeave={() => setHover(null)}
    >
      <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Messages over time by direction">
        {ticks.map((t) => (
          <g key={t}>
            <line className="gridline" x1={padL} x2={width - 8} y1={y(t)} y2={y(t)} />
            <text className="axis" x={padL - 8} y={y(t) + 4} textAnchor="end">
              {num(t)}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = padL + i * step + (step - barW) / 2;
          let acc = 0;
          const segs = SERIES.map((s) => ({ s, v: d[s.key] })).filter((x) => x.v > 0);
          return (
            <g key={d.t} opacity={hover === null || hover === i ? 1 : 0.45}>
              {segs.map(({ s, v }, j) => {
                const y0 = y(acc);
                acc += v;
                const y1 = y(acc);
                const top = j === segs.length - 1;
                const h = Math.max(1, y0 - y1 - (top ? 0 : 2)); // 2px surface gap between segments
                const r = top ? Math.min(4, barW / 2, h) : 0;
                const yy = y1 + (top ? 0 : 2);
                return <path key={s.key} d={roundedTop(x, yy, barW, h, r)} fill={s.color} />;
              })}
              {i % labelEvery === 0 && (
                <text className="axis" x={x + barW / 2} y={height - 6} textAnchor="middle">
                  {fmtT(d.t)}
                </text>
              )}
              {/* hit target wider than the mark */}
              <rect x={padL + i * step} y={padT} width={step} height={innerH} fill="transparent" onMouseEnter={() => setHover(i)} />
            </g>
          );
        })}
        <line x1={padL} x2={width - 8} y1={y(0)} y2={y(0)} stroke="var(--border-strong)" />
      </svg>
      {hover !== null && data[hover] && (
        <div className="tooltip" style={{ left: Math.min(width - 90, Math.max(90, padL + hover * step + step / 2)), top: y(totals[hover]) }}>
          <div className="t-title">{new Date(data[hover].t).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</div>
          {SERIES.map((s) => (
            <div className="t-row" key={s.key}>
              <i style={{ width: 9, height: 9, borderRadius: 2, background: s.color, display: "inline-block" }} />
              {s.label}
              <span className="v">{data[hover][s.key]}</span>
            </div>
          ))}
          <div className="t-row muted" style={{ marginTop: 4 }}>
            Data<span className="v">{fmtBytes(data[hover].bytes)}</span>
          </div>
          {data[hover].failed > 0 && (
            <div className="t-row" style={{ color: "var(--critical)" }}>
              Failed<span className="v">{data[hover].failed}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export const TRAFFIC_LEGEND = SERIES.map((s) => ({ label: s.label, color: s.color }));

function roundedTop(x: number, y: number, w: number, h: number, r: number) {
  if (r <= 0) return `M${x},${y}h${w}v${h}h${-w}Z`;
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

export function Sparkline({ values, color = "var(--series-claude)", width = 88, height = 28 }: { values: number[]; color?: string; width?: number; height?: number }) {
  if (values.length < 2) return null;
  const max = Math.max(1, ...values);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * width},${height - 2 - (v / max) * (height - 4)}`);
  return (
    <svg width={width} height={height} aria-hidden>
      <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function BarList({ rows, format = num }: { rows: { label: ReactNode; value: number; color?: string; sub?: ReactNode }[]; format?: (n: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="barlist">
      {rows.map((r, i) => (
        <div className="b-row" key={i} title={`${format(r.value)}`}>
          <span>{r.label}</span>
          <span className="tabular" style={{ fontWeight: 600 }}>
            {format(r.value)}
            {r.sub && <span className="muted small" style={{ fontWeight: 400, marginLeft: 6 }}>{r.sub}</span>}
          </span>
          <div className="b-track">
            <div className="b-fill" style={{ width: `${(r.value / max) * 100}%`, background: r.color ?? "var(--series-claude)" }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Part-to-whole for two outcomes: one split bar with labels (status colors, always with icon + label). */
export function SplitBar({ parts }: { parts: { label: ReactNode; value: number; color: string }[] }) {
  const total = parts.reduce((a, p) => a + p.value, 0);
  const [hover, setHover] = useState<number | null>(null);
  if (!total) return <div className="muted small">No verdicts yet.</div>;
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ display: "flex", gap: 2, height: 14, borderRadius: 4, overflow: "hidden" }}>
        {parts
          .filter((p) => p.value > 0)
          .map((p, i) => (
            <div
              key={i}
              title={`${p.value}`}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              style={{ width: `${(p.value / total) * 100}%`, background: p.color, opacity: hover === null || hover === i ? 1 : 0.5, transition: "opacity .12s" }}
            />
          ))}
      </div>
      <div style={{ display: "grid", gap: 6 }}>
        {parts.map((p, i) => (
          <div key={i} className="row small" style={{ justifyContent: "space-between" }}>
            <span className="row">{p.label}</span>
            <span className="tabular">
              <strong>{p.value}</strong> <span className="muted">({Math.round((p.value / total) * 100)}%)</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
