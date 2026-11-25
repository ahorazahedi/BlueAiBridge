import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Endpoint, Message } from "../lib/api";
import { appLabel, shortId } from "../lib/format";
import { ClaudeMark, GptMark, IAlert, ICheckCircle, IInfo, IX, IXCircle, IClock, ICopy, ICheck } from "./icons";

export function Card({ title, sub, right, children, flush, className = "" }: { title?: ReactNode; sub?: ReactNode; right?: ReactNode; children: ReactNode; flush?: boolean; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {(title || right) && (
        <div className="card-head">
          <div>
            {title && <h3>{title}</h3>}
            {sub && <div className="sub">{sub}</div>}
          </div>
          {right && <div className="right">{right}</div>}
        </div>
      )}
      <div className={`card-body ${flush ? "flush" : ""}`}>{children}</div>
    </section>
  );
}

export function Kpi({ label, value, hint, icon, spark }: { label: string; value: ReactNode; hint?: ReactNode; icon?: ReactNode; spark?: ReactNode }) {
  return (
    <div className="card kpi">
      <div className="label">
        {icon}
        {label}
      </div>
      <div className="value">{value}</div>
      {hint && <div className="hint">{hint}</div>}
      {spark && <div className="spark">{spark}</div>}
    </div>
  );
}

export function Badge({ tone = "neutral", children, title }: { tone?: "neutral" | "good" | "warning" | "critical" | "info" | "claude" | "gpt" | "outline"; children: ReactNode; title?: string }) {
  return (
    <span className={`badge ${tone}`} title={title}>
      {children}
    </span>
  );
}

export function AppBadge({ e, compact }: { e: Endpoint | null | undefined; compact?: boolean }) {
  if (!e) return <Badge tone="info">BlueAIBridge</Badge>;
  return (
    <Badge tone={e.app === "claude" ? "claude" : "gpt"} title={`${appLabel(e.app)} ${e.id}`}>
      {e.app === "claude" ? <ClaudeMark size={12} /> : <GptMark size={12} />}
      {appLabel(e.app)}
      {!compact && <span className="mono" style={{ fontWeight: 500, opacity: 0.8 }}>{shortId(e.id)}</span>}
    </Badge>
  );
}

export function StateBadge({ state }: { state: Message["state"] | string }) {
  const map: Record<string, [Parameters<typeof Badge>[0]["tone"], ReactNode, string]> = {
    pending: ["neutral", <IClock size={12} />, "Pending"],
    deferred: ["warning", <IClock size={12} />, "Waiting"],
    sending: ["info", <span className="spinner" style={{ width: 10, height: 10 }} />, "Sending"],
    delivered: ["good", <ICheck size={12} />, "Delivered"],
    answered: ["good", <ICheckCircle size={12} />, "Answered"],
    failed: ["critical", <IXCircle size={12} />, "Failed"],
    cancelled: ["neutral", <IX size={12} />, "Cancelled"],
    open: ["info", <span className="dot live" style={{ width: 6, height: 6 }} />, "Open"],
    waiting_join: ["warning", <IClock size={12} />, "Waiting to join"],
    closed: ["neutral", <IX size={12} />, "Closed"],
  };
  const [tone, icon, label] = map[state] ?? ["neutral", null, state];
  return (
    <Badge tone={tone}>
      {icon}
      {label}
    </Badge>
  );
}

export function DecisionBadge({ decision }: { decision: "approved" | "changes_requested" | null | undefined }) {
  if (!decision) return null;
  return decision === "approved" ? (
    <Badge tone="good">
      <ICheckCircle size={12} /> Approved
    </Badge>
  ) : (
    <Badge tone="warning">
      <IAlert size={12} /> Changes requested
    </Badge>
  );
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="icon">{icon ?? <IInfo />}</div>
      <h4>{title}</h4>
      {children && <div style={{ maxWidth: 460 }}>{children}</div>}
    </div>
  );
}

export function Skeleton({ h = 14, w = "100%", style }: { h?: number; w?: number | string; style?: React.CSSProperties }) {
  return <div className="skeleton" style={{ height: h, width: w, ...style }} />;
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; label?: string }) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} role="radio" aria-checked={o.value === value} className={o.value === value ? "on" : ""} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function CopyButton({ text, label }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="btn sm ghost"
      title="Copy"
      onClick={() => {
        void navigator.clipboard?.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1200);
      }}
    >
      {done ? <ICheck size={13} /> : <ICopy size={13} />}
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------
// toasts
// ---------------------------------------------------------------------

type Toast = { id: number; tone: "info" | "good" | "error"; title: string; body?: string };
const ToastCtx = createContext<(t: Omit<Toast, "id">) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const seq = useRef(0);
  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = ++seq.current;
    setItems((x) => [...x, { ...t, id }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), t.tone === "error" ? 9000 : 4500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.tone === "error" ? "error" : ""}`}>
            <span style={{ color: t.tone === "error" ? "var(--critical)" : t.tone === "good" ? "var(--good)" : "var(--brand)" }}>
              {t.tone === "error" ? <IXCircle /> : t.tone === "good" ? <ICheckCircle /> : <IInfo />}
            </span>
            <div style={{ display: "grid", gap: 2 }}>
              <strong>{t.title}</strong>
              {t.body && <span className="small muted">{t.body}</span>}
            </div>
            <button className="btn sm ghost icon" style={{ marginLeft: "auto" }} aria-label="Dismiss" onClick={() => setItems((x) => x.filter((i) => i.id !== t.id))}>
              <IX size={13} />
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

// ---------------------------------------------------------------------
// dialogs & drawers
// ---------------------------------------------------------------------

export function useEscape(fn: () => void, active = true) {
  useEffect(() => {
    if (!active) return;
    const on = (e: KeyboardEvent) => e.key === "Escape" && fn();
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [fn, active]);
}

export function Confirm({
  open,
  title,
  body,
  confirmLabel,
  danger,
  busy,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  useEscape(onClose, open);
  if (!open) return null;
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="dlg-title">
        <h3 id="dlg-title">{title}</h3>
        <div className="muted" style={{ color: "var(--text-2)" }}>
          {body}
        </div>
        <div className="actions">
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className={`btn ${danger ? "danger solid" : "primary"}`} onClick={onConfirm} disabled={busy} autoFocus>
            {busy && <span className="spinner" style={{ borderTopColor: "#fff" }} />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function Drawer({ open, title, onClose, children, actions }: { open: boolean; title: ReactNode; onClose: () => void; children: ReactNode; actions?: ReactNode }) {
  useEscape(onClose, open);
  if (!open) return null;
  return (
    <>
      <div className="overlay" style={{ background: "rgba(15,23,42,.25)" }} onMouseDown={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true">
        <div className="drawer-head">
          <div style={{ fontWeight: 650, minWidth: 0, flex: 1 }}>{title}</div>
          {actions}
          <button className="btn sm ghost icon" onClick={onClose} aria-label="Close">
            <IX />
          </button>
        </div>
        <div className="drawer-body">{children}</div>
      </aside>
    </>
  );
}

export function ErrorBox({ error, retry }: { error: Error; retry?: () => void }) {
  return (
    <div className="notice" style={{ background: "var(--critical-soft)" }}>
      <span style={{ color: "var(--critical)" }}>
        <IXCircle />
      </span>
      <div style={{ flex: 1 }}>
        <strong>Couldn't load this.</strong> <span className="muted">{error.message}</span>
      </div>
      {retry && (
        <button className="btn sm" onClick={retry}>
          Retry
        </button>
      )}
    </div>
  );
}
