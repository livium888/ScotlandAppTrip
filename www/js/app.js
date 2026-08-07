(function () {
  "use strict";

  const view = document.getElementById("view");
  const tabbar = document.getElementById("tabbar");
  const topbarTitle = document.getElementById("topbarTitle");
  const topbarSub = document.getElementById("topbarSub");

  const STORAGE_KEY = "scotland-trip-packing-v1";

  function esc(s) {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  function cityColor(city) {
    return CITY_COLORS[city] || CITY_COLORS.Travel;
  }

  function mapsUrlFor(mapsQuery) {
    return mapsQuery
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapsQuery)}`
      : null;
  }

  function findPlace(name) {
    return PLACES.find((p) => p.name === name) || EATS.find((e) => e.name === name);
  }

  // ---------- Place detail modal ----------

  const placeModal = document.getElementById("placeModal");

  function openPlaceModal(name) {
    const p = findPlace(name);
    if (!p) return;
    const mapsUrl = mapsUrlFor(p.mapsQuery);
    const subtitle = [p.category || p.meal, p.area].filter(Boolean).join(" · ");

    placeModal.innerHTML = `
      <div class="modal-backdrop" data-close="1">
        <div class="modal-sheet" role="dialog" aria-label="${esc(p.name)}">
          <div class="modal-handle"></div>
          <button class="modal-close" data-close="1" aria-label="Close">✕</button>
          <div class="modal-body">
            <span class="pill" style="background:${cityColor(p.city)}">${esc(p.city)}</span>
            <h2 class="modal-title">${esc(p.name)}</h2>
            ${subtitle ? `<div class="modal-subtitle">${esc(subtitle)}</div>` : ""}
            <div class="modal-price">${esc(p.price)}</div>
            ${
              p.nearAttraction
                ? `<div class="place-distance">📍 ${esc(p.distance)} — near ${esc(p.nearAttraction)}</div>`
                : ""
            }
            <p class="modal-notes">${esc(p.notes)}</p>
            <div class="modal-actions">
              ${
                p.website
                  ? `<a class="modal-btn" href="${esc(p.website)}" target="_blank" rel="noopener">🌐 Official website</a>`
                  : ""
              }
              ${
                mapsUrl
                  ? `<a class="modal-btn modal-btn-primary" href="${mapsUrl}" target="_blank" rel="noopener">📍 Open in Google Maps</a>`
                  : ""
              }
            </div>
          </div>
        </div>
      </div>
    `;
    placeModal.classList.add("open");
    placeModal.querySelectorAll("[data-close]").forEach((el) => {
      el.addEventListener("click", (e) => {
        if (e.target === el) closePlaceModal();
      });
    });
  }

  function closePlaceModal() {
    placeModal.classList.remove("open");
  }

  // ---------- Views ----------

  function renderOverview() {
    const totalLow = BUDGET.reduce((a, b) => a + b.low, 0);
    const totalHigh = BUDGET.reduce((a, b) => a + b.high, 0);
    const cities = ["Edinburgh", "Stirling", "Glasgow"];

    let html = `
      <div class="hero">
        <h1>${esc(TRIP.title)}</h1>
        <p>${esc(TRIP.subtitle)}</p>
        <div class="hero-stats">
          <div class="hero-stat"><b>${TRIP.nights}</b><span>nights</span></div>
          <div class="hero-stat"><b>${DAYS.length}</b><span>days planned</span></div>
          <div class="hero-stat"><b>3</b><span>cities</span></div>
        </div>
      </div>

      <div class="section-label">Trip at a glance</div>
      <div class="card">
        <p>${esc(TRIP.traveler)}. Peak Fringe/festival week in Edinburgh (7–31 Aug), so this plan
        mixes gentle festival mornings with day trips to Stirling and Glasgow — especially over
        the 22–23 Aug weekend, when Edinburgh's Old Town is at its most crowded.</p>
      </div>

      <div class="section-label">Cities</div>
    `;

    cities.forEach((c) => {
      const count = DAYS.filter((d) => d.city === c).length;
      html += `
        <div class="card" style="display:flex;align-items:center;justify-content:space-between;">
          <div>
            <span class="pill" style="background:${cityColor(c)}">${esc(c)}</span>
          </div>
          <div style="font-size:13px;color:var(--ink-soft);">${count} day${count === 1 ? "" : "s"}</div>
        </div>
      `;
    });

    html += `
      <div class="section-label">Estimated budget</div>
      <div class="card">
        <p style="margin-bottom:4px;">Activities, tickets &amp; transport for the week (excl. accommodation)</p>
        <div class="budget-total" style="border-top:none;padding-top:8px;">
          <b>Total estimate</b>
          <span class="budget-range">£${totalLow}–£${totalHigh}</span>
        </div>
      </div>
    `;

    view.innerHTML = html;
  }

  function renderItinerary() {
    let html = "";
    DAYS.forEach((d, i) => {
      html += `
        <div class="card day-card" data-idx="${i}">
          <div class="day-head" data-toggle="${i}">
            <div class="day-head-left">
              <span class="pill" style="background:${cityColor(d.city)}">${esc(d.city)}</span>
              <span class="day-title">${esc(d.title)}</span>
              <span class="day-date">${esc(d.day)} · ${esc(d.date)}</span>
            </div>
            <span class="chevron">▶</span>
          </div>
          <div class="day-summary">${esc(d.summary)}</div>
          <div class="day-items">
            ${d.items
              .map(
                (it) => `
              <div class="item${it.place ? " item-linked" : ""}"${
                  it.place ? ` data-place="${esc(it.place)}"` : ""
                }>
                <div class="item-time">${esc(it.time)}</div>
                <div class="item-body">
                  <div class="item-name">${esc(it.name)}${it.place ? ' <span class="item-arrow">›</span>' : ""}</div>
                  <div class="item-detail">${esc(it.detail)}</div>
                  <span class="item-tag">${esc(it.tag)}</span>
                </div>
              </div>
            `
              )
              .join("")}
          </div>
        </div>
      `;
    });
    view.innerHTML = html;

    view.querySelectorAll("[data-toggle]").forEach((el) => {
      el.addEventListener("click", () => {
        el.closest(".day-card").classList.toggle("open");
      });
    });

    view.querySelectorAll("[data-place]").forEach((el) => {
      el.addEventListener("click", () => {
        openPlaceModal(el.getAttribute("data-place"));
      });
    });

    // open first day by default
    const first = view.querySelector(".day-card");
    if (first) first.classList.add("open");
  }

  let placeFilter = "All";

  function renderPlaces() {
    const cities = ["All", "Edinburgh", "Stirling", "Glasgow"];
    let html = `<div class="filter-row">`;
    cities.forEach((c) => {
      html += `<button class="filter-chip ${c === placeFilter ? "active" : ""}" data-city="${esc(c)}">${esc(c)}</button>`;
    });
    html += `</div>`;

    const list = PLACES.filter((p) => placeFilter === "All" || p.city === placeFilter);

    list.forEach((p) => {
      const mapsUrl = p.mapsQuery
        ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.mapsQuery)}`
        : null;
      html += `
        <div class="card place-card">
          <div style="flex:1;">
            <div class="place-name">${esc(p.name)}</div>
            <div class="place-meta">
              <span class="pill" style="background:${cityColor(p.city)}">${esc(p.city)}</span>${esc(p.category)}
            </div>
            <div class="place-notes">${esc(p.notes)}</div>
            <div class="place-links">
              ${p.website ? `<a href="${esc(p.website)}" target="_blank" rel="noopener">🌐 Website</a>` : ""}
              ${mapsUrl ? `<a href="${mapsUrl}" target="_blank" rel="noopener">📍 Map</a>` : ""}
            </div>
          </div>
          <div class="place-price">${esc(p.price)}</div>
        </div>
      `;
    });

    view.innerHTML = html;

    view.querySelectorAll("[data-city]").forEach((btn) => {
      btn.addEventListener("click", () => {
        placeFilter = btn.getAttribute("data-city");
        renderPlaces();
      });
    });
  }

  let eatsFilter = "All";

  function renderEats() {
    const cities = ["All", "Edinburgh", "Stirling", "Glasgow"];
    let html = `<div class="filter-row">`;
    cities.forEach((c) => {
      html += `<button class="filter-chip ${c === eatsFilter ? "active" : ""}" data-city="${esc(c)}">${esc(c)}</button>`;
    });
    html += `</div>`;

    html += `
      <div class="card">
        <p>Independent, well-reviewed picks near each stop — not fast-food chains, not fine-dining prices.
        £ = casual/cheap, ££ = mid-range, £££ = a step up but still no white tablecloths.</p>
      </div>
    `;

    const list = EATS.filter((e) => eatsFilter === "All" || e.city === eatsFilter);

    list.forEach((e) => {
      const mapsUrl = e.mapsQuery
        ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(e.mapsQuery)}`
        : null;
      html += `
        <div class="card place-card">
          <div style="flex:1;">
            <div class="place-name">${esc(e.name)}</div>
            <div class="place-meta">
              <span class="pill" style="background:${cityColor(e.city)}">${esc(e.city)}</span>${esc(e.area)} · ${esc(e.meal)}
            </div>
            ${
              e.nearAttraction
                ? `<div class="place-distance">📍 ${esc(e.distance)} — near ${esc(e.nearAttraction)}</div>`
                : ""
            }
            <div class="place-notes">${esc(e.notes)}</div>
            <div class="place-links">
              ${e.website ? `<a href="${esc(e.website)}" target="_blank" rel="noopener">🌐 Website</a>` : ""}
              ${mapsUrl ? `<a href="${mapsUrl}" target="_blank" rel="noopener">📍 Map</a>` : ""}
            </div>
          </div>
          <div class="place-price">${esc(e.price)}</div>
        </div>
      `;
    });

    view.innerHTML = html;

    view.querySelectorAll("[data-city]").forEach((btn) => {
      btn.addEventListener("click", () => {
        eatsFilter = btn.getAttribute("data-city");
        renderEats();
      });
    });
  }

  function renderBudget() {
    const totalLow = BUDGET.reduce((a, b) => a + b.low, 0);
    const totalHigh = BUDGET.reduce((a, b) => a + b.high, 0);

    let html = `<div class="card">`;
    BUDGET.forEach((b) => {
      const range = b.low === b.high ? (b.low === 0 ? "Free" : `£${b.low}`) : `£${b.low}–£${b.high}`;
      html += `
        <div class="budget-row">
          <div class="budget-item">${esc(b.item)}</div>
          <div class="budget-range">${range}</div>
        </div>
      `;
    });
    html += `
      <div class="budget-total">
        <b>Total (week)</b>
        <span class="budget-range">£${totalLow}–£${totalHigh}</span>
      </div>
    </div>`;

    html += `
      <div class="section-label">Notes</div>
      <div class="card">
        <p>Ranges reflect optional items (Wallace Monument climb, Glasgow Science Centre, Zoo, Camera Obscura) —
        skip any of them and the week can cost well under £200. Museums, parks and beaches used in this plan
        (National Museum of Scotland, Botanic Garden, Kelvingrove, Portobello, Cramond) are free.</p>
      </div>
    `;

    view.innerHTML = html;
  }

  function loadChecked() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    } catch (e) {
      return {};
    }
  }

  function saveChecked(state) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function renderTips() {
    let html = `<div class="section-label">Good to know</div>`;
    TIPS.forEach((t) => {
      html += `
        <div class="card tip-card">
          <h2>${esc(t.title)}</h2>
          <p>${esc(t.body)}</p>
        </div>
      `;
    });

    const checked = loadChecked();
    html += `<div class="section-label">Packing list</div>`;
    html += `<div class="card"><ul class="packing-list">`;
    PACKING.forEach((p, i) => {
      const isChecked = !!checked[i];
      html += `<li data-i="${i}" class="${isChecked ? "checked" : ""}">${esc(p)}</li>`;
    });
    html += `</ul></div>`;

    view.innerHTML = html;

    view.querySelectorAll(".packing-list li").forEach((li) => {
      li.addEventListener("click", () => {
        const i = li.getAttribute("data-i");
        const state = loadChecked();
        state[i] = !state[i];
        saveChecked(state);
        li.classList.toggle("checked");
      });
    });
  }

  const VIEWS = {
    overview: { render: renderOverview, sub: TRIP.dates },
    itinerary: { render: renderItinerary, sub: "Tap a day to expand" },
    places: { render: renderPlaces, sub: "Edinburgh · Stirling · Glasgow" },
    eats: { render: renderEats, sub: "Lunch & dinner picks, kid-friendly" },
    budget: { render: renderBudget, sub: "Estimated activity costs" },
    tips: { render: renderTips, sub: "Walking, weather, safety & packing" },
  };

  function showView(name) {
    const v = VIEWS[name];
    if (!v) return;
    v.render();
    topbarSub.textContent = v.sub;
    tabbar.querySelectorAll(".tab").forEach((t) => {
      t.classList.toggle("active", t.getAttribute("data-view") === name);
    });
    view.scrollTop = 0;
  }

  tabbar.querySelectorAll(".tab").forEach((t) => {
    t.addEventListener("click", () => showView(t.getAttribute("data-view")));
  });

  topbarTitle.textContent = TRIP.title;
  showView("overview");
})();
