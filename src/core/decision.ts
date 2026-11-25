// Review answers: validate the structured form (blue_advise) and parse the
// free-text form (a headless reviewer, or one that answered in prose).

import type { Decision } from "../shared/types.js";

const clean = (xs: unknown): string[] =>
  (Array.isArray(xs) ? xs : typeof xs === "string" && xs.trim() ? [xs] : []).map((x) => String(x).trim()).filter(Boolean);

/** Throws with a message the model can act on when the decision is ambiguous. */
export function validateDecision(input: { decision?: unknown; note?: unknown; blocking?: unknown; nits?: unknown }): Decision {
  const raw = String(input.decision ?? "").toLowerCase().replace(/[\s-]+/g, "_");
  const decision = raw === "approved" || raw === "approve" ? "approved" : raw === "changes_requested" || raw === "request_changes" ? "changes_requested" : null;
  if (!decision) throw new Error('decision must be "approved" or "changes_requested"');
  const note = String(input.note ?? "").trim();
  const blocking = clean(input.blocking);
  const nits = clean(input.nits);
  if (!note) throw new Error("note is required: one short paragraph with your verdict and why");
  if (decision === "approved" && blocking.length)
    throw new Error("an approval can't have must-fix (blocking) items: move them to nits, or request changes");
  if (decision === "changes_requested" && !blocking.length)
    throw new Error("changes requested needs at least one must-fix (blocking) item: list it, or approve with nits");
  return { decision, note, blocking, nits };
}

const TAG = /\[\s*(APPROVED|CHANGES[\s_-]*REQUESTED)\s*\]/i;
const HEAD_BLOCKING = /^\s*(?:\*\*)?\s*(must[\s-]*fix|blocking|required changes?)\b.*:?\s*(?:\*\*)?\s*$/i;
const HEAD_NITS = /^\s*(?:\*\*)?\s*(nits?|minor|optional|suggestions?)\b.*:?\s*(?:\*\*)?\s*$/i;
const BULLET = /^\s*(?:[-*•]|\d+[.)])\s+(.*)$/;

/**
 * Parse "[APPROVED] / [CHANGES REQUESTED]" prose into a decision. Returns null
 * when the text has no tag (then it's an ordinary reply, not a verdict).
 * Inconsistent answers are repaired rather than rejected: an approval with
 * must-fix items becomes changes requested; changes requested without items
 * keeps the note as its single item.
 */
export function parseDecisionText(text: string): Decision | null {
  const m = TAG.exec(text);
  if (!m) return null;
  let decision: Decision["decision"] = /^APPROVED$/i.test(m[1]) ? "approved" : "changes_requested";
  const after = text.slice(m.index + m[0].length).split("\n");
  const note: string[] = [];
  const blocking: string[] = [];
  const nits: string[] = [];
  let section: "note" | "blocking" | "nits" = "note";
  for (const line of after) {
    if (HEAD_BLOCKING.test(line)) {
      section = "blocking";
      continue;
    }
    if (HEAD_NITS.test(line)) {
      section = "nits";
      continue;
    }
    const b = BULLET.exec(line);
    if (section === "blocking" && b) blocking.push(b[1].trim());
    else if (section === "nits" && b) nits.push(b[1].trim());
    else if (section === "note") note.push(line);
    else if (line.trim() && (section === "blocking" ? blocking : nits).length) {
      const list = section === "blocking" ? blocking : nits;
      list[list.length - 1] += " " + line.trim(); // continuation line
    }
  }
  const noteText = note.join("\n").trim() || (decision === "approved" ? "Approved." : "Changes requested.");
  const realBlocking = blocking.filter((b) => !/^(none|n\/a|-)\.?$/i.test(b));
  if (decision === "approved" && realBlocking.length) decision = "changes_requested";
  if (decision === "changes_requested" && !realBlocking.length) realBlocking.push(noteText.split("\n")[0]);
  return { decision, note: noteText, blocking: realBlocking, nits: nits.filter((n) => !/^(none|n\/a|-)\.?$/i.test(n)) };
}
