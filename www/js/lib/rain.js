// The rain plan: which stops on a wet day are outdoors, and the banner that
// offers a way to indoor alternatives.
//
// The app already warns about an outdoor event on a wet day. This is the
// next step - not just "it will rain" but "these two stops are outdoors, and
// here is the way to somewhere dry nearby". Pure, so the rules can be tested
// without a page. It never changes the plan: it points, you decide.
import { esc } from "./text.js";

// As far as Open-Meteo forecasts; the same line the event warning uses.
export const WET_ENOUGH = 50;

// "Indoor" is checked first so that an indoor playground, or a museum on Park
// Road, is not taken for the outdoors by one word in its name.
const INDOOR = /\b(indoor|soft ?play|museum|gallery|cinema|theatre|theater|aquarium|caf[eé]|restaurant|pub|library|shop|centre|center|studio)\b/;
const OUTDOOR = /\b(park|gardens?|beach|walks?|trails?|hill|forest|woods?|woodland|lake|loch|viewpoint|playground|nature reserve|common|heath|coast|coastal|cliffs?)\b/;

// Conservative on purpose. Wrongly saying a stop is outdoors is nagging;
// missing one is a smaller loss, and a place nothing is known about is left
// alone rather than guessed at.
export function isOutdoorPick(p) {
  if (!p || p.major) return false;
  if (p.setting) return p.setting === "outdoor";
  const hay = `${p.category || ""} ${p.name || ""} ${p.description || ""}`.toLowerCase();
  if (INDOOR.test(hay)) return false;
  return OUTDOOR.test(hay);
}

// `stops` are a day's saved places in the order of the day. Returns what the
// banner needs, or null when there is nothing to say.
export function rainPlan({ stops, rainChance, threshold = WET_ENOUGH }) {
  if (rainChance == null || rainChance < threshold) return null;
  const outdoor = (stops || []).filter(isOutdoorPick);
  if (!outdoor.length) return null;
  // Centred on the first outdoor stop that has a place on the map, since the
  // search is "near here".
  const first = outdoor.find((p) => p.lat != null) || outdoor[0];
  return { chance: rainChance, outdoor, first };
}

export function rainBannerHtml(plan, icon) {
  if (!plan) return "";
  const names = plan.outdoor.slice(0, 3).map((p) => esc(p.name));
  const more = plan.outdoor.length - names.length;
  const list = more > 0 ? `${names.join(", ")} and ${more} more` : names.join(", ");
  return `
    <div class="rain-plan" role="status">
      <div class="rain-plan-text">${icon("rain", { size: 16, cls: "ico-inline" })} <b>Rain likely (${esc(String(plan.chance))}%).</b> Outdoors: ${list}.</div>
      <button class="modal-btn rain-plan-btn" data-rain-search="${esc(plan.first.id)}" aria-label="Find indoor options near ${esc(plan.first.name)}">Find indoor options</button>
    </div>`;
}

// The indoor search to start from: the child-friendly one when there are
// children, the general "better in bad weather" one otherwise.
export function rainCategoryKey(kids) {
  return kids ? "rainy" : "rain";
}
