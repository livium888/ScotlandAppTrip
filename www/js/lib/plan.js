// How a trip's days and their stops are ordered. Pure, so it can be tested in
// Node directly.
import { timeToMinutes } from "./time.js";

export function planItems(plan, dayId) {
  return plan.items[dayId] || [];
}

// A day reads in the order you will walk it, not the order things happened
// to be added. Anything without a time keeps its position at the end: an
// unscheduled stop is a loose end, and sorting it into the middle of the day
// would imply a decision nobody made.
export function itemsInDayOrder(items) {
  return items
    .map((it, i) => ({ it, i, mins: timeToMinutes(it.time) }))
    .sort((a, b) => {
      if (a.mins == null && b.mins == null) return a.i - b.i;
      if (a.mins == null) return 1;
      if (b.mins == null) return -1;
      return a.mins - b.mins || a.i - b.i;
    })
    .map((x) => x.it);
}

// Which stop "NEXT" should point at. Only meaningful on the day itself -
// on any other day the first stop is the next one you will do.
export function nextItemIndex(ordered, isToday, now) {
  if (!isToday) return ordered.length ? 0 : -1;
  const minsNow = now.getHours() * 60 + now.getMinutes();
  // A stop counts as still ahead for a while after its time: standing
  // outside somewhere at 10:05 for a 10:00 booking, the next thing is
  // still that booking.
  const GRACE_MINS = 60;
  const idx = ordered.findIndex((it) => {
    const m = timeToMinutes(it.time);
    return m == null || m + GRACE_MINS >= minsNow;
  });
  return idx;
}
