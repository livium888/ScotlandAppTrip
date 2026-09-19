// The first thirty seconds, and the way back to them.
//
// app.js decides whether a brand-new install should be asked anything, and
// opens its own three-question welcome sheet when the answer is yes. This file
// runs after it and takes that sheet over: four questions, one screen each -
// where, when, who, and what kind of trip - all of them skippable, none of them
// asking about API keys or models.
//
// It also fixes the thing that made all of it invisible: only a *new* install
// ever saw the questions, so anybody who already had a trip (which is everyone
// who updates) could not find them at all. More now carries a "Trip setup" row
// that opens the same four steps with the current trip filled in, so the
// answers can be seen and changed without wiping the app.
(function () {
  "use strict";

  const ONBOARDED_KEY = "onboarded-v1";
  const overlay = document.getElementById("welcomeOverlay");
  if (!overlay) return;

  const WHO_OPTIONS = [
    { label: "Just me", adults: 1, children: 0 },
    { label: "Two of us", adults: 2, children: 0 },
    { label: "Family with young kids", adults: 2, children: 1 },
    { label: "Family with teenagers", adults: 2, children: 2 },
    { label: "A group of friends", adults: 4, children: 0 },
  ];
  const TRIP_TYPES = [
    "A relaxed getaway",
    "Family adventure",
    "Outdoors and walking",
    "Food and culture",
    "A road trip",
    "City break",
  ];
  const SUGGESTIONS = ["Cornwall", "The Lake District", "Snowdonia", "The Highlands", "Amsterdam", "Lisbon"];

  // Opened by a person rather than by a new install. It only changes two
  // things: the first button says Cancel rather than Skip, and the answers
  // start from the trip already stored instead of from nothing.
  let openedByHand = false;

  const esc = (value) => String(value == null ? "" : value).replace(/[&<>"'`]/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "`": "&#96;",
  }[c]));

  function readJson(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key));
      return value == null ? fallback : value;
    } catch (e) {
      return fallback;
    }
  }

  function storedBoard() {
    const state = readJson("boards-v1", { activeId: null, boards: [] });
    const boards = Array.isArray(state.boards) ? state.boards : [];
    return boards.find((item) => item.id === state.activeId) || boards[0] || null;
  }

  function blank() {
    return { step: 0, where: "", start: "", days: "", adults: "", children: "", details: "", whoPreset: "", tripType: "" };
  }

  let state = blank();

  // What the app already knows, in the shape the four steps ask for. Anything
  // it does not know stays empty, so a question you have never answered still
  // reads as a question.
  function fromCurrentTrip() {
    const next = blank();
    const settings = readJson("trip-settings-v1", {});
    const board = storedBoard();

    const where = String(settings.destination || (board && board.destination) || "").trim();
    if (where) next.where = where;

    const travellers = String(settings.travellers || "").trim();
    if (travellers) {
      const preset = WHO_OPTIONS.find((x) => x.label === travellers);
      if (preset) {
        next.whoPreset = preset.label;
        next.adults = String(preset.adults);
        next.children = String(preset.children);
      } else {
        const adults = /(\d+)\s+adult/.exec(travellers);
        const children = /(\d+)\s+child/.exec(travellers);
        if (adults) next.adults = adults[1];
        if (children) next.children = children[1];
        const stop = travellers.indexOf(". ");
        if (stop >= 0) next.details = travellers.slice(stop + 2).trim();
      }
    }

    if (settings.tripType) next.tripType = settings.tripType;

    const plan = board ? readJson(`board:${board.id}:plan`, null) : null;
    if (plan && Array.isArray(plan.days) && plan.days.length && plan.days[0].date) {
      next.start = plan.days[0].date;
      next.days = String(plan.days.length);
    }
    return next;
  }

  // ---------- The questions ----------

  // Only the questions that cannot be left blank disable the way on. Dates are
  // asked for (and used to build the days) but stay optional, because a trip
  // can legitimately be planned before its dates are known.
  function canContinue() {
    if (state.step === 0) return !!state.where.trim();
    if (state.step === 1) return true;
    if (state.step === 2) return Number(state.adults) + Number(state.children) > 0;
    return !!state.tripType;
  }

  function stepMarkup() {
    if (state.step === 0) return {
      kicker: "1 of 4 · Destination",
      title: "Where are you going?",
      sub: "We’ll use this to make searches and suggestions relevant to your trip.",
      body: `<input class="welcome-input" id="welcomeWhere" type="text" value="${esc(state.where)}" placeholder="Cornwall, the Dolomites, Lisbon…" autocomplete="off" />
        <div class="search-chips welcome-chips">${SUGGESTIONS.map((x) => `<button class="search-chip" data-welcome-where="${esc(x)}">${esc(x)}</button>`).join("")}</div>`,
    };
    if (state.step === 1) return {
      kicker: "2 of 4 · Dates",
      title: "What dates are you going?",
      sub: "A start date and trip length give Today and your itinerary a useful shape. Optional — you can add or change them later.",
      body: `<label class="welcome-label" for="welcomeStart">First day</label>
        <input class="welcome-input" id="welcomeStart" type="date" value="${esc(state.start)}" />
        <label class="welcome-label" for="welcomeDays">How many days?</label>
        <input class="welcome-input" id="welcomeDays" type="number" min="1" max="21" inputmode="numeric" value="${esc(state.days)}" placeholder="3" />`,
    };
    if (state.step === 2) return {
      kicker: "3 of 4 · Travellers",
      title: "Who is travelling?",
      sub: "Tell us the shape of the group. Add a little detail if it will change what makes a good day.",
      body: `<div class="search-chips welcome-chips">${WHO_OPTIONS.map((x) => `<button class="search-chip${state.whoPreset === x.label ? " on" : ""}" data-welcome-who="${esc(x.label)}">${esc(x.label)}</button>`).join("")}</div>
        <div class="welcome-counts"><div><label class="welcome-label" for="welcomeAdults">Adults</label><input class="welcome-input" id="welcomeAdults" type="number" min="0" max="20" inputmode="numeric" value="${esc(state.adults)}" placeholder="2" /></div>
        <div><label class="welcome-label" for="welcomeChildren">Children</label><input class="welcome-input" id="welcomeChildren" type="number" min="0" max="20" inputmode="numeric" value="${esc(state.children)}" placeholder="0" /></div></div>
        <label class="welcome-label" for="welcomeDetails">Anything useful to know? <span>(optional)</span></label>
        <input class="welcome-input" id="welcomeDetails" type="text" value="${esc(state.details)}" placeholder="A 4-year-old, grandparents, short walks…" autocomplete="off" />`,
    };
    return {
      kicker: "4 of 4 · Trip style",
      title: "What kind of trip is this?",
      sub: "Choose the closest fit. This shapes suggestions without asking you to configure anything technical.",
      body: `<div class="search-chips welcome-chips welcome-trip-types">${TRIP_TYPES.map((x) => `<button class="search-chip${state.tripType === x ? " on" : ""}" data-welcome-trip-type="${esc(x)}">${esc(x)}</button>`).join("")}</div>`,
    };
  }

  function readInputs() {
    ["where", "start", "days", "adults", "children", "details"].forEach((key) => {
      const id = key === "days" ? "welcomeDays" : `welcome${key[0].toUpperCase()}${key.slice(1)}`;
      const input = document.getElementById(id);
      if (input) state[key] = input.value;
    });
  }

  function render() {
    const step = stepMarkup();
    const last = state.step === 3;
    overlay.innerHTML = `<div class="welcome-body"><div class="welcome-dots">${[0, 1, 2, 3].map((i) => `<span class="welcome-dot${i === state.step ? " on" : ""}"></span>`).join("")}</div>
      <div class="welcome-kicker">${esc(step.kicker)}</div><h1 class="welcome-title">${esc(step.title)}</h1><p class="welcome-sub">${esc(step.sub)}</p>${step.body}</div>
      <div class="welcome-foot">${state.step > 0
        ? '<button class="modal-btn" data-welcome-back="1">Back</button>'
        : `<button class="modal-btn" data-welcome-skip="1">${openedByHand ? "Cancel" : "Skip"}</button>`}
      <button class="modal-btn modal-btn-primary" data-welcome-next="1"${canContinue() ? "" : " disabled"}>${last ? "Start planning" : "Next"}</button></div>`;
    overlay.classList.add("open");
    wire();
  }

  function updateFromInput() {
    readInputs();
    const next = overlay.querySelector("[data-welcome-next]");
    if (next) next.disabled = !canContinue();
  }

  function wire() {
    overlay.querySelectorAll("[data-welcome-where]").forEach((button) => button.addEventListener("click", () => {
      state.where = button.getAttribute("data-welcome-where");
      render();
    }));
    overlay.querySelectorAll("[data-welcome-who]").forEach((button) => button.addEventListener("click", () => {
      const preset = WHO_OPTIONS.find((x) => x.label === button.getAttribute("data-welcome-who"));
      state.whoPreset = preset.label;
      state.adults = String(preset.adults);
      state.children = String(preset.children);
      render();
    }));
    overlay.querySelectorAll("[data-welcome-trip-type]").forEach((button) => button.addEventListener("click", () => {
      state.tripType = button.getAttribute("data-welcome-trip-type");
      render();
    }));
    overlay.querySelectorAll("input").forEach((input) => {
      input.addEventListener("input", updateFromInput);
      input.addEventListener("change", updateFromInput);
    });
    const skip = overlay.querySelector("[data-welcome-skip]");
    if (skip) skip.addEventListener("click", () => finish(true));
    const back = overlay.querySelector("[data-welcome-back]");
    if (back) back.addEventListener("click", () => { readInputs(); state.step -= 1; render(); });
    const next = overlay.querySelector("[data-welcome-next]");
    if (next) next.addEventListener("click", () => {
      readInputs();
      if (!canContinue()) return;
      if (state.step === 3) finish();
      else { state.step += 1; render(); }
    });
  }

  function close() {
    overlay.classList.remove("open");
    overlay.innerHTML = "";
  }

  function finish(skipped) {
    localStorage.setItem(ONBOARDED_KEY, String(Date.now()));
    if (skipped) {
      close();
      return;
    }

    const boards = readJson("boards-v1", { activeId: null, boards: [] });
    const board = (boards.boards || []).find((item) => item.id === boards.activeId) || (boards.boards || [])[0];
    if (board) {
      board.name = state.where.trim() || board.name;
      board.destination = state.where.trim();
      if (state.start) board.dated = true;
      localStorage.setItem("boards-v1", JSON.stringify(boards));
    }

    const settings = readJson("trip-settings-v1", {});
    const adults = Math.max(0, Number(state.adults) || 0);
    const children = Math.max(0, Number(state.children) || 0);
    const count = [];
    if (adults) count.push(`${adults} adult${adults === 1 ? "" : "s"}`);
    if (children) count.push(`${children} child${children === 1 ? "" : "ren"}`);
    settings.destination = state.where.trim();
    settings.travellers = [count.join(" and "), state.details.trim()].filter(Boolean).join(". ");
    settings.tripType = state.tripType;
    localStorage.setItem("trip-settings-v1", JSON.stringify(settings));

    if (board && state.start) {
      const [year, month, day] = state.start.split("-").map(Number);
      const plan = readJson(`board:${board.id}:plan`, { days: [], items: {} });
      const days = Math.max(1, Math.min(21, Number(state.days) || 1));
      for (let i = 0; i < days; i++) {
        const date = new Date(year, month - 1, day + i);
        // Local date, not UTC: toISOString would shift the day backwards for
        // anyone west of Greenwich.
        const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
        if (!plan.days.some((item) => item.date === iso)) {
          plan.days.push({ id: `d-${Date.now()}-${i}`, date: iso, label: `Day ${plan.days.length + 1} · ${date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}` });
        }
      }
      plan.items = plan.items || {};
      localStorage.setItem(`board:${board.id}:plan`, JSON.stringify(plan));
    }

    close();
    // The trip just changed under the screens that were showing it. The title
    // comes from the board name and only board changes redraw it (app.js sets
    // it the same way in refreshForBoard), so it is written here too.
    if (board) {
      const title = document.getElementById("topbarTitle");
      if (title && board.name) title.textContent = board.name;
    }
    const planTab = document.querySelector('[data-view="itinerary"]');
    if (planTab) planTab.click();
    paintSetupRow();
  }

  function open(byHand) {
    openedByHand = !!byHand;
    state = openedByHand ? fromCurrentTrip() : blank();
    render();
  }

  // ---------- The way back to it ----------
  //
  // Only a new install used to be asked, which meant the questions were
  // invisible to anyone who already had a trip - the exact people who wanted
  // to answer them. This is the row that makes them reachable, and it says what
  // the app currently believes so the row is worth reading even if it is never
  // opened.

  function setupSummary() {
    const settings = readJson("trip-settings-v1", {});
    const where = String(settings.destination || "").trim();
    if (!where) return "Not set up yet — where, when and who";
    const parts = [where];
    const board = storedBoard();
    const plan = board ? readJson(`board:${board.id}:plan`, null) : null;
    const days = plan && Array.isArray(plan.days) ? plan.days.length : 0;
    if (days) parts.push(`${days} day${days === 1 ? "" : "s"}`);
    if (settings.travellers) parts.push(String(settings.travellers).split(". ")[0]);
    if (!parts.length) return "Where, when, who and what kind of trip";
    return parts.join(" · ");
  }

  function paintSetupRow() {
    const list = document.querySelector("#view .more-list");
    if (!list) return;
    const meta = setupSummary();
    const existing = list.querySelector("[data-onboarding-open]");
    if (existing) {
      // Only ever touch the DOM when the text has actually changed: this runs
      // from a mutation observer, and rewriting identical markup would mutate
      // the view again, which is a loop that starves the page of everything
      // else - including the test that was watching it.
      const line = existing.querySelector(".more-row-meta");
      if (line && line.textContent !== meta) line.textContent = meta;
      return;
    }
    const row = document.createElement("button");
    row.className = "more-row";
    row.setAttribute("data-onboarding-open", "1");
    row.innerHTML = `<span class="more-row-ico">${icon("pin", { size: 20 })}</span>
      <span class="more-row-main">
        <span class="more-row-title">Trip setup</span>
        <span class="more-row-meta">${esc(meta)}</span>
      </span>
      ${icon("forward", { size: 16, cls: "more-row-go" })}`;
    row.addEventListener("click", () => open(true));
    list.insertBefore(row, list.firstChild);
  }

  const view = document.getElementById("view");
  if (view) {
    // Every screen is drawn by app.js into #view, so the row is re-added when
    // the More screen is drawn rather than once at startup. Nothing is observed
    // on the overlay: that was the lifecycle that kept browser tests alive.
    new MutationObserver(paintSetupRow).observe(view, { childList: true, subtree: true });
    paintSetupRow();
  }

  // A door for the browser suite, in the spirit of app.js's __tripTest: the
  // More row is what a person uses, but a test that only finds the row cannot
  // tell "the row is there" from "the row works".
  window.__tripTest = window.__tripTest || {};
  window.__tripTest.openTripSetup = () => open(true);

  // app.js runs first and has already decided whether a new install needs the
  // questions. If it opened the sheet, take it over with the four-step version.
  if (overlay.classList.contains("open")) open(false);
})();
