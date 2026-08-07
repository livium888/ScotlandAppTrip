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

  // A raw "lat,lon" query just drops an unlabelled pin - no name, reviews,
  // hours, or photos attached. Searching by name (+ city for disambiguation)
  // resolves to the actual place listing instead, so always prefer that.
  function pickMapsQuery(p) {
    // Deliberately never falls back to p.city (the folder) - that's pure
    // organisation, not geography, and baking it into the search text can
    // send Maps looking in the wrong place entirely.
    return p.mapsQuery || `${p.name}, Scotland`;
  }

  function findPlace(name) {
    return PLACES.find((p) => p.name === name) || EATS.find((e) => e.name === name);
  }

  function goToMapsSearch(query) {
    const q = (query || "").trim();
    if (!q) return;
    window.open(mapsUrlFor(q), "_blank", "noopener");
  }

  function wireSearchBar(formId, inputId, buildQuery) {
    const form = document.getElementById(formId);
    if (!form) return;
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const raw = document.getElementById(inputId).value;
      if (!raw.trim()) return;
      goToMapsSearch(buildQuery ? buildQuery(raw) : raw);
    });
  }

  // ---------- Picks (bookmarks + custom places) ----------

  const PICKS_KEY = "scotland-trip-picks-v1";

  function loadPicks() {
    try {
      return JSON.parse(localStorage.getItem(PICKS_KEY) || "[]");
    } catch (e) {
      return [];
    }
  }

  function savePicks(picks) {
    localStorage.setItem(PICKS_KEY, JSON.stringify(picks));
  }

  // Folders are user-owned organisation, separate from geography - a pick's
  // folder should never be baked into its Google Maps search query, since a
  // rough nearest-city guess (or a folder the user deliberately renamed)
  // being injected into the search text can make Maps return the wrong place.
  const FOLDERS_KEY = "scotland-trip-folders-v1";

  function loadFolders() {
    try {
      const f = JSON.parse(localStorage.getItem(FOLDERS_KEY));
      return Array.isArray(f) && f.length ? f : ["Edinburgh", "Stirling", "Glasgow"];
    } catch (e) {
      return ["Edinburgh", "Stirling", "Glasgow"];
    }
  }

  function saveFolders(folders) {
    localStorage.setItem(FOLDERS_KEY, JSON.stringify(folders));
  }

  function addFolder(name) {
    const trimmed = (name || "").trim();
    if (!trimmed) return null;
    const folders = loadFolders();
    if (!folders.includes(trimmed)) {
      folders.push(trimmed);
      saveFolders(folders);
    }
    return trimmed;
  }

  function pickId(source, name) {
    return `${source}:${name}`;
  }

  function isPicked(source, name) {
    return loadPicks().some((p) => p.id === pickId(source, name));
  }

  function haversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function nearestCity(lat, lon) {
    let best = null;
    let bestDist = Infinity;
    Object.keys(CITY_COORDS).forEach((city) => {
      const c = CITY_COORDS[city];
      const d = haversineKm(lat, lon, c.lat, c.lon);
      if (d < bestDist) {
        bestDist = d;
        best = city;
      }
    });
    return best;
  }

  function togglePick(source, item) {
    const id = pickId(source, item.name);
    let picks = loadPicks();
    const existing = picks.find((p) => p.id === id);
    if (existing) {
      picks = picks.filter((p) => p.id !== id);
      savePicks(picks);
      return;
    }
    const pick = {
      id,
      source,
      name: item.name,
      city: item.city || null,
      category: item.category || item.meal || "Custom",
      notes: item.notes || "",
      description: "",
      website: item.website || "",
      mapsQuery: item.mapsQuery || item.name,
      lat: null,
      lon: null,
      enrichStatus: item.website ? "done" : "idle",
      addedAt: Date.now(),
    };
    picks.push(pick);
    savePicks(picks);
    if (pick.enrichStatus === "idle") {
      enrichPick(pick.id); // full enrich: geocode + Wikipedia (custom/no-website items)
    } else {
      ensureGeocoded(pick.id); // already has a website/notes - just fetch coordinates for the map
    }
  }

  // Bookmarked catalog items (Places/Eats) already have good website/notes,
  // so enrichPick() is skipped for them - but the map and "explore nearby"
  // still need coordinates, so fetch those quietly without touching the
  // existing description/website.
  async function ensureGeocoded(id) {
    let picks = loadPicks();
    const pick = picks.find((p) => p.id === id);
    if (!pick || pick.lat != null) return;
    try {
      const geo = await geocodePlace(pick.name, pick.city);
      picks = loadPicks();
      const fresh = picks.find((p) => p.id === id);
      if (!fresh || fresh.lat != null || !geo) return;
      fresh.lat = geo.lat;
      fresh.lon = geo.lon;
      if (!fresh.city) fresh.city = nearestCity(geo.lat, geo.lon);
      savePicks(picks);
      if (view.dataset.activeTab === "picks") renderPicks();
    } catch (e) {
      // best-effort - the pick just won't get a mini-map/nearby search
    }
  }

  function removePick(id) {
    savePicks(loadPicks().filter((p) => p.id !== id));
  }

  // Manually overrides the auto-assigned (nearest-city) grouping - e.g. to
  // pull something out of Edinburgh into a general "Other" bucket instead.
  function setPickCity(id, city) {
    const picks = loadPicks();
    const p = picks.find((x) => x.id === id);
    if (!p) return;
    p.city = city;
    savePicks(picks);
  }

  function wirePickToggles(rerender) {
    view.querySelectorAll("[data-toggle-pick]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const source = btn.getAttribute("data-toggle-pick");
        const name = btn.getAttribute("data-name");
        const item = source === "places" ? PLACES.find((p) => p.name === name) : EATS.find((e) => e.name === name);
        if (!item) return;
        togglePick(source, item);
        rerender();
      });
    });
  }

  // Free, no-API-key enrichment: Nominatim (OpenStreetMap) for coordinates
  // and a fallback website, Wikidata + Wikipedia for a real description and
  // confirmed official website. Best-effort - failures just leave the pick
  // as-is rather than blocking anything.
  async function geocodePlace(name, cityHint) {
    const q = cityHint ? `${name}, ${cityHint}, Scotland` : `${name}, Scotland`;
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&addressdetails=0&extratags=1&q=${encodeURIComponent(q)}`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error("nominatim error");
    const data = await res.json();
    if (!data.length) return null;
    const r = data[0];
    return {
      lat: parseFloat(r.lat),
      lon: parseFloat(r.lon),
      website: (r.extratags && r.extratags.website) || null,
    };
  }

  async function wikiEnrich(name) {
    const searchUrl = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(
      name
    )}&language=en&format=json&origin=*`;
    const searchRes = await fetch(searchUrl);
    if (!searchRes.ok) throw new Error("wikidata search error");
    const searchData = await searchRes.json();
    const hit = searchData.search && searchData.search[0];
    if (!hit) return null;

    let website = null;
    try {
      const entUrl = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${hit.id}&props=claims&format=json&origin=*`;
      const entRes = await fetch(entUrl);
      const entData = await entRes.json();
      const claims = entData.entities[hit.id].claims;
      const p856 = claims && claims.P856;
      if (p856 && p856[0] && p856[0].mainsnak && p856[0].mainsnak.datavalue) {
        website = p856[0].mainsnak.datavalue.value;
      }
    } catch (e) {
      // no official-website claim available - not fatal
    }

    let description = hit.description || null;
    try {
      const title = (hit.label || name).replace(/ /g, "_");
      const sumRes = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`);
      if (sumRes.ok) {
        const sum = await sumRes.json();
        if (sum.extract) description = sum.extract;
      }
    } catch (e) {
      // no Wikipedia page - Wikidata's short description is still fine
    }

    return { description, website };
  }

  async function enrichPick(id) {
    let picks = loadPicks();
    const pick = picks.find((p) => p.id === id);
    if (!pick) return;
    pick.enrichStatus = "loading";
    savePicks(picks);
    if (view.dataset.activeTab === "picks") renderPicks();

    const [geo, wiki] = await Promise.all([
      geocodePlace(pick.name, pick.city).catch(() => null),
      wikiEnrich(pick.name).catch(() => null),
    ]);

    picks = loadPicks();
    const fresh = picks.find((p) => p.id === id);
    if (!fresh) return; // removed while enriching
    if (geo) {
      fresh.lat = geo.lat;
      fresh.lon = geo.lon;
      if (!fresh.website && geo.website) fresh.website = geo.website;
      if (!fresh.city) fresh.city = nearestCity(geo.lat, geo.lon);
    }
    if (wiki) {
      if (wiki.description) fresh.description = wiki.description;
      if (!fresh.website && wiki.website) fresh.website = wiki.website;
    }
    fresh.enrichStatus = geo || wiki ? "done" : "empty";
    savePicks(picks);
    if (view.dataset.activeTab === "picks") renderPicks();
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

  // Asks which folder a new pick should go in - existing folders as chips,
  // or type a new one to create it on the spot. onConfirm(folder) fires once
  // the user picks or creates one; the sheet closes either way.
  function openFolderPicker(candidateName, suggestedFolder, onConfirm) {
    const folders = loadFolders();

    placeModal.innerHTML = `
      <div class="modal-backdrop" data-close="1">
        <div class="modal-sheet" role="dialog" aria-label="Choose a folder">
          <div class="modal-handle"></div>
          <button class="modal-close" data-close="1" aria-label="Close">✕</button>
          <div class="modal-body">
            <h2 class="modal-title">Add "${esc(candidateName)}" to…</h2>
            <div class="filter-row" id="folderChips">
              ${folders
                .map(
                  (f) =>
                    `<button class="filter-chip${f === suggestedFolder ? " active" : ""}" data-pick-folder="${esc(f)}">${esc(f)}</button>`
                )
                .join("")}
            </div>
            <form class="search-bar" id="newFolderForm" style="margin-top:4px;">
              <input type="text" id="newFolderInput" placeholder="Or create a new folder…" autocomplete="off" />
              <button type="submit" aria-label="Create folder">+</button>
            </form>
          </div>
        </div>
      </div>
    `;
    placeModal.classList.add("open");

    const finalize = (folder) => {
      closePlaceModal();
      onConfirm(folder);
    };

    placeModal.querySelectorAll("[data-close]").forEach((el) => {
      el.addEventListener("click", (e) => {
        if (e.target === el) closePlaceModal();
      });
    });
    placeModal.querySelectorAll("[data-pick-folder]").forEach((btn) => {
      btn.addEventListener("click", () => finalize(btn.getAttribute("data-pick-folder")));
    });
    document.getElementById("newFolderForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const name = document.getElementById("newFolderInput").value.trim();
      if (!name) return;
      finalize(addFolder(name));
    });
  }

  // ---------- Sharing ----------

  function formatDayShareText(day) {
    const lines = [];
    lines.push(`🏴 Scotland with Ally — ${day.day}, ${day.date}`);
    lines.push(`${day.city} — ${day.title}`);
    lines.push("");
    lines.push(day.summary);
    lines.push("");
    day.items.forEach((it) => {
      lines.push(`${it.time} — ${it.name}`);
      lines.push(it.detail);
      const p = it.place ? findPlace(it.place) : null;
      if (p && p.website) lines.push(`🌐 ${p.website}`);
      if (p && p.mapsQuery) lines.push(`📍 ${mapsUrlFor(p.mapsQuery)}`);
      lines.push("");
    });
    return lines.join("\n").trim();
  }

  function formatFullItineraryShareText() {
    const lines = [`🏴 ${TRIP.title}`, TRIP.subtitle, TRIP.dates, ""];
    DAYS.forEach((d) => {
      lines.push(`— ${d.day}, ${d.date} (${d.city}) —`);
      lines.push(d.title);
      d.items.forEach((it) => lines.push(`  ${it.time} ${it.name}`));
      lines.push("");
    });
    return lines.join("\n").trim();
  }

  async function shareText(title, text) {
    const plugins = window.Capacitor && window.Capacitor.Plugins;
    if (plugins && plugins.Share) {
      try {
        await plugins.Share.share({ title, text, dialogTitle: title });
        return;
      } catch (e) {
        if (e && e.message === "Share canceled") return;
        // fall through to web fallbacks below
      }
    }
    if (navigator.share) {
      try {
        await navigator.share({ title, text });
        return;
      } catch (e) {
        if (e && e.name === "AbortError") return;
      }
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        toast("Copied to clipboard — paste it into WhatsApp");
        return;
      } catch (e) {
        // fall through
      }
    }
    window.prompt("Copy this to share:", text);
  }

  let toastTimer = null;
  function toast(message) {
    let el = document.getElementById("toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "toast";
      el.className = "toast";
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2400);
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
        <button class="hero-share" id="shareTrip">↗ Share whole itinerary</button>
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

    const shareBtn = document.getElementById("shareTrip");
    if (shareBtn) {
      shareBtn.addEventListener("click", () => {
        shareText(TRIP.title, formatFullItineraryShareText());
      });
    }
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
            <button class="day-share" data-share-day="${i}">↗ Share this day</button>
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

    view.querySelectorAll("[data-share-day]").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        const d = DAYS[Number(el.getAttribute("data-share-day"))];
        shareText(`${d.day}: ${d.title}`, formatDayShareText(d));
      });
    });

    // open first day by default
    const first = view.querySelector(".day-card");
    if (first) first.classList.add("open");
  }

  let placeFilter = "All";

  function renderPlaces() {
    let html = `
      <form class="search-bar" id="placesSearchForm">
        <input type="search" id="placesSearchInput" placeholder="Search any other place or attraction…" autocomplete="off" />
        <button type="submit" aria-label="Search on Google Maps">🔍</button>
      </form>
      <p class="search-hint">Opens Google Maps — browse it there for nearby restaurants, reviews, and the official website.</p>
    `;

    const cities = ["All", "Edinburgh", "Stirling", "Glasgow"];
    html += `<div class="filter-row">`;
    cities.forEach((c) => {
      html += `<button class="filter-chip ${c === placeFilter ? "active" : ""}" data-city="${esc(c)}">${esc(c)}</button>`;
    });
    html += `</div>`;

    const list = PLACES.filter((p) => placeFilter === "All" || p.city === placeFilter);

    list.forEach((p) => {
      const mapsUrl = mapsUrlFor(p.mapsQuery);
      const picked = isPicked("places", p.name);
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
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:8px;">
            <button class="pick-toggle${picked ? " picked" : ""}" data-toggle-pick="places" data-name="${esc(p.name)}" aria-label="Bookmark">${picked ? "♥" : "♡"}</button>
            <div class="place-price">${esc(p.price)}</div>
          </div>
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

    wirePickToggles(renderPlaces);
    wireSearchBar("placesSearchForm", "placesSearchInput");
  }

  let eatsFilter = "All";

  function renderEats() {
    let html = `
      <form class="search-bar" id="eatsSearchForm">
        <input type="search" id="eatsSearchInput" placeholder="Search restaurants near…" autocomplete="off" />
        <button type="submit" aria-label="Search restaurants on Google Maps">🔍</button>
      </form>
      <p class="search-hint">Opens Google Maps already searching "restaurants near" wherever you type.</p>
    `;

    const cities = ["All", "Edinburgh", "Stirling", "Glasgow"];
    html += `<div class="filter-row">`;
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
      const mapsUrl = mapsUrlFor(e.mapsQuery);
      const picked = isPicked("eats", e.name);
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
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:8px;">
            <button class="pick-toggle${picked ? " picked" : ""}" data-toggle-pick="eats" data-name="${esc(e.name)}" aria-label="Bookmark">${picked ? "♥" : "♡"}</button>
            <div class="place-price">${esc(e.price)}</div>
          </div>
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

    wirePickToggles(renderEats);
    wireSearchBar("eatsSearchForm", "eatsSearchInput", (raw) => `restaurants near ${raw}`);
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
        <p>Ranges reflect optional items (Wallace Monument climb, Glasgow Science Centre, Zoo) —
        skip any of them and the trip can cost well under £200. Museums, parks and beaches used in this plan
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

  // ---------- Explore nearby (Overpass / OpenStreetMap) ----------

  const NEARBY_CATEGORIES = [
    { key: "restaurant", label: "Restaurants", icon: "🍽️", tag: "amenity", value: "restaurant" },
    { key: "cafe", label: "Cafes", icon: "☕", tag: "amenity", value: "cafe" },
    { key: "parking", label: "Car parks", icon: "🅿️", tag: "amenity", value: "parking" },
    { key: "museum", label: "Museums", icon: "🏛️", tag: "tourism", value: "museum" },
    { key: "playground", label: "Playgrounds", icon: "🛝", tag: "leisure", value: "playground" },
    { key: "toilets", label: "Toilets", icon: "🚻", tag: "amenity", value: "toilets" },
    { key: "pharmacy", label: "Pharmacies", icon: "💊", tag: "amenity", value: "pharmacy" },
    { key: "supermarket", label: "Supermarkets", icon: "🛒", tag: "shop", value: "supermarket" },
  ];

  function catLabel(key) {
    const c = NEARBY_CATEGORIES.find((x) => x.key === key);
    return c ? c.label : "Places";
  }

  function nearbyMapElId(pickId) {
    return "nearbymap-" + pickId.replace(/[^a-zA-Z0-9]/g, "_");
  }

  // Overpass (OpenStreetMap's "find everything of type X near here" API) -
  // free, no key, same OSM data Nominatim and the tile layer already use.
  // The free public Overpass instance (overpass-api.de) is shared community
  // infrastructure and can be slow, rate-limited, or briefly down. Fall
  // through a couple of mirror servers before giving up.
  const OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.openstreetmap.ru/api/interpreter",
  ];

  async function overpassNearby(lat, lon, cat, radius) {
    radius = radius || 1200;
    const filter = `["${cat.tag}"="${cat.value}"]`;
    const q = `[out:json][timeout:20];(node${filter}(around:${radius},${lat},${lon});way${filter}(around:${radius},${lat},${lon}););out center 25;`;

    let lastError = null;
    let data = null;
    for (const endpoint of OVERPASS_ENDPOINTS) {
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          body: q,
          headers: { "Content-Type": "text/plain" },
        });
        if (!res.ok) {
          lastError = new Error(`overpass ${endpoint} returned ${res.status}`);
          continue;
        }
        data = await res.json();
        lastError = null;
        break;
      } catch (e) {
        lastError = e;
      }
    }
    if (lastError) {
      console.error("overpassNearby failed on all endpoints:", lastError);
      throw lastError;
    }

    return data.elements
      .map((el) => {
        const c = el.type === "node" ? { lat: el.lat, lon: el.lon } : el.center;
        if (!c || !el.tags || !el.tags.name) return null;
        return {
          name: el.tags.name,
          lat: c.lat,
          lon: c.lon,
          website: el.tags.website || el.tags["contact:website"] || null,
          openingHours: el.tags.opening_hours || null,
        };
      })
      .filter(Boolean)
      .sort((a, b) => haversineKm(lat, lon, a.lat, a.lon) - haversineKm(lat, lon, b.lat, b.lon))
      .slice(0, 12);
  }

  let nearbyState = {};

  function getNearby(pickId) {
    if (!nearbyState[pickId]) nearbyState[pickId] = { open: false, category: null, status: "idle", results: [] };
    return nearbyState[pickId];
  }

  function initNearbyMap(pick, results) {
    const el = document.getElementById(nearbyMapElId(pick.id));
    if (!el) return;
    const map = L.map(el, { scrollWheelZoom: false });
    pickMiniMaps.push(map);
    addTileLayer(map);
    L.marker([pick.lat, pick.lon], {
      icon: L.divIcon({ className: "center-marker", html: "★", iconSize: [24, 24], iconAnchor: [12, 12] }),
    }).addTo(map);
    results.forEach((r, i) => {
      L.marker([r.lat, r.lon]).addTo(map).bindTooltip(`${i + 1}. ${r.name}`);
    });
    const bounds = L.latLngBounds([[pick.lat, pick.lon], ...results.map((r) => [r.lat, r.lon])]);
    map.fitBounds(bounds.pad(0.2));
  }

  function renderNearbyPanel(p) {
    if (p.lat == null) {
      return `<p class="pick-status" style="padding:0 16px 16px;">Getting location for "explore nearby"…</p>`;
    }
    const state = getNearby(p.id);
    let html = `<div class="nearby-panel">`;
    html += `<button class="nearby-toggle" data-nearby-toggle="${esc(p.id)}">🔎 ${state.open ? "Hide nearby search" : "Explore nearby"}</button>`;
    if (state.open) {
      html += `<div class="filter-row" style="padding:0 16px 10px;">`;
      NEARBY_CATEGORIES.forEach((c) => {
        html += `<button class="filter-chip${state.category === c.key ? " active" : ""}" data-nearby-cat="${esc(p.id)}|${c.key}">${c.icon} ${esc(c.label)}</button>`;
      });
      html += `</div>`;

      if (state.category) {
        if (state.status === "loading") {
          html += `<p class="pick-status" style="padding:0 16px 16px;">Searching OpenStreetMap for ${esc(catLabel(state.category)).toLowerCase()} nearby…</p>`;
        } else if (state.status === "error") {
          html += `
            <div style="padding:0 16px 16px;">
              <p class="pick-status">Search failed — the free OpenStreetMap server this uses can be slow or overloaded sometimes. Give it a moment and retry.</p>
              <button class="candidate-add" data-nearby-cat="${esc(p.id)}|${esc(state.category)}">↻ Retry</button>
            </div>
          `;
        } else if (state.status === "done") {
          if (!state.results.length) {
            html += `<p class="pick-status" style="padding:0 16px 16px;">No ${esc(catLabel(state.category)).toLowerCase()} found within ~1.2km.</p>`;
          } else {
            html += `<div class="nearby-map" id="${nearbyMapElId(p.id)}"></div>`;
            state.results.forEach((r, i) => {
              const distKm = haversineKm(p.lat, p.lon, r.lat, r.lon);
              const distLabel = distKm < 1 ? `${Math.round(distKm * 1000)} m` : `${distKm.toFixed(1)} km`;
              html += `
                <div class="candidate-card">
                  <div style="flex:1;">
                    <div class="place-name">${i + 1}. ${esc(r.name)}</div>
                    <div class="place-notes">${esc(distLabel)} away${r.openingHours ? " · " + esc(r.openingHours) : ""}</div>
                  </div>
                  <button class="candidate-add" data-add-nearby="${esc(p.id)}|${i}">+</button>
                </div>
              `;
            });
          }
        }
      }
    }
    html += `</div>`;
    return html;
  }

  function renderPickCard(p) {
    const mapsUrl = mapsUrlFor(pickMapsQuery(p));
    let descriptionHtml;
    if (p.enrichStatus === "loading") {
      descriptionHtml = `<p class="pick-status">Fetching details from OpenStreetMap & Wikipedia…</p>`;
    } else if (p.description) {
      descriptionHtml = `<p class="place-notes">${esc(p.description)}</p>`;
    } else if (p.notes) {
      descriptionHtml = `<p class="place-notes">${esc(p.notes)}</p>`;
    } else if (p.enrichStatus === "empty") {
      descriptionHtml = `<p class="pick-status">No extra details found for this one.</p>`;
    } else {
      descriptionHtml = "";
    }

    const mapElId = pickMapElId(p.id);
    const folders = loadFolders();

    return `
      <div class="card pick-card" data-pick-id="${esc(p.id)}">
        <div class="pick-card-top">
          <div style="flex:1;">
            <div class="place-name">${esc(p.name)}</div>
            <div class="place-meta">
              ${p.city ? `<span class="pill" style="background:${cityColor(p.city)}">${esc(p.city)}</span>` : ""}${esc(p.category)}
            </div>
            ${descriptionHtml}
            ${p.website ? `<div class="place-links"><a href="${esc(p.website)}" target="_blank" rel="noopener">🌐 Website</a></div>` : ""}
          </div>
          <button class="pick-remove" data-remove-pick="${esc(p.id)}" aria-label="Remove">✕</button>
        </div>
        ${p.lat != null ? `<div class="pick-mini-map" id="${mapElId}"></div>` : ""}
        ${mapsUrl ? `<a class="pick-maps-btn" href="${mapsUrl}" target="_blank" rel="noopener">📍 Open in Google Maps</a>` : ""}
        <div class="move-row">
          <span class="move-label">Folder:</span>
          ${folders
            .map(
              (c) =>
                `<button class="move-chip${p.city === c ? " active" : ""}" data-move-pick="${esc(p.id)}|${esc(c)}">${esc(c)}</button>`
            )
            .join("")}
          <button class="move-chip" data-new-folder-for="${esc(p.id)}">+ New</button>
        </div>
        ${renderNearbyPanel(p)}
      </div>
    `;
  }

  // ---------- Picks: search-and-confirm with a real map ----------

  let pickSearch = { query: "", status: "idle", results: [] }; // idle | loading | done | error
  const pickMiniMaps = []; // Leaflet map instances from the last render, torn down before re-render

  async function searchNominatim(query) {
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&addressdetails=1&q=${encodeURIComponent(
      `${query}, Scotland`
    )}`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error("nominatim error");
    const data = await res.json();
    return data.map((r) => ({
      name: (r.namedetails && r.namedetails.name) || r.display_name.split(",")[0],
      displayName: r.display_name,
      lat: parseFloat(r.lat),
      lon: parseFloat(r.lon),
      type: r.type,
      website: (r.extratags && r.extratags.website) || null,
    }));
  }

  function destroyMiniMaps() {
    pickMiniMaps.forEach((m) => m.remove());
    pickMiniMaps.length = 0;
  }

  function addTileLayer(map) {
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap contributors",
      maxZoom: 19,
    }).addTo(map);
  }

  function initSearchResultsMap(results) {
    const el = document.getElementById("pickSearchMap");
    if (!el || !results.length) return;
    const map = L.map(el, { scrollWheelZoom: false });
    pickMiniMaps.push(map);
    addTileLayer(map);
    const markers = results.map((r, i) =>
      L.marker([r.lat, r.lon])
        .addTo(map)
        .bindTooltip(`${i + 1}. ${r.name}`, { permanent: false })
    );
    const bounds = L.latLngBounds(results.map((r) => [r.lat, r.lon]));
    map.fitBounds(bounds.pad(0.3));
    markers.forEach((m, i) => {
      m.on("click", () => {
        const card = view.querySelector(`[data-candidate="${i}"]`);
        if (card) card.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
    });
  }

  function pickMapElId(id) {
    return "map-" + id.replace(/[^a-zA-Z0-9]/g, "_");
  }

  function initPickMiniMap(pick) {
    const el = document.getElementById(pickMapElId(pick.id));
    if (!el || pick.lat == null) return;
    const map = L.map(el, {
      scrollWheelZoom: false,
      dragging: false,
      zoomControl: false,
      attributionControl: false,
    });
    pickMiniMaps.push(map);
    addTileLayer(map);
    map.setView([pick.lat, pick.lon], 14);
    L.marker([pick.lat, pick.lon]).addTo(map);
  }

  async function confirmAddCandidate(candidate, folder) {
    const id = pickId("custom", candidate.name);
    const picks = loadPicks();
    if (picks.some((p) => p.id === id)) {
      pickSearch = { query: "", status: "idle", results: [] };
      renderPicks();
      return;
    }
    // Maps query is built from real geographic data (Nominatim's full
    // address, when we have it) - never from the folder, which is just the
    // user's own organisation and may have nothing to do with geography.
    const mapsQuery = candidate.displayName || `${candidate.name}, Scotland`;
    const pick = {
      id,
      source: "custom",
      name: candidate.name,
      city: folder || nearestCity(candidate.lat, candidate.lon),
      category: candidate.type || "Custom",
      notes: "",
      description: "",
      website: candidate.website || "",
      mapsQuery,
      lat: candidate.lat,
      lon: candidate.lon,
      enrichStatus: "loading",
      addedAt: Date.now(),
    };
    picks.push(pick);
    savePicks(picks);
    pickSearch = { query: "", status: "idle", results: [] };
    renderPicks();

    let wiki = null;
    try {
      wiki = await wikiEnrich(candidate.name);
    } catch (e) {
      // best-effort only
    }
    const fresh = loadPicks();
    const target = fresh.find((p) => p.id === id);
    if (!target) return; // removed while enriching
    if (wiki) {
      if (wiki.description) target.description = wiki.description;
      if (!target.website && wiki.website) target.website = wiki.website;
    }
    target.enrichStatus = wiki ? "done" : "empty";
    savePicks(fresh);
    if (view.dataset.activeTab === "picks") renderPicks();
  }

  function renderPicks() {
    const picks = loadPicks();

    let html = `
      <div class="card">
        <p>Bookmark places from Places/Eats (♡), or search for anywhere else you've found — confirm the
        right one on the map, then a real description comes from Wikipedia automatically. Free, no account needed.</p>
      </div>
      <form class="search-bar" id="pickSearchForm">
        <input type="text" id="pickSearchInput" placeholder="Search for a place to add…" autocomplete="off" value="${esc(
          pickSearch.query
        )}" />
        <button type="submit" aria-label="Search">🔍</button>
      </form>
    `;

    if (pickSearch.status === "loading") {
      html += `<div class="card"><p class="pick-status">Searching OpenStreetMap…</p></div>`;
    } else if (pickSearch.status === "error") {
      html += `<div class="card"><p class="pick-status">Search failed — check your connection and try again.</p></div>`;
    } else if (pickSearch.status === "done") {
      if (!pickSearch.results.length) {
        html += `<div class="card"><p class="pick-status">No matches for "${esc(pickSearch.query)}" — try a shorter or more general name.</p></div>`;
      } else {
        html += `
          <div class="card" style="padding:0;overflow:hidden;">
            <div id="pickSearchMap" class="search-map"></div>
          </div>
          <p class="search-hint">Tap the right match below (or its pin above) to add it.</p>
        `;
        pickSearch.results.forEach((r, i) => {
          html += `
            <div class="card candidate-card" data-candidate="${i}">
              <div style="flex:1;">
                <div class="place-name">${i + 1}. ${esc(r.name)}</div>
                <div class="place-notes">${esc(r.displayName)}</div>
              </div>
              <button class="candidate-add" data-add-candidate="${i}">Add</button>
            </div>
          `;
        });
      }
    }

    if (picks.length === 0) {
      html += `<div class="card"><p>No picks yet.</p></div>`;
    } else {
      html += `<button class="hero-share" id="sharePicks" style="color:var(--navy);border-color:var(--line);background:var(--card);margin:16px 0;">↗ Share my picks</button>`;

      // Section order follows the folders list (so a manually reordered/renamed
      // folder stays put), then any leftover city values from before the
      // folders feature existed, then Unsorted last.
      const sectionOrder = loadFolders().slice();
      picks.forEach((p) => {
        if (p.city && !sectionOrder.includes(p.city)) sectionOrder.push(p.city);
      });
      sectionOrder.push("Unsorted");

      const groups = {};
      sectionOrder.forEach((c) => (groups[c] = []));
      picks.forEach((p) => {
        (groups[p.city] || groups.Unsorted).push(p);
      });

      sectionOrder.forEach((city) => {
        if (!groups[city].length) return;
        html += `<div class="section-label">${esc(city)}</div>`;
        groups[city].forEach((p) => {
          html += renderPickCard(p);
        });
      });
    }

    destroyMiniMaps();
    view.innerHTML = html;

    const searchForm = document.getElementById("pickSearchForm");
    if (searchForm) {
      searchForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const q = document.getElementById("pickSearchInput").value.trim();
        if (!q) return;
        pickSearch = { query: q, status: "loading", results: [] };
        renderPicks();
        try {
          const results = await searchNominatim(q);
          pickSearch = { query: q, status: "done", results };
        } catch (err) {
          pickSearch = { query: q, status: "error", results: [] };
        }
        renderPicks();
      });
    }

    if (pickSearch.status === "done" && pickSearch.results.length) {
      initSearchResultsMap(pickSearch.results);
      view.querySelectorAll("[data-add-candidate]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const candidate = pickSearch.results[Number(btn.getAttribute("data-add-candidate"))];
          const suggested = nearestCity(candidate.lat, candidate.lon);
          openFolderPicker(candidate.name, suggested, (folder) => confirmAddCandidate(candidate, folder));
        });
      });
    }

    picks.forEach((p) => {
      if (p.lat != null) initPickMiniMap(p);
      const state = nearbyState[p.id];
      if (state && state.open && state.category && state.status === "done" && state.results.length) {
        initNearbyMap(p, state.results);
      }
    });

    view.querySelectorAll("[data-nearby-toggle]").forEach((btn) => {
      btn.addEventListener("click", () => {
        getNearby(btn.getAttribute("data-nearby-toggle")).open ^= true;
        renderPicks();
      });
    });

    view.querySelectorAll("[data-nearby-cat]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const [id, catKey] = btn.getAttribute("data-nearby-cat").split("|");
        const pick = loadPicks().find((p) => p.id === id);
        const cat = NEARBY_CATEGORIES.find((c) => c.key === catKey);
        if (!pick || !cat) return;
        const state = getNearby(id);
        state.category = catKey;
        state.status = "loading";
        renderPicks();
        try {
          state.results = await overpassNearby(pick.lat, pick.lon, cat);
          state.status = "done";
        } catch (e) {
          state.status = "error";
        }
        renderPicks();
      });
    });

    view.querySelectorAll("[data-add-nearby]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const [id, idx] = btn.getAttribute("data-add-nearby").split("|");
        const state = getNearby(id);
        const r = state.results[Number(idx)];
        const parentPick = picks.find((p) => p.id === id);
        if (!r) return;
        const candidate = { name: r.name, lat: r.lat, lon: r.lon, type: catLabel(state.category), website: r.website };
        const suggested = (parentPick && parentPick.city) || nearestCity(r.lat, r.lon);
        openFolderPicker(candidate.name, suggested, (folder) => confirmAddCandidate(candidate, folder));
      });
    });

    const shareBtn = document.getElementById("sharePicks");
    if (shareBtn) {
      shareBtn.addEventListener("click", () => {
        const lines = ["🏴 My picks for Scotland with Ally", ""];
        picks.forEach((p) => {
          lines.push(`• ${p.name}${p.city ? ` (${p.city})` : ""}`);
          if (p.description) lines.push(`  ${p.description}`);
          if (p.website) lines.push(`  🌐 ${p.website}`);
        });
        shareText("My picks", lines.join("\n"));
      });
    }

    view.querySelectorAll("[data-remove-pick]").forEach((btn) => {
      btn.addEventListener("click", () => {
        removePick(btn.getAttribute("data-remove-pick"));
        renderPicks();
      });
    });

    view.querySelectorAll("[data-move-pick]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const [id, city] = btn.getAttribute("data-move-pick").split("|");
        setPickCity(id, city);
        renderPicks();
      });
    });

    view.querySelectorAll("[data-new-folder-for]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-new-folder-for");
        const pick = picks.find((p) => p.id === id);
        openFolderPicker(pick ? pick.name : "this pick", pick && pick.city, (folder) => {
          setPickCity(id, folder);
          renderPicks();
        });
      });
    });
  }

  const VIEWS = {
    overview: { render: renderOverview, sub: TRIP.dates },
    itinerary: { render: renderItinerary, sub: "Tap a day to expand" },
    places: { render: renderPlaces, sub: "Edinburgh · Stirling · Glasgow" },
    eats: { render: renderEats, sub: "Lunch & dinner picks, kid-friendly" },
    picks: { render: renderPicks, sub: "Your bookmarks & custom adds" },
    budget: { render: renderBudget, sub: "Estimated activity costs" },
    tips: { render: renderTips, sub: "Walking, weather, safety & packing" },
  };

  function showView(name) {
    const v = VIEWS[name];
    if (!v) return;
    view.dataset.activeTab = name;
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

  // ---------- Receiving a share from Google Maps ----------
  // Delivered by the native ShareReceiver plugin (MainActivity.java /
  // SharePlugin.java) when the app is opened via the share sheet from
  // Google Maps. Two shapes of payload:
  //  - {name, lat, lon, rawText}: got trusted coordinates straight from the
  //    share link - skip straight to "which folder does this go in".
  //  - {name, rawText} only: could only recover a name (e.g. a short link
  //    that failed to resolve) - fall back to the normal search-and-confirm
  //    flow so the map still confirms the right match.
  function handleSharedPlace(payload) {
    if (!payload || !payload.name) return;
    showView("picks");
    if (payload.lat != null && payload.lon != null) {
      const candidate = {
        name: payload.name,
        lat: payload.lat,
        lon: payload.lon,
        displayName: payload.rawText,
      };
      const suggested = nearestCity(payload.lat, payload.lon);
      openFolderPicker(candidate.name, suggested, (folder) => confirmAddCandidate(candidate, folder));
    } else {
      pickSearch = { query: payload.name, status: "idle", results: [] };
      renderPicks();
      const input = document.getElementById("pickSearchInput");
      if (input) input.value = payload.name;
    }
  }

  // notifyListeners on the native side uses retainUntilConsumed, so this
  // still fires with the right payload even if the share arrived before the
  // page (and this addListener call) existed - no race with page load time.
  const shareReceiver = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.ShareReceiver;
  if (shareReceiver) {
    shareReceiver.addListener("sharedPlace", handleSharedPlace);
  } else if (window.Capacitor) {
    // TEMPORARY DIAGNOSTIC (share-debug-2) - remove once the share flow is
    // confirmed working end to end. Only fires on native (Capacitor present).
    alert("share-debug-2: ShareReceiver plugin not found on window.Capacitor.Plugins");
  }

  topbarTitle.textContent = TRIP.title;
  showView("overview");
})();
