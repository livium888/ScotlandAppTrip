// The text of a shared plan.
//
// It goes out as a message, to someone who has no app, so it has to be enough
// on its own: when, where, what to bring (the note - which is where a booking
// reference lives) and a tap to the map. Plain text only: a messaging app
// shows what it is given, and markdown would arrive as asterisks.
//
// Pure: the map link and the "where" line are passed in, so the format can be
// tested without a page.
import { itemsInDayOrder, planItems } from "./plan.js";
import { safeUrl } from "./text.js";

const NOTE_MAX = 200;

// A note is free text, and may have newlines and runs of spaces. On the page
// that is fine; in a message it breaks the layout.
function oneLine(text) {
  const t = String(text == null ? "" : text).replace(/\s+/g, " ").trim();
  return t.length > NOTE_MAX ? `${t.slice(0, NOTE_MAX).trimEnd()}…` : t;
}

export function planShareText({ board, plan, picks, mapUrl, where }) {
  const byId = {};
  picks.forEach((p) => (byId[p.id] = p));

  const lines = [board.name];
  if (board.destination && board.destination !== board.name) lines.push(board.destination);
  lines.push("");

  const details = (p, withLink) => {
    const out = [];
    const w = where(p);
    if (w) out.push(`    ${w}`);
    const note = oneLine(p.note);
    if (note) out.push(`    Note: ${note}`);
    if (withLink) {
      const link = safeUrl(mapUrl(p));
      if (link) out.push(`    ${link}`);
    }
    return out;
  };

  const scheduled = new Set();
  plan.days.forEach((day) => {
    const stops = itemsInDayOrder(planItems(plan, day.id)).filter((it) => byId[it.pickId]);
    if (!stops.length) return;
    lines.push(`— ${day.label} —`);
    stops.forEach((it) => {
      const p = byId[it.pickId];
      scheduled.add(p.id);
      lines.push(`  ${it.time ? `${it.time} ` : ""}${p.name}${p.booked ? " (booked)" : ""}`);
      lines.push(...details(p, true));
    });
    lines.push("");
  });

  // What is saved but not on a day. A town heading is how the list is
  // organised, not somewhere to go, so it is not listed. Shorter than a
  // planned stop: no map link.
  const loose = picks.filter((p) => !p.major && !scheduled.has(p.id));
  if (loose.length) {
    lines.push("— Not scheduled —");
    loose.forEach((p) => {
      lines.push(`  ${p.name}`);
      lines.push(...details(p, false));
    });
  }

  if (!scheduled.size && !loose.length) lines.push("Nothing saved yet.");
  return lines.join("\n").trim();
}
