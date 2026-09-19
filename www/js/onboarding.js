(function () {
  "use strict";

  const ONBOARDED_KEY = "onboarded-v1";
  const welcomeOverlay = document.getElementById("welcomeOverlay");
  if (!welcomeOverlay || localStorage.getItem(ONBOARDED_KEY)) return;

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
  let state = {
    step: 0,
    where: "",
    start: "",
    days: "",
    adults: "",
    children: "",
    details: "",
    whoPreset: "",
    tripType: "",
  };

  const esc = (value) => String(value == null ? "" : value).replace(/[&<>"'`]/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "`": "&#96;",
  }[c]));

  function canContinue() {
    if (state.step === 0) return !!state.where.trim();
    if (state.step === 1) return !!state.start && Number(state.days) >= 1;
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
      sub: "A start date and trip length give Today and your itinerary a useful shape. You can change them later.",
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
    welcomeOverlay.innerHTML = `<div class="welcome-body"><div class="welcome-dots">${[0, 1, 2, 3].map((i) => `<span class="welcome-dot${i === state.step ? " on" : ""}"></span>`).join("")}</div>
      <div class="welcome-kicker">${esc(step.kicker)}</div><h1 class="welcome-title">${esc(step.title)}</h1><p class="welcome-sub">${esc(step.sub)}</p>${step.body}</div>
      <div class="welcome-foot">${state.step > 0 ? '<button class="modal-btn" data-welcome-back="1">Back</button>' : '<button class="modal-btn" data-welcome-skip="1">Skip</button>'}
      <button class="modal-btn modal-btn-primary" data-welcome-next="1"${canContinue() ? "" : " disabled"}>${last ? "Start planning" : "Next"}</button></div>`;
    welcomeOverlay.classList.add("open");
    wire();
  }

  function updateFromInput() {
    readInputs();
    const next = welcomeOverlay.querySelector("[data-welcome-next]");
    if (next) next.disabled = !canContinue();
  }

  function wire() {
    welcomeOverlay.querySelectorAll("[data-welcome-where]").forEach((button) => button.addEventListener("click", () => {
      state.where = button.getAttribute("data-welcome-where");
      render();
    }));
    welcomeOverlay.querySelectorAll("[data-welcome-who]").forEach((button) => button.addEventListener("click", () => {
      const preset = WHO_OPTIONS.find((x) => x.label === button.getAttribute("data-welcome-who"));
      state.whoPreset = preset.label;
      state.adults = String(preset.adults);
      state.children = String(preset.children);
      render();
    }));
    welcomeOverlay.querySelectorAll("[data-welcome-trip-type]").forEach((button) => button.addEventListener("click", () => {
      state.tripType = button.getAttribute("data-welcome-trip-type");
      render();
    }));
    welcomeOverlay.querySelectorAll("input").forEach((input) => input.addEventListener("input", updateFromInput));
    const skip = welcomeOverlay.querySelector("[data-welcome-skip]");
    if (skip) skip.addEventListener("click", () => finish());
    const back = welcomeOverlay.querySelector("[data-welcome-back]");
    if (back) back.addEventListener("click", () => { readInputs(); state.step -= 1; render(); });
    const next = welcomeOverlay.querySelector("[data-welcome-next]");
    if (next) next.addEventListener("click", () => {
      readInputs();
      if (!canContinue()) return;
      if (state.step === 3) finish();
      else { state.step += 1; render(); }
    });
  }

  function finish() {
    localStorage.setItem(ONBOARDED_KEY, String(Date.now()));
    const boards = readJson("boards-v1", { activeId: null, boards: [] });
    const board = boards.boards.find((item) => item.id === boards.activeId) || boards.boards[0];
    if (board) {
      board.name = state.where.trim() || board.name;
      board.destination = state.where.trim();
      board.dated = true;
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
        const iso = date.toISOString().slice(0, 10);
        if (!plan.days.some((item) => item.date === iso)) {
          plan.days.push({ id: `d-${Date.now()}-${i}`, date: iso, label: `Day ${plan.days.length + 1} · ${date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}` });
        }
      }
      plan.items = plan.items || {};
      localStorage.setItem(`board:${board.id}:plan`, JSON.stringify(plan));
    }
    welcomeOverlay.classList.remove("open");
    welcomeOverlay.innerHTML = "";
    const planTab = document.querySelector('[data-view="itinerary"]');
    if (planTab) planTab.click();
  }

  function readJson(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key));
      return value == null ? fallback : value;
    } catch (e) {
      return fallback;
    }
  }

  function start() {
    if (!welcomeOverlay.classList.contains("open")) return;
    render();
  }

  start();
  const observer = new MutationObserver(start);
  observer.observe(welcomeOverlay, { attributes: true, attributeFilter: ["class"] });
})();
