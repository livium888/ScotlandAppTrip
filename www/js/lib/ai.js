// Everything about talking to a model that is pure: turning errors into advice,
// choosing a model, pricing usage, reading citations and the streamed answer.
// No page, no storage - so it can be tested in Node directly.

// Turns Google's error payloads into something worth showing a user, since
// the raw JSON is long and the useful part is buried in it.
export function describeGeminiError(status, data, rawText) {
  const err = (data && data.error) || {};
  const msg = err.message || (rawText || "").slice(0, 300) || "no detail";
  const reason =
    (err.details || [])
      .map((d) => d.reason || "")
      .filter(Boolean)
      .join(", ") || err.status || "";

  if (status === 400 && /API key not valid|API_KEY_INVALID/i.test(msg + reason)) {
    return `Key rejected by Google (400 API_KEY_INVALID). Check it was copied whole, and that it's a Gemini key from aistudio.google.com — a Maps/Places key won't work here.\n\n${msg}`;
  }
  if (status === 403 && /SERVICE_DISABLED|has not been used in project|is disabled/i.test(msg + reason)) {
    return `The Generative Language API isn't enabled on that key's project (403 SERVICE_DISABLED). Open the link in Google's message below and enable it, then wait a minute.\n\n${msg}`;
  }
  if (status === 403 && /referer|referrer|API_KEY_HTTP_REFERRER|android|ios|blocked/i.test(msg + reason)) {
    // Deliberately does not suggest an Android app restriction. That kind
    // is enforced by the caller sending X-Android-Package and
    // X-Android-Cert headers, which Google's own SDKs add and a plain
    // fetch() from a WebView does not - so it refuses this app's requests
    // rather than protecting them.
    return `The key has application restrictions, and requests from this app can't satisfy them (403). This app calls Google directly from a web view, which sends no referrer and no Android signing headers, so any "Application restriction" will block it. Set Application restrictions to "None" and use "API restrictions" instead — limit the key to the Generative Language API.\n\n${msg}`;
  }
  if (status === 403) {
    return `Google refused the key (403). Often this is API restrictions on the key limiting it to other APIs.\n\n${msg}`;
  }
  if (status === 404) {
    return `Model not found (404) — the model this app asked for isn't available to your key.\n\n${msg}`;
  }
  if (status === 429) {
    return `Rate limit or quota exceeded (429). Free tier limits are per-minute as well as per-day, so waiting a minute often clears it.\n\n${msg}`;
  }
  return `Gemini returned ${status}.\n\n${msg}`;
}

