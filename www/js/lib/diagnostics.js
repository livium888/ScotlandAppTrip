// Live checks that say which layer is failing: the network, the key, the
// model, the search, or the map servers the event search leans on.
//
// Each is a real request, and each reports the service's own words, so "it
// doesn't do anything" becomes a specific sentence. Everything it touches is
// passed in, so the logic can be tested in Node against a pretend network.
import { describeGeminiError } from "./ai.js";

const secs = (ms) => `${(ms / 1000).toFixed(1)}s`;
const head = (s, n = 400) => String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, n);

export async function runChecks({
  key, model, fetch, geminiBase, overpass = [], nominatim, place, online = true,
  now = () => Date.now(), timeoutMs = 45000, onStep = () => {}, pick = null,
}) {
  const steps = [];
  const add = (step) => {
    steps.push(step);
    onStep(step);
    return step;
  };

  async function timed(url, init) {
    const controller = new AbortController();
    let timer;
    const t0 = now();
    try {
      const res = await Promise.race([
        fetch(url, { ...init, signal: controller.signal }),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error(`no answer within ${Math.max(1, Math.round(timeoutMs / 1000))} seconds`));
          }, timeoutMs);
        }),
      ]);
      const raw = await res.text();
      let data = null;
      try {
        data = JSON.parse(raw);
      } catch {
        data = null;
      }
      return { res, raw, data, ms: now() - t0 };
    } finally {
      clearTimeout(timer);
    }
  }

  const header = { "x-goog-api-key": key };
  const path = (m) => (m.indexOf("models/") === 0 ? m : `models/${m}`);
  const skip = (id, label, why) => add({ id, label, status: "skip", ms: null, detail: why });
  const parts = (d) => ((d && d.candidates && d.candidates[0] && d.candidates[0].content && d.candidates[0].content.parts) || []).map((p) => p.text || "").join("");

  // 1. The phone's own view of the network.
  const net = add({ id: "online", label: "Phone connection", status: online ? "ok" : "fail", ms: null, detail: online ? "The phone reports a connection." : "The phone reports no connection (offline)." });
  if (!online) {
    ["models", "answer", "search", "overpass", "nominatim"].forEach((id) => skip(id, id, "Skipped: offline."));
    return { steps, verdict: verdictFor(steps) };
  }
  void net;

  // 2. The key, and the models it can use.
  let usable = true;
  let chosen = model || "";
  if (!key) {
    usable = false;
    add({ id: "models", label: "Key and models", status: "fail", ms: null, detail: "No key is set. Settings has the field for a Gemini key." });
  } else {
    try {
      const r = await timed(`${geminiBase}/models`, { headers: header });
      if (!r.res.ok) {
        usable = false;
        add({ id: "models", label: "Key and models", status: "fail", ms: r.ms, detail: `${describeGeminiError(r.res.status, r.data, r.raw)}` });
      } else {
        const names = ((r.data && r.data.models) || []).map((m) => m.name);
        if (!chosen && names.length) chosen = pick ? pick(names) : names[0];
        const has = !model || names.includes(path(model));
        add({
          id: "models", label: "Key and models", status: has ? "ok" : "warn", ms: r.ms,
          detail: has
            ? `The key works and can use ${names.length} model${names.length === 1 ? "" : "s"}.`
            : `The key works, but the model chosen (${model}) isn't available on this key. It can use: ${names.slice(0, 8).join(", ")}.`,
        });
      }
    } catch (e) {
      usable = false;
      add({ id: "models", label: "Key and models", status: "fail", ms: null, detail: `Couldn't reach Google: ${(e && e.message) || e}` });
    }
  }

  if (!usable || !chosen) {
    skip("answer", "Model answers", usable ? "No model is chosen." : "Skipped: needs a working key.");
    skip("search", "Search runs", usable ? "No model is chosen." : "Skipped: needs a working key.");
  } else {
    const url = `${geminiBase}/${path(chosen)}:generateContent`;
    const post = (body) => timed(url, { method: "POST", headers: { ...header, "Content-Type": "application/json" }, body: JSON.stringify(body) });

    // 3. The model, with no search: does it answer at all?
    try {
      const r = await post({ contents: [{ parts: [{ text: "Reply with the single word OK." }] }], generationConfig: { temperature: 0, maxOutputTokens: 64 } });
      if (!r.res.ok) {
        add({ id: "answer", label: "Model answers", status: "fail", ms: r.ms, detail: `${describeGeminiError(r.res.status, r.data, r.raw)}\nRaw: ${head(r.raw, 500)}` });
      } else {
        const text = parts(r.data);
        add({ id: "answer", label: "Model answers", status: /ok/i.test(text) ? "ok" : "warn", ms: r.ms, detail: `${chosen} said: ${head(text, 120) || "(nothing)"}` });
      }
    } catch (e) {
      add({ id: "answer", label: "Model answers", status: "fail", ms: null, detail: `No answer: ${(e && e.message) || e}` });
    }

    // 4. The same model with search on: does it actually look things up?
    try {
      const r = await post({
        contents: [{ parts: [{ text: `Search the web and find one film showing at a cinema in or near ${place || "London"} this week. Reply with one short line: the film, the cinema, and the website you found it on.` }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 1024 },
        tools: [{ google_search: {} }],
      });
      if (!r.res.ok) {
        add({ id: "search", label: "Search runs", status: "fail", ms: r.ms, detail: `${describeGeminiError(r.res.status, r.data, r.raw)}\nRaw: ${head(r.raw, 500)}` });
      } else {
        const cand = r.data && r.data.candidates && r.data.candidates[0];
        const gm = cand && cand.groundingMetadata;
        const queries = (gm && gm.webSearchQueries) || [];
        const sources = ((gm && gm.groundingChunks) || []).filter((c) => c.web && c.web.uri);
        const searched = !!(queries.length || sources.length || (gm && gm.searchEntryPoint));
        const text = parts(r.data);
        add({
          id: "search", label: "Search runs", status: searched ? "ok" : "warn", ms: r.ms,
          detail: searched
            ? `${chosen} searched: ${queries.length} Google search${queries.length === 1 ? "" : "es"}${queries.length ? ` (${queries.join(" | ")})` : ""}, ${sources.length} source${sources.length === 1 ? "" : "s"}. Answer: ${head(text, 200)}`
            : `${chosen} answered without searching - from memory. Answer: ${head(text, 200)}`,
        });
      }
    } catch (e) {
      add({ id: "search", label: "Search runs", status: "fail", ms: null, detail: `No answer: ${(e && e.message) || e}` });
    }
  }

  // 5. The map servers that name the towns and venues to search.
  {
    const lines = [];
    let anyOk = false;
    for (const url of overpass) {
      const host = url.replace(/^https?:\/\/|\/.*$/g, "");
      try {
        const r = await timed(url, {});
        lines.push(`${host}: HTTP ${r.res.status} in ${secs(r.ms)}`);
        if (r.res.ok) anyOk = true;
      } catch (e) {
        lines.push(`${host}: failed (${(e && e.message) || e})`);
      }
    }
    add({ id: "overpass", label: "Map servers (towns and venues)", status: anyOk ? "ok" : "fail", ms: null, detail: lines.join("; ") || "No map server is configured." });
  }
  {
    try {
      const r = await timed(`${nominatim}?q=${encodeURIComponent(place || "London")}&format=json&limit=1`, {});
      const found = Array.isArray(r.data) && r.data.length > 0;
      add({ id: "nominatim", label: "Place lookup", status: r.res.ok && found ? "ok" : "fail", ms: r.ms, detail: r.res.ok ? (found ? `Found ${head(r.data[0].display_name, 80)}.` : "Answered, but found nothing.") : `HTTP ${r.res.status}` });
    } catch (e) {
      add({ id: "nominatim", label: "Place lookup", status: "fail", ms: null, detail: `Failed: ${(e && e.message) || e}` });
    }
  }

  return { steps, verdict: verdictFor(steps) };
}

// In words: the first thing that is actually wrong, in the order it would bite.
export function verdictFor(steps) {
  const by = (id) => steps.find((s) => s.id === id) || {};
  const detail = (id) => String(by(id).detail || "");
  if (by("online").status === "fail") return "The phone reports no connection, so nothing can be searched until it is back.";
  if (by("models").status === "fail") {
    if (/^No key/i.test(detail("models"))) return "No key is set, so no search can run. Add a Gemini key in Settings.";
    if (/couldn't reach google/i.test(detail("models"))) return `Google can't be reached from this phone right now (${detail("models").replace(/^Couldn't reach Google: /i, "")}). Check the connection and try again.`;
    return "The key was rejected by Google. Open Settings and check it was copied whole, and that it is a Gemini key.";
  }
  if (by("answer").status === "fail") {
    if (/429|quota|rate limit/i.test(detail("answer"))) return "Google is refusing requests because the key is over its quota or rate limit. Wait a minute, or check the key's usage in Google AI Studio.";
    if (/no answer within/i.test(detail("answer"))) return "Google didn't answer in time. That is usually the signal; try again.";
    return "The model won't answer, so nothing can be searched. Google's own message is in the checks.";
  }
  if (by("search").status === "fail") return "The model answers, but a search request fails. Google's own message is in the checks.";
  if (by("search").status === "warn") return "Search is not running for this model: it answers from memory, so event searches are set aside as unconfirmed. Pick a full Flash model in Settings (not a Lite one), then check again.";
  const maps = ["overpass", "nominatim"].filter((id) => by(id).status === "fail");
  if (maps.length === 2) return "The map servers aren't answering, so venue and town lookups will come back empty. That can leave a search with nothing to look for.";
  if (maps.length === 1) return `One map service isn't answering (${by(maps[0]).label}). Searches may find fewer venues or towns than usual.`;
  if (by("models").status === "warn") return `${detail("models")}`;
  return "Every service responds. If a search still returns nothing, the problem is in what the search returns: look at what was sent and returned below.";
}
