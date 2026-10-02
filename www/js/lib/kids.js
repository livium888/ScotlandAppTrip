// Which saved places are for children, how the kids screen is titled, and how a
// search is worded for the ages actually coming. Pure, so it can be tested in
// Node directly.

// ---------- For kids ----------
// The Trip tab counted things - places saved, days planned, how many were
// scheduled - which is information you already have on the screens where it
// matters. It went where the tab that replaced it is now needed: with a
// small child, the question is never "how many places have I saved", it is
// "where can they run about" or "what do we do now it is raining", and the
// answer was scattered through a list of forty places with the castles.
//
// A place is marked for kids and appears here. Some mark themselves - a
// playground is not ambiguous - and the rest is a tap on the place's own
// sheet, because a four-year-old's opinion of a cathedral is not something
// the app can work out.
export const KID_CATEGORIES = [
  "playground", "park", "zoo", "aquarium", "farm", "soft play", "softplay",
  "swimming", "pool", "beach", "museum", "adventure", "theme park", "garden",
];

// What the app can tell on its own. Anything else is a decision, and a
// decision it would get wrong: a castle can be the best day of the week or
// an hour of being carried, and only you know which.
export function looksLikeKidPlace(pick) {
  const hay = `${pick.category || ""} ${pick.type || ""} ${pick.description || ""}`.toLowerCase();
  return KID_CATEGORIES.some((word) => hay.includes(word));
}

export function isForKids(pick) {
  if (pick.forKids === true) return true;
  if (pick.forKids === false) return false; // said no explicitly
  return looksLikeKidPlace(pick);
}

// Ways to find more, phrased as the thing you actually want rather than as a
// category. Each one runs the ordinary search, so everything the search
// screen does - the area it is anchored to, saving, putting on a day -
// works from here without being built twice.
export const KID_SEARCHES = [
  { icon: "🛝", label: "Playground", query: "playground with something for a young child" },
  { icon: "🧸", label: "Soft play", query: "indoor soft play or play barn for young children" },
  { icon: "🌧️", label: "If it rains", query: "indoors and good with a young child on a wet day" },
  { icon: "🐑", label: "Animals", query: "farm, animal park or aquarium a young child would like" },
  { icon: "🏊", label: "Swimming", query: "swimming pool with a shallow or toddler pool" },
  { icon: "🍦", label: "Ice cream", query: "ice cream worth stopping for" },
  { icon: "🍽️", label: "Eat with kids", query: "somewhere to eat that genuinely welcomes young children" },
  { icon: "🚻", label: "Baby change", query: "toilets with baby changing facilities" },
];

// "a young child" is what the app said when it did not know. It does know
// now, if anybody has been added, and "a 3-year-old" gets a noticeably
// different answer to "a 9-year-old" from the same question.
export function kidsTitleFor(kids) {
  const named = kids.map((k) => (k.name || "").trim()).filter(Boolean);
  if (named.length === 1) return `For ${named[0]}`;
  if (named.length === 2) return `For ${named[0]} and ${named[1]}`;
  return "For the kids";
}

export function forOurKids(query, kids) {
  const ages = kids
    .map((p) => p.age)
    .filter((a) => a != null)
    .sort((a, b) => a - b);
  if (!ages.length) return query;
  const said =
    ages.length === 1
      ? `a ${ages[0]}-year-old`
      : `children aged ${ages.join(" and ")}`;
  return query
    .replace(/a young child|young children/g, said)
    .replace(/young children/g, said);
}
