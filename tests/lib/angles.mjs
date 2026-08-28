// Which of the event searches a prompt belongs to.
//
// The suites each had their own copy of this, matching on a phrase lifted out
// of that angle's wording — and when the wording was rewritten to go after
// smaller events, all four broke at once, in the same way, for the same
// reason. Same failure as the tab selectors before them: one fact, four
// copies. There is one copy now.
//
// The markers are chosen to be distinctive and unlikely to be edited away: a
// word that only that search would ever use. If a rewrite does remove one,
// this file is the single place it has to be fixed, and the assertion below
// says so loudly rather than a suite quietly matching the wrong angle.
export const ANGLE_MARKERS = {
  music: 'live music',
  market: "farmers' markets",
  family: 'things on for children',
  arts: 'am-dram',
  outdoors: 'sheepdog trials',
  hall: 'beetle drives',
  clubs: 'horticultural',
  fetes: 'duck races',
  oneoff: 'well dressings',
};

export const ANGLE_KEYS = Object.keys(ANGLE_MARKERS);

// The angle a prompt is for, or null. Deliberately checks every marker rather
// than returning on the first hit: a prompt matching two markers means the
// markers have stopped being distinctive, and silently picking the first would
// hide that until a suite failed for an unrelated-looking reason.
export function angleFromPrompt(prompt) {
  const hits = ANGLE_KEYS.filter((k) => prompt.includes(ANGLE_MARKERS[k]));
  if (hits.length > 1) throw new Error(`ambiguous angle markers: ${hits.join(', ')}`);
  return hits[0] || null;
}
