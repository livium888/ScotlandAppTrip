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
// Each search is worded three ways - for everyone, for kids mode and for
// adults mode - so each has a marker per wording it can be sent in.
export const ANGLE_MARKERS = {
  music: ['live music'],
  market: ["farmers' markets", 'family food festivals'],
  family: ['things on for children'],
  arts: ['am-dram', 'magic shows'],
  outdoors: ['sheepdog trials', 'pond dipping'],
  hall: ['beetle drives', "children's discos", 'harvest suppers'],
  clubs: ['horticultural', 'coding and science clubs'],
  fetes: ['duck races', 'race nights'],
  oneoff: ['well dressings', 'pumpkin picking'],
  films: ['showing at cinemas'],
  theatre: ['opera and ballet', "children's plays"],
  workshops: ['LEGO'],
  storytime: ['family trails'],
  swim: ['inflatable'],
  active: ['trampoline park'],
  animals: ['meet-the-keeper'],
  holiday: ['half-term clubs'],
  kidsmusic: ['toddler music classes'],
};

export const ANGLE_KEYS = Object.keys(ANGLE_MARKERS);

// The kinds a search with nothing picked runs. Films and theatre are
// searched only when picked - a week of listings would bury everything else.
// The children's session searches are the same: each its own row on Find.
export const ON_THEIR_OWN = ['films', 'theatre', 'workshops', 'storytime', 'swim', 'active', 'animals', 'holiday', 'kidsmusic'];
export const EVERYTHING_KEYS = ANGLE_KEYS.filter((k) => !ON_THEIR_OWN.includes(k));

// The angle a prompt is for, or null. Deliberately checks every marker rather
// than returning on the first hit: a prompt matching two markers means the
// markers have stopped being distinctive, and silently picking the first would
// hide that until a suite failed for an unrelated-looking reason.
export function angleFromPrompt(prompt) {
  const hits = ANGLE_KEYS.filter((k) => ANGLE_MARKERS[k].some((m) => prompt.includes(m)));
  if (hits.length > 1) throw new Error(`ambiguous angle markers: ${hits.join(', ')}`);
  return hits[0] || null;
}
