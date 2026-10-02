// The saved-places list machinery that Saved and Kids share: the four orders,
// how places are cut into sections for each, folding long lists, and the
// small controls drawn above the list.
//
// Both screens used to carry their own copy of the idea, arranging the same
// places differently and badly. The sections and the markup are pure and
// tested in Node; createPickList holds the little state they need (which
// sections you folded, whether the order picker is open) and is handed the
// rest.
import { esc } from "../lib/text.js";
import { haversineKm, formatDistance } from "../lib/geo.js";
import { shortDayLabel } from "../lib/time.js";
import { itemsInDayOrder, planItems } from "../lib/plan.js";

// Ordering used to be two systems fighting each other. Places were grouped
// into sections by town, in whatever order the folders happened to be
// created, and *then* sorted inside each section by a separate chip. So
// "Nearest" meant nearest within a town, while the towns themselves sat in
// an arbitrary order; "By day" scattered Monday's stops across five
// sections; and the chip was a saved preference, so the list came back in a
// different order from the one you left it in, for no visible reason.
//
// One control now, and the chosen order decides the sections as well as the
// rows - so what you pick is what you see, top to bottom, with nothing else
// quietly rearranging it underneath.
export const SORTS = [
  { key: "area", label: "By area", note: "Grouped by town, A–Z inside" },
  { key: "day", label: "By day", note: "In the order you'll do them" },
  { key: "near", label: "Nearest", note: "One list, closest first" },
  { key: "recent", label: "Just added", note: "One list, newest first" },
];

// A saved choice, checked. "name" was a mode of its own before ordering and
// grouping were the same decision; it is how every grouped list is sorted
// inside a section now.
export function normaliseSort(v) {
  if (v === "name") return "area";
  return SORTS.some((s) => s.key === v) ? v : "area";
}

// ---------- One list, ordered one way ----------
// Both Picks and Kids are a list of saved places, and both were arranging
// them differently and badly. This is the single answer: given a list and a
// chosen order, hand back the sections to draw, in the order to draw them.
//
// Two of the four modes have no sections at all, and that is the point - a
// flat list is what "nearest" and "just added" mean. Cutting either into
// towns would put a place 2 miles away below a heading three screens down.
export function groupPicks(list, mode, options) {
  // The origin is worked out by the caller, who knows where the day starts.
  const origin = mode === "near" ? (options && options.origin) || null : null;
  const away = (p) =>
    origin && p.lat != null && p.id !== origin.id
      ? formatDistance(haversineKm(origin.lat, origin.lon, p.lat, p.lon))
      : null;
  const byName = (a, b) => a.name.localeCompare(b.name, "en-GB");

  if (mode === "near") {
    const sorted = list.slice().sort((a, b) => {
      // Somewhere with no coordinates is not nearby, it is unknown, so it
      // sinks rather than claiming a place in the order.
      if (a.lat == null) return b.lat == null ? byName(a, b) : 1;
      if (b.lat == null) return -1;
      // With nowhere to measure from, fall back to A-Z rather than guessing.
      if (!origin) return byName(a, b);
      return (
        haversineKm(origin.lat, origin.lon, a.lat, a.lon) -
        haversineKm(origin.lat, origin.lon, b.lat, b.lon)
      );
    });
    return [
      {
        label: origin ? `Closest to ${origin.name}` : "Closest first",
        count: sorted.length,
        rows: sorted.map((p) => ({ pick: p, away: away(p), meta: p.city })),
      },
    ];
  }

  if (mode === "recent") {
    const sorted = list.slice().sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
    return [
      {
        label: "Newest first",
        count: sorted.length,
        rows: sorted.map((p) => ({ pick: p, meta: p.city })),
      },
    ];
  }

  if (mode === "day") {
    const plan = options.plan();
    const placed = {};
    const sections = plan.days.map((d) => {
      const items = itemsInDayOrder(planItems(plan, d.id));
      const rows = [];
      items.forEach((it) => {
        const p = list.find((x) => x.id === it.pickId);
        if (!p) return;
        placed[p.id] = true;
        rows.push({ pick: p, meta: [it.time, p.city].filter(Boolean).join(" · ") });
      });
      return { label: shortDayLabel(d.label), full: d.label, count: rows.length, rows };
    });
    // Everything not on a day yet, last - which is where the work is, and
    // the reason to be on this screen at all.
    const loose = list.filter((p) => !placed[p.id]).sort(byName);
    if (loose.length) {
      sections.push({
        label: "Not on a day yet",
        count: loose.length,
        rows: loose.map((p) => ({ pick: p, meta: p.city })),
        loose: true,
      });
    }
    return sections.filter((s) => s.rows.length);
  }

  // By area. Sections follow the folders list so a renamed or reordered
  // folder stays put, then any town value predating folders, then Unsorted.
  const order = options.folders().slice();
  list.forEach((p) => {
    if (p.city && !order.includes(p.city)) order.push(p.city);
  });
  order.push("Unsorted");
  const groups = {};
  order.forEach((c) => (groups[c] = []));
  list.forEach((p) => (groups[p.city] || groups.Unsorted).push(p));
  return order
    .filter((c) => groups[c] && groups[c].length)
    .map((c) => ({
      label: c,
      area: c,
      count: groups[c].length,
      rows: groups[c].sort(byName).map((p) => ({ pick: p, meta: p.category })),
    }));
}