// Scores a model so the newest sensible one wins. The previous version took
// the first name containing "flash-lite" out of a 40-odd model list, which
// matched the long-deprecated gemini-2.0-flash-lite-001 before ever reaching
// 3.5 - so the automatic choice was a model Google had already retired.
export function scoreGeminiModel(name) {
  const n = name.replace(/^models\//, "");
  const version = parseFloat((n.match(/gemini-(\d+(?:\.\d+)?)/) || [])[1] || "0");
  let score = version * 100; // newer generation beats everything else

  if (/flash-lite/.test(n)) score += 40; // cheapest capable tier
  else if (/flash/.test(n)) score += 30;
  else if (/pro/.test(n)) score += 10;

  // Pinned dated builds ("-001") get retired while the rolling alias keeps
  // working, and experimental/preview names come and go.
  if (/-\d{3}$/.test(n)) score -= 25;
  if (/(exp|preview)/.test(n)) score -= 30;
  return score;
}

export function chooseGeminiModel(models) {
  const names = models.map((m) => m.name);
  if (!names.length) return "";
  return names.slice().sort((a, b) => scoreGeminiModel(b) - scoreGeminiModel(a))[0];
}

// The model to hand an event search to when the everyday one - usually a
// lite tier, chosen for cost - answers without searching. Google leaves the
// search to the model's judgement, and the lite tiers often judge that
// they already know what is on this weekend. A full flash model searches
// far more reliably. Only real text models: the list also carries image,
// speech and live-audio models whose names score just as well.
// The tier decides first and the version second. It was the other way
// round, so a newer lite model beat an older full one - 3.5 flash-lite
// scored 350 against 2.5 flash's 290 - and the search went to the one
// tier that answers "[]" in under two seconds without looking.
export function scoreSearchModel(name) {
  const n = name.replace(/^models\//, "");
  if (/(image|tts|audio|live|embed|robotics|computer|learnlm|gemma|aqa)/i.test(n)) return -Infinity;
  const version = parseFloat((n.match(/gemini-(\d+(?:\.\d+)?)/) || [])[1] || "0");
  const tier = /lite/.test(n) ? 0 : /flash/.test(n) ? 2 : /pro/.test(n) ? 1 : 0;
  let score = tier * 1000 + version * 100;
  if (/-\d{3}$/.test(n)) score -= 25;
  if (/(exp|preview)/.test(n)) score -= 30;
  return score;
}

// Where the citations are, for hosts that produce them. They do not agree:
// OpenRouter hangs annotations off the message, Perplexity returns a flat
// citations array at the top level and, on newer replies, search_results
// with titles. None of these could be tried against the real thing from
// where this was written, so it reads all three and shrugs at anything it
// does not recognise - and the unsourced check downstream is what makes
// being wrong here safe rather than dangerous.
export function openAiCitations(data, choice) {
  const out = [];
  const push = (uri, title) => {
    if (!uri || typeof uri !== "string") return;
    if (out.some((s) => s.uri === uri)) return;
    out.push({ title: title || uri, uri });
  };

  const anns = (choice && choice.message && choice.message.annotations) || [];
  if (Array.isArray(anns)) {
    anns.forEach((a) => {
      const c = (a && a.url_citation) || {};
      push(c.url || (a && a.url), c.title || (a && a.title));
    });
  }
  if (Array.isArray(data && data.citations)) {
    data.citations.forEach((c) => (typeof c === "string" ? push(c) : push(c && c.url, c && c.title)));
  }
  if (Array.isArray(data && data.search_results)) {
    data.search_results.forEach((r) => push(r && r.url, r && r.title));
  }
  return out;
}

// A streamed reply, read as it arrives and folded back into the shape of a
// single one: the text joined up, the grounding from whichever chunk
// carried it, the usage from the last. It also accepts a reply that was
// not streamed at all - a plain object, or an array of chunks - since what
// arrives is up to the server and the network in between.
export async function readGeminiStream(res, onText) {
  const merged = { candidates: [{ content: { parts: [] }, groundingMetadata: null }], usageMetadata: null };
  let text = "";
  const take = (chunk) => {
    if (!chunk || typeof chunk !== "object") return;
    const c = chunk.candidates && chunk.candidates[0];
    if (c) {
      const piece = ((c.content && c.content.parts) || []).map((p) => p.text || "").join("");
      if (piece) {
        text += piece;
        try {
          onText(text);
        } catch {
          /* a display callback failing is not the search failing */
        }
      }
      if (c.finishReason) merged.candidates[0].finishReason = c.finishReason;
      if (c.groundingMetadata) {
        const g = merged.candidates[0].groundingMetadata || {};
        const n = c.groundingMetadata;
        merged.candidates[0].groundingMetadata = {
          webSearchQueries: (g.webSearchQueries || []).concat(n.webSearchQueries || []),
          groundingChunks: (g.groundingChunks || []).concat(n.groundingChunks || []),
          searchEntryPoint: n.searchEntryPoint || g.searchEntryPoint,
        };
      }
    }
    if (chunk.usageMetadata) merged.usageMetadata = chunk.usageMetadata;
  if (chunk.promptFeedback) merged.promptFeedback = chunk.promptFeedback;
  };
  const handleBlock = (block) => {
    const lines = block.split(/\r?\n/).filter((l) => l.startsWith("data:"));
    if (!lines.length) return false;
    const payload = lines.map((l) => l.slice(5).trim()).join("");
    try {
      take(JSON.parse(payload));
    } catch {
      /* a malformed chunk loses that chunk, not the answer */
    }
    return true;
  };

  let all = "";
  let sawEvents = false;
  if (res.body && res.body.getReader) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      const piece = decoder.decode(value, { stream: true });
      all += piece;
      buffer += piece;
      let cut;
      while ((cut = buffer.search(/\r?\n\r?\n/)) >= 0) {
        const block = buffer.slice(0, cut);
        buffer = buffer.slice(cut).replace(/^\r?\n\r?\n/, "");
        if (handleBlock(block)) sawEvents = true;
      }
    }
    if (buffer.trim() && handleBlock(buffer)) sawEvents = true;
  } else {
    all = await res.text();
    all.split(/\r?\n\r?\n/).forEach((b) => {
      if (handleBlock(b)) sawEvents = true;
    });
  }
  if (!sawEvents) {
    let data = null;
    try {
      data = JSON.parse(all);
    } catch {
      data = null;
    }
    if (!data) throw new Error("Gemini returned a response that wasn't JSON.");
    (Array.isArray(data) ? data : [data]).forEach(take);
  }
  merged.candidates[0].content.parts = [{ text }];
  return merged;
}

// Dollars per million tokens, by model family, so the figure follows
// whichever model the key actually resolved to rather than assuming the
// cheapest one. Matched longest-name-first, because "flash-lite" contains
// "flash" and would otherwise be priced as the dearer model.
//
// These are published rates as of the date above and this app has no way to
// check them, which is why the one in use is printed next to the number and
// can be corrected. A price that cannot be seen is a claim, not an estimate.
export const MODEL_RATES = [
  { match: "flash-lite", label: "Flash-Lite", in: 0.1, out: 0.4 },
  { match: "flash", label: "Flash", in: 0.3, out: 2.5 },
  { match: "pro", label: "Pro", in: 1.25, out: 10 },
];

export const FALLBACK_RATE = { label: "unknown model", in: 0.1, out: 0.4 };

// The rate for the model this key is on. Falls back to the cheapest rather
// than to nothing: an unrecognised model name is far more likely to be a
// newer small model than a reason to stop counting.
export function rateForModel(modelName) {
  const name = String(modelName || "").toLowerCase();
  const hit = MODEL_RATES.find((r) => name.indexOf(r.match) >= 0);
  return hit || FALLBACK_RATE;
}

export function money4(n) {
  // Fractions of a penny are the normal case here, and rounding them to
  // "£0.00" would read as "this is free" when it is not.
  if (n === 0) return "£0";
  if (n < 0.01) return `less than 1p`;
  return `£${n.toFixed(2)}`;
}
