// The budget: what this trip has committed you to.
//
// Was 400 lines in app.js mixing three things - working out the numbers,
// drawing them, and asking the model. The numbers and the question are pure
// functions here, tested in Node; the drawing is createBudgetScreen, which is
// handed what it needs rather than reaching for it. The same shape is how
// the other screens can follow.
import { esc } from "../lib/text.js";
import { extractJson } from "../lib/listings.js";
import { haversineKm, ROAD_FACTOR } from "../lib/geo.js";

export function budgetPrompt({ names, days, miles, who, destination }) {
  return (
    `Typical 2026 UK visitor costs, in pounds, for: ${who || "two adults"}.\n` +
    (destination ? `Destination: ${destination}. ` : "") +
    `Trip length: ${days || 1} day(s).` +
    (miles ? ` Roughly ${miles} miles of driving in total.` : "") +
    `\n\nFor each place listed below give the realistic total cost for this group to visit ` +
    `once - admission for everyone, or a typical spend if it is somewhere to eat or drink. ` +
    `Use 0 where entry is genuinely free. Give a low and a high, and keep the gap honest ` +
    `rather than wide for safety.\n\nPlaces:\n` +
    names.map((n) => `- ${n}`).join("\n") +
    `\n\nReply as JSON only:\n` +
    `{"places":[{"name":"exactly as listed","low":0,"high":0,"note":"a few words, e.g. free, or family ticket"}],` +
    `"foodPerDay":{"low":0,"high":0,"note":""},` +
    `"fuelTotal":{"low":0,"high":0,"note":""},` +
    `"stayPerNight":{"low":0,"high":0,"note":""}}\n` +
    `foodPerDay is for the whole group for one day, eating the way visitors normally do. ` +
    `fuelTotal covers the driving above for the whole trip. stayPerNight is a mid-range ` +
    `place for this group. No other text.`
  );
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export function normaliseBudget(raw) {
  const range = (r) => ({ low: num(r && r.low), high: Math.max(num(r && r.low), num(r && r.high)), note: (r && r.note) || "" });
  const places = {};
  (Array.isArray(raw && raw.places) ? raw.places : []).forEach((p) => {
    if (!p || !p.name) return;
    places[String(p.name).toLowerCase()] = range(p);
  });
  return {
    places,
    foodPerDay: range(raw && raw.foodPerDay),
    fuelTotal: range(raw && raw.fuelTotal),
    stayPerNight: range(raw && raw.stayPerNight),
    at: Date.now(),
  };
}

export function computeBudgetLines({ est, picks, plan, extras, pickCost, money }) {
  const nights = Math.max(0, plan.days.length - 1);

  const places = picks.map((p) => {
    const mine = pickCost(p);
    const guess = est && est.places[p.name.toLowerCase()];
    return {
      id: p.id,
      name: p.name,
      low: mine || (guess ? guess.low : 0),
      high: mine || (guess ? guess.high : 0),
      note: mine ? "your price" : guess ? guess.note : "",
      source: mine ? "yours" : guess ? "estimate" : "unknown",
    };
  });

  const trip = [];
  if (est) {
    if (plan.days.length && est.foodPerDay.high) {
      trip.push({
        key: "food",
        name: `Eating, ${plan.days.length} day${plan.days.length === 1 ? "" : "s"}`,
        low: est.foodPerDay.low * plan.days.length,
        high: est.foodPerDay.high * plan.days.length,
        note: est.foodPerDay.note || `${money(est.foodPerDay.low)}–${money(est.foodPerDay.high)} a day`,
        source: "estimate",
      });
    }
    if (est.fuelTotal.high) {
      trip.push({
        key: "fuel",
        name: "Getting about",
        low: est.fuelTotal.low,
        high: est.fuelTotal.high,
        note: est.miles ? `about ${est.miles} miles of driving in the plan` : est.fuelTotal.note,
        source: "estimate",
      });
    }
    if (nights && est.stayPerNight.high) {
      trip.push({
        key: "stay",
        name: `Somewhere to stay, ${nights} night${nights === 1 ? "" : "s"}`,
        low: est.stayPerNight.low * nights,
        high: est.stayPerNight.high * nights,
        note: est.stayPerNight.note || `${money(est.stayPerNight.low)}–${money(est.stayPerNight.high)} a night`,
        source: "estimate",
      });
    }
  }

  // An override on a trip-level line is stored as an ordinary extra with a
  // reserved name, so there is one place where "what you told us" lives.
  const overrides = {};
  extras.forEach((r) => {
    if (r.overrides) overrides[r.overrides] = Number(r.amount) || 0;
  });
  trip.forEach((line) => {
    if (overrides[line.key] !== undefined) {
      line.low = line.high = overrides[line.key];
      line.note = "your price";
      line.source = "yours";
    }
  });

  const own = extras.filter((r) => !r.overrides);
  return { places, trip, own, est };
}

// Assembles what the screen shows: every line, where its number came from,
// and whether you have overridden it. A price you typed always wins.
// "£1,240" for a family of five and "£1,240" for a couple are the same
// number and completely different facts. The app had one figure and no idea
// how many people it was for, so it could not say the second thing. A
// child's share is not an adult's - most of the difference is admission,
// where a child is roughly half - so the split is weighted rather than a
// straight division, and it says so.
export function splitLine({ people, isChild, low, high, money }) {
  if (people.length < 2) return "";
  const adults = people.filter((p) => !isChild(p)).length;
  const children = people.length - adults;
  const mid = (low + high) / 2;
  if (!mid) return "";
  // One share per adult, half a share per child.
  const shares = adults + children * 0.5;
  if (!shares) return "";
  const perAdult = Math.round(mid / shares);
  const bits = [`${money(perAdult)} an adult`];
  if (children) bits.push(`${money(Math.round(perAdult / 2))} a child`);
  return `<div class="budget-hero-split">${esc(bits.join(" · "))} <span class="budget-split-note">across ${
    people.length
  } of you</span></div>`;
}

export function createBudgetScreen(ctx) {
  const {
    view, storage, boardKey, activeBoard, loadPicks, loadPlan, loadPeople, isChild, pickCost, money,
    whoDescription, loadTripSettings, aiReady, callModel, toast, updatePick, daysAgoLabel,
    itemsInDayOrder, planItems,
  } = ctx;

  let working = false;
  let openLine = null;

  // Costs that aren't a place: trains, the flat, the car. Per board, because
  // a weekend in Portsmouth shouldn't inherit Scotland's ferry.
  function loadBudgetExtras() {
    const rows = storage.readJson(boardKey(activeBoard().id, "budget"), []);
    return Array.isArray(rows) ? rows : [];
  }

  function saveBudgetExtras(rows) {
    storage.write(boardKey(activeBoard().id, "budget"), JSON.stringify(rows));
  }

  // ---------- A budget that fills itself in ----------
  // It was a spreadsheet: one row per saved place, each with an empty number
  // box, plus a form for anything else. Nobody types a number into forty
  // boxes on a phone, so the screen showed £0 for ever and the tab was dead
  // weight.
  //
  // Everything on it is already knowable. The trip has days in it, the days
  // have places in them, the places have coordinates, and what a castle or a
  // pub lunch costs for a family is exactly the kind of ordinary fact the
  // model already has. So the app works it out, says out loud that it is an
  // estimate and where each number came from, and lets you correct any line -
  // at which point your number wins, permanently.
  function loadBudgetEstimate() {
    const e = storage.readJson(boardKey(activeBoard().id, "budget-est"), null);
    return e && typeof e === "object" ? e : null;
  }

  function saveBudgetEstimate(est) {
    storage.write(boardKey(activeBoard().id, "budget-est"), JSON.stringify(est));
  }

  // Miles you will actually drive, taken from the plan rather than guessed:
  // the legs between consecutive stops on each day, plus the same distance
  // back at the end of it, because you have to get home.
  function planDrivingMiles() {
    const plan = loadPlan();
    const byId = {};
    loadPicks().forEach((p) => (byId[p.id] = p));
    let km = 0;
    plan.days.forEach((d) => {
      const stops = itemsInDayOrder(planItems(plan, d.id))
        .map((it) => byId[it.pickId])
        .filter((p) => p && p.lat != null);
      for (let i = 1; i < stops.length; i++) {
        km += haversineKm(stops[i - 1].lat, stops[i - 1].lon, stops[i].lat, stops[i].lon) * ROAD_FACTOR;
      }
      if (stops.length > 1) {
        km += haversineKm(stops[0].lat, stops[0].lon, stops[stops.length - 1].lat, stops[stops.length - 1].lon) *
          ROAD_FACTOR;
      }
    });
    return Math.round(km * 0.621371);
  }

  function lines() {
    return computeBudgetLines({
      est: loadBudgetEstimate(),
      picks: loadPicks().filter((p) => !p.major),
      plan: loadPlan(),
      extras: loadBudgetExtras(),
      pickCost,
      money,
    });
  }

  async function estimate() {
    if (!aiReady()) {
      toast("Set up a model in Settings first");
      return;
    }
    const picks = loadPicks().filter((p) => !p.major);
    const days = loadPlan().days.length;
    const miles = planDrivingMiles();
    working = true;
    render();
    try {
      const { text } = await callModel(budgetPrompt({ names: picks.map((p) => p.name), days, miles, who: whoDescription(), destination: loadTripSettings().destination }), {
        json: true,
        maxTokens: 4096,
      });
      const parsed = extractJson(text);
      if (!parsed || typeof parsed !== "object") throw new Error("no usable answer");
      const est = normaliseBudget(parsed);
      est.days = days;
      est.miles = miles;
      saveBudgetEstimate(est);
      toast("Costed the trip");
    } catch (e) {
      toast(`Couldn't work it out — ${e && e.message ? e.message : "try again"}`);
    } finally {
      working = false;
      render();
    }
  }

  // ---------- Budget ----------
  // Was a fixed table of Scottish estimates that no board could edit and no
  // saved place appeared in. The real question is "what has this trip
  // committed me to", which only the places actually saved can answer - so
  // every place can carry a cost, and anything that isn't a place (trains,
  // the flat) goes in as its own line.
  function render() {
    const { places, trip, own, est } = lines();
    const priced = places.filter((l) => l.source !== "unknown");
    const unknown = places.filter((l) => l.source === "unknown");
    const ownTotal = own.reduce((a, r) => a + (Number(r.amount) || 0), 0);
    const low = priced.reduce((a, l) => a + l.low, 0) + trip.reduce((a, l) => a + l.low, 0) + ownTotal;
    const high = priced.reduce((a, l) => a + l.high, 0) + trip.reduce((a, l) => a + l.high, 0) + ownTotal;
    const days = loadPlan().days.length;

    // The number, said as a range, because a single figure to the penny would
    // be a more confident claim than anything here can support.
    let html = `
      <div class="card budget-hero">
        <div class="budget-hero-total">${low === high ? money(low) : `${money(low)}–${money(high)}`}</div>
        <div class="budget-hero-sub">${
          !est && !priced.length && !own.length
            ? "Nothing costed yet"
            : `${[
                places.length
                  ? `${priced.length} of ${places.length} place${places.length === 1 ? "" : "s"} costed`
                  : "",
                trip.length ? "food, travel and beds" : "",
                own.length ? `${own.length} of your own` : "",
              ]
                .filter(Boolean)
                .join(" · ")}${
                // The middle of the range, not the top of it: quoting the
                // worst case as "a day" makes every trip look unaffordable.
                days ? ` · around ${money(Math.round((low + high) / 2 / days))} a day` : ""
              }`
        }</div>
        ${splitLine({ people: loadPeople(), isChild, low, high, money })}
      </div>
    `;

    if (!est) {
      html += `
        <div class="card">
          <h2>Let it work the trip out</h2>
          <p>It reads the places you've saved, the days you've planned and the driving between
             them, then estimates what the lot comes to for ${esc(
               whoDescription() || "your group"
             )}. Every line says where its number came from, and you can correct any of them.</p>
          <button class="modal-btn modal-btn-primary" id="budgetEstimate" style="width:100%;margin-top:12px;">${
            working ? "Working it out…" : `${icon("sparkle", { size: 17, cls: "ico-inline" })} Cost my trip`
          }</button>
        </div>
      `;
    }

    // Tapping a line opens it for editing in place. No dialog: a browser
    // prompt() in a WebView is the app admitting it is a web page, which is
    // the whole thing we are trying to stop doing.
    const line = (l, kind, ref) => {
      const editing = openLine === `${kind}:${ref}`;
      if (editing) {
        return `
          <div class="budget-line editing">
            <span class="budget-line-main">
              <span class="budget-line-name">${esc(l.name)}</span>
              <span class="budget-line-note">Your price, or empty for the estimate</span>
            </span>
            <span class="budget-line-right">
              <span class="budget-input-wrap">
                <span class="budget-currency">£</span>
                <input class="budget-input" type="number" inputmode="decimal" min="0" step="1"
                       value="${l.source === "yours" ? esc(String(l.low)) : ""}"
                       data-budget-edit="${esc(kind)}|${esc(String(ref))}"
                       aria-label="Your price for ${esc(l.name)}" />
              </span>
            </span>
          </div>
        `;
      }
      return `
        <button class="budget-line" data-budget-open="${esc(kind)}|${esc(String(ref))}">
          <span class="budget-line-main">
            <span class="budget-line-name">${esc(l.name)}</span>
            ${l.note ? `<span class="budget-line-note">${esc(l.note)}</span>` : ""}
          </span>
          <span class="budget-line-right">
            <span class="budget-line-amount">${
              l.source === "unknown" ? "—" : l.low === l.high ? money(l.low) : `${money(l.low)}–${money(l.high)}`
            }</span>
            <span class="budget-tag ${l.source}">${
              l.source === "yours" ? "yours" : l.source === "estimate" ? "est." : "tap to price"
            }</span>
          </span>
        </button>
      `;
    };

    if (trip.length) {
      html += `<div class="section-label list-head"><span>The trip itself</span></div><div class="card budget-card">`;
      trip.forEach((l) => (html += line(l, "trip", l.key)));
      html += `</div>`;
    }

    if (places.length) {
      html += `<div class="section-label list-head"><span>Places</span><span class="list-head-count">${places.length}</span></div>`;
      html += `<div class="card budget-card">`;
      priced.forEach((l) => (html += line(l, "pick", l.id)));
      if (unknown.length) {
        html += `<div class="budget-unknown-head">${unknown.length} not costed</div>`;
        unknown.forEach((l) => (html += line(l, "pick", l.id)));
      }
      html += `</div>`;
      if (est) {
        html += `<button class="modal-btn" id="budgetEstimate" style="width:100%;">${
          working ? "Working it out…" : `${icon("refresh", { size: 16, cls: "ico-inline" })} Work it out again`
        }</button>`;
      }
    }

    html += `<div class="section-label list-head"><span>Anything else</span></div><div class="card budget-card">`;
    if (!own.length) {
      html += `<p class="pick-status">Ferries, a booking you've already paid for, whatever the app can't know about.</p>`;
    }
    own.forEach((r) => {
      const i = loadBudgetExtras().indexOf(r);
      html += `
        <div class="budget-row">
          <div class="budget-item">${esc(r.item)}</div>
          <div class="budget-input-wrap">
            <span class="budget-currency">£</span>
            <input class="budget-input" type="number" inputmode="decimal" min="0" step="1"
                   value="${esc(String(r.amount || ""))}" data-extra-amount="${i}" aria-label="Amount for ${esc(r.item)}" />
            <button class="budget-remove" data-extra-remove="${i}" aria-label="Remove ${esc(r.item)}">${icon("close", { size: 17 })}</button>
          </div>
        </div>
      `;
    });
    html += `
      <form class="budget-add" id="budgetAddForm">
        <input type="text" id="budgetAddItem" placeholder="e.g. ferry tickets" autocomplete="off" />
        <input type="number" id="budgetAddAmount" inputmode="decimal" min="0" step="1" placeholder="£" />
        <button type="submit" aria-label="Add cost">+</button>
      </form>
    </div>`;

    if (est) {
      html += `<p class="settings-hint">Estimated ${esc(
        daysAgoLabel(new Date(est.at))
      )} for ${esc(whoDescription() || "your group")}. Tap any line to put your own price on it.</p>`;
    }

    view.innerHTML = html;
    wire();
  }

  function wire() {
    const estimateBtn = document.getElementById("budgetEstimate");
    if (estimateBtn) estimateBtn.addEventListener("click", () => estimate());

    // Tapping a line opens it; what you type there outranks anything
    // estimated, for that line only, and for good.
    view.querySelectorAll("[data-budget-open]").forEach((btn) =>
      btn.addEventListener("click", () => {
        openLine = btn.getAttribute("data-budget-open").replace("|", ":");
        render();
        const input = view.querySelector("[data-budget-edit]");
        if (input) input.focus();
      })
    );

    view.querySelectorAll("[data-budget-edit]").forEach((input) => {
      const commit = () => {
        const [kind, ref] = input.getAttribute("data-budget-edit").split("|");
        const value = input.value.trim();
        if (kind === "pick") {
          updatePick(ref, { cost: value === "" ? null : Number(value) });
        } else {
          const rows = loadBudgetExtras().filter((r) => r.overrides !== ref);
          if (value !== "") {
            const label = (lines().trip.find((l) => l.key === ref) || {}).name || ref;
            rows.push({ item: label, amount: Number(value) || 0, overrides: ref });
          }
          saveBudgetExtras(rows);
        }
        openLine = null;
        render();
      };
      input.addEventListener("blur", commit);
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); input.blur(); }
        if (e.key === "Escape") { openLine = null; render(); }
      });
    });

    view.querySelectorAll("[data-extra-amount]").forEach((input) => {
      input.addEventListener("blur", () => {
        const rows = loadBudgetExtras();
        const i = Number(input.getAttribute("data-extra-amount"));
        if (!rows[i]) return;
        rows[i].amount = Number(input.value) || 0;
        saveBudgetExtras(rows);
        render();
      });
    });

    view.querySelectorAll("[data-extra-remove]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const rows = loadBudgetExtras();
        rows.splice(Number(btn.getAttribute("data-extra-remove")), 1);
        saveBudgetExtras(rows);
        render();
      });
    });

    const addForm = document.getElementById("budgetAddForm");
    if (addForm) {
      addForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const item = document.getElementById("budgetAddItem").value.trim();
        const amount = Number(document.getElementById("budgetAddAmount").value) || 0;
        if (!item) return;
        const rows = loadBudgetExtras();
        rows.push({ item, amount });
        saveBudgetExtras(rows);
        render();
      });
    }
  }

  return { render, lines };
}
