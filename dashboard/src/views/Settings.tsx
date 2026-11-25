import { useEffect, useState } from "react";
import { api, type Config } from "../lib/api";
import { useApi } from "../lib/hooks";
import { Card, ErrorBox, Segmented, Skeleton, useToast, Confirm } from "../components/ui";
import { ICheck } from "../components/icons";

const FIELDS: { key: keyof Config; label: string; help: string; type: "enum" | "number" | "text" | "bool"; options?: { value: string; label: string }[]; unit?: string }[] = [
  { key: "delivery", label: "Default delivery", help: "Visible puts messages into the other app's chat window; headless runs its CLI in the background and returns the answer. Auto uses visible when the app is installed.", type: "enum", options: [{ value: "auto", label: "Auto" }, { value: "visible", label: "Visible" }, { value: "headless", label: "Headless" }] },
  { key: "autoReviews", label: "Auto mode reviews", help: "Key moments: the agent asks at the moments that matter, checked at the end of each turn. Every turn: each turn is sent for review automatically.", type: "enum", options: [{ value: "key-moments", label: "Key moments" }, { value: "every-turn", label: "Every turn" }] },
  { key: "openClosedApps", label: "When the other app is closed", help: "Ask: the agent asks you before opening ChatGPT or a Claude session. Always: open it without asking.", type: "enum", options: [{ value: "ask", label: "Ask me" }, { value: "always", label: "Always open" }] },
  { key: "readChatsInReviewers", label: "Reading reviewer chats", help: "Whether a chat may read another chat that is currently reviewing for someone.", type: "enum", options: [{ value: "deny", label: "Refuse" }, { value: "allow", label: "Allow" }] },
  { key: "maxRounds", label: "Emergency stop", help: "Rounds without approval before the fix loop stops and the agent must ask you.", type: "number", unit: "rounds" },
  { key: "chatgptModel", label: "ChatGPT reviewer model", help: "Model for new ChatGPT reviewer chats (id or the name the picker shows). Empty: the app's default.", type: "text" },
  { key: "chatgptEffort", label: "ChatGPT reasoning effort", help: "low, medium, high… Empty: the model's default.", type: "text" },
  { key: "claudeModel", label: "Claude headless model", help: "Model for headless Claude runs (e.g. opus, sonnet). Empty: Claude's default.", type: "text" },
  { key: "headlessTimeoutSec", label: "Headless time limit", help: "How long a background run may take before it is given up.", type: "number", unit: "seconds" },
  { key: "includeDiff", label: "Paste diffs into requests", help: "Off: reviewers read the changes themselves with the commands given (smaller messages). On: diffs are pasted too.", type: "bool" },
  { key: "retentionDays", label: "History retention", help: "Closed conversations and events older than this are deleted.", type: "number", unit: "days" },
  { key: "port", label: "Broker port", help: "Port on 127.0.0.1. Takes effect after the broker restarts.", type: "number" },
];

