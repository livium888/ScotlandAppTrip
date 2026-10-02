// How a saved place is drawn in a list: the row, the heading of a town, the
// photo block, the actions behind a swipe, the find box, and finding among
// what is saved.
//
// Every list of saved places shares these. They are string-building
// functions, pure given their inputs, so what they print (the badges, the
// escaping, what goes in the meta line) can be tested in Node. The factory is
// handed the icon drawer and the few lookups a row needs.
import { esc } from "../lib/text.js";
import { shortDayLabel } from "../lib/time.js";

// What a row shows when there is no photograph: the category, drawn, on a
// tinted square. An empty grey box says the app is broken; this says there
// is no picture of this pub, which is true and unremarkable.
export const CATEGORY_ICONS = [
  [/castle|palace|fort|tower|ruin|abbey|cathedral|church|monument|historic/i, "castle"],
  [/museum|gallery|exhibit/i, "note"],
  [/playground|soft play|park|garden|zoo|farm|animal/i, "kids"],
  [/beach|coast|loch|lake|river|waterfall|hill|mountain|walk|trail|glen|forest|wood/i, "walk"],
  [/pub|bar|inn|distillery|brewery|whisky/i, "food"],
  [/cafe|café|coffee|bakery|tea/i, "coffee"],
  [/restaurant|bistro|grill|pizza|chippy|takeaway|eat|food|diner/i, "food"],
  [/hotel|b&b|guest|hostel|stay/i, "tips"],
  [/town|city|village|area|region/i, "globe"],
];

export function categoryIcon(p) {
  const hay = `${p.category || ""} ${p.name || ""} ${p.description || ""}`;
  const hit = CATEGORY_ICONS.find(([re]) => re.test(hay));
  return hit ? hit[1] : "pin";
}

export const FIND_KEYS = [
  { name: "name", weight: 0.6 },
  { name: "city", weight: 0.15 },
  { name: "category", weight: 0.1 },
  { name: "note", weight: 0.1 },
  { name: "address", weight: 0.05 },
];

export function findInPicks(list, query, FuseImpl = typeof window !== "undefined" ? window.Fuse : null) {
  const q = (query || "").trim();
  if (!q) return list;
  const Fuse = FuseImpl;
  if (!Fuse) {
    // Without the library, a plain substring match over the same fields.
    // Worse, but never nothing.
    const needle = q.toLowerCase();
    return list.filter((p) =>
      FIND_KEYS.some((k) => String(p[k.name] || "").toLowerCase().includes(needle))
    );
  }
  const fuse = new Fuse(list, {
    keys: FIND_KEYS,
    // Tight enough that "castle" doesn't match "Cafe", loose enough to
    // survive a thumb typing on a moving train.
    threshold: 0.38,
    ignoreLocation: true,
    minMatchCharLength: 2,
  });
  return fuse.search(q).map((hit) => hit.item);
}