// A heading you can fold, with the count still on it - the count is what
// makes a folded section useful rather than just hidden.
export function sectionHeadHtml(label, count, folded, icon) {
  return `
    <button class="section-label list-head section-fold${folded ? " folded" : ""}"
            data-fold="${esc(label)}" aria-expanded="${folded ? "false" : "true"}">
      <span class="fold-caret">${icon(folded ? "forward" : "down", { size: 15 })}</span>
      <span class="fold-label">${esc(label)}</span>
      <span class="list-head-count">${count}</span>
    </button>
  `;
}

// Only worth offering past the point where scrolling becomes the problem.
export function foldAllHtml(labels, collapsed) {
  if (labels.length < 3) return "";
  const allFolded = labels.every((l) => collapsed.includes(l));
  return `
    <div class="fold-all">
      <button class="link-btn" data-fold-all="${allFolded ? "open" : "close"}">
        ${allFolded ? "Open all" : "Fold all"}
      </button>
    </div>
  `;
}

export function sortRowHtml(mode, open, icon) {
  const current = SORTS.find((s) => s.key === mode) || SORTS[0];
  if (!open) {
    return `
      <div class="order-bar folded">
        <button class="order-toggle" id="sortToggle">
          ${icon("list", { size: 15, cls: "ico-inline" })} ${esc(current.label)}
        </button>
      </div>
    `;
  }
  return `
    <div class="order-bar">
      <div class="order-chips">
        ${SORTS.map(
          (s) =>
            `<button class="order-chip${s.key === mode ? " on" : ""}" data-sort="${s.key}">${esc(
              s.label
            )}</button>`
        ).join("")}
      </div>
      <p class="order-note">${esc(current.note)}</p>
    </div>
  `;
}

export function createPickList(ctx) {
  const { view, storage, boardKey, activeBoard, loadPlan, loadPicks, loadFolders, destinationAnchor, sortKey } = ctx;
  let sortOpen = false;

  function loadSort() {
    return normaliseSort(storage.readJson(sortKey, "area"));
  }

  function saveSort(key) {
    storage.write(sortKey, JSON.stringify(key));
  }

  // "Nearest" needs somewhere to be near. The first scheduled stop is the
  // best answer - that's where the day starts - then anything saved with
  // coordinates, then the board's own destination.
  function sortOrigin() {
    const plan = loadPlan();
    const picks = loadPicks();
    const byId = {};
    picks.forEach((p) => (byId[p.id] = p));
    for (const day of plan.days) {
      for (const it of plan.items[day.id] || []) {
        const p = byId[it.pickId];
        if (p && p.lat != null) return p;
      }
    }
    return picks.find((p) => p.lat != null) || destinationAnchor(null);
  }

  // Sections for a list, in the order to draw them. The lookups are passed as
  // functions so only the ones an order needs are made.
  function group(list, mode, options) {
    const given = (options && options.origin) || null;
    return groupPicks(list, mode, {
      origin: mode === "near" ? given || sortOrigin() : null,
      plan: loadPlan,
      folders: loadFolders,
    });
  }

  // ---------- Folding a long list ----------
  // With five saved places the sections are a nicety. With fifty they are the
  // only thing between you and a scroll that never ends, so they fold - and
  // which ones you folded is remembered, because a list you have tidied
  // should stay tidy.
  function loadCollapsed() {
    const v = storage.readJson(boardKey(activeBoard().id, "collapsed"), []);
    return Array.isArray(v) ? v : [];
  }

  function toggleCollapsed(label) {
    const list = loadCollapsed();
    const i = list.indexOf(label);
    if (i < 0) list.push(label);
    else list.splice(i, 1);
    storage.write(boardKey(activeBoard().id, "collapsed"), JSON.stringify(list));
  }

  function setAllCollapsed(labels, collapsed) {
    storage.write(boardKey(activeBoard().id, "collapsed"), JSON.stringify(collapsed ? labels : []));
  }

  const sectionHead = (label, count, folded) => sectionHeadHtml(label, count, folded, icon);
  const foldAllBar = (labels) => foldAllHtml(labels, loadCollapsed());
  const renderSortRow = (mode) => sortRowHtml(mode, sortOpen, icon);

  // The control that chooses it. One row, always visible, always saying which
  // one is on - it was a saved preference with no label, so the list order
  // changed between visits with nothing on screen to explain why.
  // Folded to a single button that names the order it is in. The visibility
  // that rule was written for is kept - you can still read the current order
  // without tapping anything - it just no longer costs four chips and a
  // caption on a screen that already carries a search field, an explore row
  // and the kind filter above it.
  // Both Picks and Kids carry this control and share the saved choice, so
  // they share the wiring too. Picking an order folds the picker again: the
  // button then names what you just chose, which is the whole point of it.
  function wireSortRow(redraw) {
    const toggle = document.getElementById("sortToggle");
    if (toggle) {
      toggle.addEventListener("click", () => {
        sortOpen = true;
        redraw();
      });
    }
    view.querySelectorAll("[data-sort]").forEach((btn) =>
      btn.addEventListener("click", () => {
        saveSort(btn.getAttribute("data-sort"));
        sortOpen = false;
        redraw();
      })
    );
  }

  return {
    loadSort, group, loadCollapsed, toggleCollapsed, setAllCollapsed,
    sectionHead, foldAllBar, renderSortRow, wireSortRow,
  };
}