export function Settings() {
  const cfg = useApi<{ config: Config; defaults: Config; file: string }>("/api/config");
  const rules = useApi<{ rules: string; file: string }>("/api/rules");
  const [draft, setDraft] = useState<Config | null>(null);
  const [rulesDraft, setRulesDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [prune, setPrune] = useState(false);
  const toast = useToast();
  useEffect(() => {
    if (cfg.data) setDraft(cfg.data.config);
  }, [cfg.data]);
  useEffect(() => {
    if (rules.data) setRulesDraft(rules.data.rules);
  }, [rules.data]);
  const dirty = draft && cfg.data && JSON.stringify(draft) !== JSON.stringify(cfg.data.config);
  const rulesDirty = rules.data && rulesDraft !== rules.data.rules;

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const r = await api<{ config: Config }>("/api/config", { method: "PUT", body: draft });
      cfg.setData({ ...cfg.data!, config: r.config });
      toast({ tone: "good", title: "Settings saved", body: "They apply to the next message." });
    } catch (e) {
      toast({ tone: "error", title: "Not saved", body: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };
  const saveRules = async () => {
    try {
      const r = await api<{ rules: string }>("/api/rules", { method: "PUT", body: { rules: rulesDraft } });
      rules.setData({ ...rules.data!, rules: r.rules });
      toast({ tone: "good", title: "Rules saved", body: "Every linked chat gets them with its next prompt." });
    } catch (e) {
      toast({ tone: "error", title: "Not saved", body: (e as Error).message });
    }
  };

  return (
    <div className="page" style={{ maxWidth: 1100 }}>
      <div className="page-head">
        <div>
          <h2>Settings</h2>
          <p>Stored in {cfg.data?.file ?? "config.json"}.</p>
        </div>
        <div className="actions">
          <button className="btn" disabled={!dirty} onClick={() => setDraft(cfg.data!.config)}>
            Discard
          </button>
          <button className="btn primary" disabled={!dirty || saving} onClick={save}>
            {saving ? <span className="spinner" /> : <ICheck size={14} />} Save changes
          </button>
        </div>
      </div>
      {cfg.error && <ErrorBox error={cfg.error} retry={cfg.reload} />}
      <Card title="Behaviour">
        {!draft ? (
          <Skeleton h={300} />
        ) : (
          <div className="form">
            {FIELDS.map((f) => (
              <div className="field" key={f.key}>
                <label htmlFor={`f-${f.key}`}>
                  {f.label}
                  <div className="help">{f.help}</div>
                </label>
                <div className="row">
                  {f.type === "enum" && <Segmented value={String(draft[f.key])} options={f.options!} onChange={(v) => setDraft({ ...draft, [f.key]: v })} label={f.label} />}
                  {f.type === "number" && (
                    <>
                      <input id={`f-${f.key}`} className="input" type="number" min={1} style={{ width: 140 }} value={Number(draft[f.key])} onChange={(e) => setDraft({ ...draft, [f.key]: Number(e.target.value) })} />
                      {f.unit && <span className="muted">{f.unit}</span>}
                    </>
                  )}
                  {f.type === "text" && <input id={`f-${f.key}`} className="input" style={{ width: 320 }} value={String(draft[f.key])} placeholder="default" onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })} />}
                  {f.type === "bool" && (
                    <Segmented value={draft[f.key] ? "on" : "off"} options={[{ value: "off", label: "Off" }, { value: "on", label: "On" }]} onChange={(v) => setDraft({ ...draft, [f.key]: v === "on" })} label={f.label} />
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
      <Card
        title="Your rules"
        sub="Standing instructions every linked chat receives from your own file (never from the other agent). Up to 8,000 characters."
        right={
          <button className="btn sm primary" disabled={!rulesDirty} onClick={saveRules}>
            Save rules
          </button>
        }
      >
        <textarea className="textarea" rows={9} value={rulesDraft} onChange={(e) => setRulesDraft(e.target.value)} placeholder={"Always answer in English.\nNever commit without my approval; staging is fine.\nWhen you review, don't run the tests."} maxLength={8000} aria-label="Rules" />
        <div className="row small muted" style={{ marginTop: 6, justifyContent: "space-between" }}>
          <span>{rules.data?.file}</span>
          <span className="tabular">{rulesDraft.length} / 8000</span>
        </div>
      </Card>
      <Card title="Maintenance">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div>
            <strong>Delete old history now</strong>
            <div className="muted small">Removes closed conversations and events older than {draft?.retentionDays ?? 30} days. This happens automatically every 6 hours.</div>
          </div>
          <button className="btn danger" onClick={() => setPrune(true)}>
            Prune now
          </button>
        </div>
      </Card>
      <Confirm
        open={prune}
        title="Delete old history?"
        body={`Closed conversations and events older than ${draft?.retentionDays ?? 30} days are deleted permanently.`}
        confirmLabel="Delete"
        danger
        onConfirm={async () => {
          const r = await api<{ links: number; events: number }>("/api/maintenance/prune", { body: {} });
          toast({ tone: "good", title: "History pruned", body: `${r.links} conversations and ${r.events} events removed.` });
          setPrune(false);
        }}
        onClose={() => setPrune(false)}
      />
    </div>
  );
}
