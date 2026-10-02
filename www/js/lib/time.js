// Dates, clock times and the labels built from them. Pure functions, so they
// can be tested in Node directly.

// "Day 3 · Fri 21 Aug" -> "Fri 21". Full labels don't fit on a chip.
export function shortDayLabel(label) {
  const m = String(label || "").match(/\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b\s*(\d{1,2})?/i);
  if (m) return m[2] ? `${m[1]} ${m[2]}` : m[1];
  return String(label || "").replace(/^Day\s*\d+\s*·\s*/i, "").slice(0, 10);
}

// ---------- Times ----------
// Times are typed by hand into a small box on a phone, so "9", "9.30" and
// "0930" all have to mean what they obviously mean. Returns minutes since
// midnight, or null for anything that isn't a time.
export function timeToMinutes(value) {
  const s = String(value || "").trim();
  if (!s) return null;
  const m = /^(\d{1,2})\s*[:.h]?\s*(\d{2})?\s*(am|pm)?$/i.exec(s);
  if (!m) return null;
  let hours = Number(m[1]);
  const mins = m[2] ? Number(m[2]) : 0;
  const suffix = (m[3] || "").toLowerCase();
  if (mins > 59) return null;
  if (suffix === "pm" && hours < 12) hours += 12;
  if (suffix === "am" && hours === 12) hours = 0;
  if (hours > 23) return null;
  return hours * 60 + mins;
}

export function formatTime(value) {
  const mins = timeToMinutes(value);
  if (mins == null) return String(value || "").trim();
  return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
}

// ---------- Days made when you need them ----------
// Scheduling used to require a plan to exist first: the day chips only
// appeared once days had been added in the Itinerary tab, and a saved place
// met "Add days in the Itinerary tab first" - a trip you have to set up
// before you can use it. But a day is only a label with a date in it, and
// the date is already known the moment you say "today" or tap one on a
// calendar. So it is made on the spot.
// Written the way the bundled days are, so dayLabelToDate() can read back
// anything this creates.
export const WEEKDAY_TITLES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const MONTH_TITLES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function labelForDate(date) {
  return `${WEEKDAY_TITLES[date.getDay()]} ${date.getDate()} ${MONTH_TITLES[date.getMonth()]}`;
}

// Reads the day-of-week out of a day label like "Day 3 · Fri 21 Aug".
export const DAY_NAMES = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

export function dayCodeFromLabel(label) {
  const m = String(label || "").match(/\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/i);
  if (!m) return null;
  const map = { sun: "Su", mon: "Mo", tue: "Tu", wed: "We", thu: "Th", fri: "Fr", sat: "Sa" };
  return map[m[1].slice(0, 3).toLowerCase()] || null;
}

export function clockOf(date) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
