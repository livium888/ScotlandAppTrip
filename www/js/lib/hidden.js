// Events hidden as wrong, remembered across searches.
//
// Hiding a result only lasted until the next search, so the same wrong event
// came straight back. The list is small on purpose: capped, and an entry is
// forgotten once its event has happened, since nothing about it matters then.
// Pure, so it can be tested without a page. Nothing here changes the list it
// is given.

export const HIDDEN_MAX = 300;
const UNDATED_KEEP_MS = 60 * 86400000;

// Entries are { k: fingerprint, d: "YYYY-MM-DD" of the event (or ""), at: when hidden }.
export function addHidden(list, key, dateIso, now = Date.now()) {
  const rest = (Array.isArray(list) ? list : []).filter((e) => e && e.k !== key);
  return [{ k: key, d: dateIso || "", at: now }, ...rest].slice(0, HIDDEN_MAX);
}

export function removeHidden(list, key) {
  return (Array.isArray(list) ? list : []).filter((e) => e && e.k !== key);
}

export function isHidden(list, key) {
  return (Array.isArray(list) ? list : []).some((e) => e && e.k === key);
}

// Drops what no longer matters: events that have been (the day before today is
// the line, so something on today is kept), and undated entries after sixty
// days. Anything that is not a well-formed entry goes too.
export function pruneHidden(list, now = Date.now()) {
  if (!Array.isArray(list)) return [];
  const d = new Date(now);
  const today = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  return list.filter((e) => {
    if (!e || typeof e.k !== "string") return false;
    if (e.d) return e.d >= today;
    return now - (e.at || 0) < UNDATED_KEEP_MS;
  });
}
