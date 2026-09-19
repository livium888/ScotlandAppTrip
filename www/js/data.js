// What the app starts with before you have told it anything.
//
// This file used to be a 500-line guide to one week in Scotland - the places,
// the meals, the day-by-day, the costs, the local advice. That trip happened,
// and shipping somebody else's finished holiday inside a general trip app is
// the single thing that made it read as not-for-you. It is gone.
//
// What is left is the little that every trip needs a starting point for.

const TRIP = {
  // The name a brand-new board gets before it is renamed. Not the app's name.
  title: "My trip",
};

// The region appended to place lookups by default. Blank means search
// worldwide, which is the honest default when nothing is known yet; the
// welcome screen asks where you are going and fills it in.
const DEFAULT_DESTINATION = "";

// A packing list has to start somewhere, and an empty one is a worse start
// than a short generic one - nobody types "phone charger" into an empty
// screen, they just close it. Deliberately short: eight lines you would
// actually tick, not a checklist of forty that gets abandoned.
//
// `loadPacking` adds to this from who is travelling, so a buggy and a
// three-year-old's comfort item appear only for the families that have them.
const PACKING = [
  "Chargers, and something to charge from in the car",
  "Layers — a jacket you can take off",
  "Waterproof, or something with a hood",
  "Comfortable shoes you have already walked in",
  "Snacks and water for the journeys",
  "Any tickets downloaded, not just bookmarked",
  "Painkillers, plasters, sun cream",
  "A bag small enough to carry all day",
];