export function createPickRows(ctx) {
  const { icon, loadPlan, eventDateLabel, eventIsPast } = ctx;

  // `size` is "thumb" for a row or "hero" for the top of a sheet.
  function photoBlock(p, size) {
    const cls = size === "hero" ? "photo-hero" : "photo-thumb";
    if (p.photo) {
      // data-photo keeps the original address after src has been swapped for
      // a blob, so the cache stays keyed on the picture rather than on a URL
      // that only exists in this tab.
      return `<div class="${cls}"><img src="${esc(p.photo)}" data-photo="${esc(p.photo)}" alt="" loading="lazy" decoding="async" /></div>`;
    }
    return `<div class="${cls} photo-none">${icon(categoryIcon(p), { size: size === "hero" ? 44 : 22 })}</div>`;
  }

  // The actions revealed behind a row. Rendered with the row rather than built
  // when the gesture starts, because that is a frame you cannot spare.
  function rowActions(id) {
    return `
      <div class="row-actions" aria-hidden="true">
        <button class="row-action day" data-row-day="${esc(id)}" tabindex="-1"
                aria-label="Put on a day">${icon("calendarPlus", { size: 18 })}<span>Day</span></button>
        <button class="row-action remove" data-row-remove="${esc(id)}" tabindex="-1"
                aria-label="Remove">${icon("trash", { size: 18 })}<span>Remove</span></button>
      </div>
    `;
  }

  // A pick in the list is a summary, not a dossier. The card used to render
  // every fact, a live map and eight controls for every saved place - so ten
  // places meant ten stacked detail pages and ten Leaflet instances, with
  // nothing to scan and no hierarchy. The row below carries only what you
  // need to recognise and triage it; everything else lives one tap away in
  // openPickDetail(), which also means only one map exists at a time.
  // `extra` is whatever the current order makes worth knowing about this row:
  // the town when the list is flat, the time when it is grouped by day, the
  // category when the section is already the town. The row does not decide -
  // it is told, by whoever grouped the list.
  function renderPickRow(p, away, extra, hideDays) {
    const plan = loadPlan();
    // Grouped by day, the heading above already says which day this is, and
    // repeating it on every row is noise on the screen that was too busy to
    // read in the first place.
    const days = hideDays
      ? []
      : plan.days
          .filter((d) => (plan.items[d.id] || []).some((it) => it.pickId === p.id))
          .map((d) => shortDayLabel(d.label));

    // Escaped in parts, because the rating carries a drawn star: escaping the
    // joined string would have printed the SVG rather than shown it.
    // For an event the date outranks the category: "Sat 6 Sep, 19:30" is what
    // you need off a row, and "Music" is not.
    const isEvent = p.kind === "event";
    const meta = [isEvent ? eventDateLabel(p) || p.category : extra === undefined ? p.category : extra, away]
      .filter(Boolean)
      .map((x) => esc(String(x)))
      .concat(p.rating != null ? [`${icon("star", { size: 13, cls: "ico-inline" })} ${esc(String(p.rating))}`] : [])
      .join(" · ");

    return `
      <div class="swipeable">
        ${rowActions(p.id)}
      <button class="pick-row${isEvent && eventIsPast(p) ? " pick-row-past" : ""}" data-open-pick="${esc(p.id)}">
        ${photoBlock(p, "thumb")}
        <div class="pick-row-main">
          <div class="pick-row-name">${esc(p.name)}</div>
          ${meta ? `<div class="pick-row-meta">${meta}</div>` : ""}
          <div class="pick-row-badges">
            ${days.map((d) => `<span class="row-badge day">${esc(d)}</span>`).join("")}
            ${p.booked ? `<span class="row-badge booked">booked</span>` : ""}
            ${p.note ? `<span class="row-badge note">note</span>` : ""}
            ${p.geoAlternatives ? `<span class="row-badge doubt">location?</span>` : ""}
            ${isEvent && eventIsPast(p) ? `<span class="row-badge past">been and gone</span>` : ""}
            ${isEvent && p.unverified && !eventIsPast(p) ? `<span class="row-badge doubt">check it's on</span>` : ""}
            ${p.enrichStatus === "loading" ? `<span class="row-badge">loading…</span>` : ""}
          </div>
        </div>
        <span class="pick-row-chevron">${icon('forward', { size: 17, cls: 'ico-inline' })}</span>
      </button>
      </div>
    `;
  }

  // The heading a section of places sits under. It opens the same detail sheet
  // as any other saved place, but the thing you actually want from a town is
  // what's around it, so that gets its own control rather than three taps
  // through the sheet.
  function renderMajorHeader(p, count, folded) {
    const meta = count ? `${count} place${count === 1 ? "" : "s"} saved here` : "Nothing saved here yet";
    return `
      <div class="area-head">
        ${
          count
            ? `<button class="area-fold${folded ? " folded" : ""}" data-fold="${esc(p.name)}"
                       aria-label="${folded ? "Open" : "Fold"} ${esc(p.name)}"
                       aria-expanded="${folded ? "false" : "true"}">${icon(folded ? "forward" : "down", {
                size: 16,
              })}</button>`
            : ""
        }
        <button class="area-head-main" data-open-pick="${esc(p.id)}">
          <span class="area-head-icon">${icon('globe', { size: 15, cls: 'ico-inline' })}</span>
          <span class="area-head-text">
            <span class="area-head-name">${esc(p.name)}</span>
            <span class="area-head-meta">${esc(meta)}</span>
          </span>
          <span class="pick-row-chevron">${icon('forward', { size: 17, cls: 'ico-inline' })}</span>
        </button>
        <button class="area-head-explore" data-explore-from="${esc(p.id)}">${icon('directions', { size: 16, cls: 'ico-inline' })} What's nearby</button>
      </div>
    `;
  }

  function findBarHtml(total, pickFilter) {
    // Not worth the room until there is enough saved that scrolling is the
    // problem it solves.
    if (total < 8 && !pickFilter) return "";
    return `
      <div class="find-bar">
        <span class="find-icon" data-ico="search" data-ico-size="17"></span>
        <input class="find-input" id="pickFind" type="search" autocomplete="off"
               placeholder="Find something you've saved…" value="${esc(pickFilter)}"
               aria-label="Find something you have already saved" />
        ${pickFilter ? `<button class="find-clear" id="pickFindClear" aria-label="Clear">${icon("close", { size: 15 })}</button>` : ""}
      </div>
    `;
  }

  return { photoBlock, rowActions, renderPickRow, renderMajorHeader, findBarHtml };
}
