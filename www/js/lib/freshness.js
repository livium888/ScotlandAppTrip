// How old an answer is. Pure, so the wording and the thresholds can be tested
// without a page.
//
// An answer from the web is a claim about a moment. A search that is hours old
// can be out of date, and a saved event can have changed since it was found;
// neither said so. These are the words for it.

export const STALE_AFTER_MS = 6 * 3600000;
const CHECK_AFTER_MS = 3 * 86400000;

export function agoWords(at, now = Date.now()) {
  const mins = Math.max(0, Math.round((now - at) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

// "Searched 14 min ago", and whether it is old enough to be worth redoing.
// Nothing, rather than a wrong date, when the time is not known.
export function searchAge({ at, now = Date.now() }) {
  if (!at) return null;
  return { text: `Searched ${agoWords(at, now)}`, stale: now - at > STALE_AFTER_MS };
}

// When a saved event was found, and - if it was a while ago and the event is
// still to come - a reminder that listings change. Once it has happened there
// is nothing left to check.
export function foundNote({ foundAt, startsAt, now = Date.now() }) {
  if (!foundAt) return null;
  const text = `Found ${agoWords(foundAt, now)}`;
  const starts = startsAt == null || startsAt === "" ? NaN : new Date(startsAt).getTime();
  const check = Number.isFinite(starts) && starts > now && now - foundAt >= CHECK_AFTER_MS;
  return { text: check ? `${text}. Listings change - check it's still on before you go.` : text, check };
}
