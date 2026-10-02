// Distances and travel times between places. Pure arithmetic and wording, so
// it can be tested in Node directly.

export function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Rough walking time between two stops. Deliberately straight-line distance
// with a detour factor rather than a routing API - it needs no key, works
// offline, and the point is to flag "that's a long way with a small child",
// not to give turn-by-turn timings.
// Walking pace depends on who is walking. This was a constant 3.5 km/h -
// "this is with a 4-year-old" - for everybody, so an adults-only trip got
// a child's walking times on every leg.
export const WALK_KMH_CHILD = 3.5;

export const WALK_KMH_ADULT = 5;

export const DETOUR_FACTOR = 1.3; // streets aren't straight lines

// ---------- Distance ----------
// This is a UK trip planned by someone who thinks in miles, and the app was
// quoting kilometres at them. Every distance goes through here so there is
// one place that decides, rather than six sites each formatting their own.
export const MILES_PER_KM = 0.621371;

export function toMiles(km) {
  return km * MILES_PER_KM;
}

// Under about a quarter of a mile, a fraction is harder to picture than
// yards - "0.2 miles" versus "350 yards".
export function formatDistance(km) {
  const mi = toMiles(km);
  if (mi < 0.25) return `${Math.round(mi * 1760 / 10) * 10} yd`;
  if (mi < 10) return `${mi.toFixed(1)} mi`;
  return `${Math.round(mi)} mi`;
}

export function formatDuration(mins) {
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

// Beyond this, a leg is a drive. Two miles is about the furthest that
// reads as "we'll walk it" with a four-year-old who has already done a
// castle that morning.
export const WALK_MAX_KM = 3.2;

// Deliberately conservative: a UK average across single carriageways,
// towns and the odd motorway stretch. Better to over-estimate a drive than
// to promise Stirling in forty minutes.
export const DRIVE_KMH = 60;

export const ROAD_FACTOR = 1.35; // roads wander more than streets do

export function legLabel(leg) {
  return `${leg.icon} ${formatDuration(leg.mins)} · ${formatDistance(leg.km)}`;
}
