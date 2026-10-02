// A record of every request made to a model, and what came back - the thing to
// read when a search "doesn't do anything".
//
// Kept short on purpose (the last few, each clipped), stored on this phone
// only, left out of backups, and scrubbed of anything shaped like a key. The
// key is sent in a header and is never in what is recorded, but nothing here
// relies on that: everything is scrubbed on the way in and again on the way
// out.

export const EXCHANGE_KEY = "ai-exchanges-v1";

export function scrub(text) {
  return String(text == null ? "" : text)
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, "[key removed]")
    .replace(/(\bkey=)[^&\s"']+/gi, "$1[key removed]")
    .replace(/(x-goog-api-key["']?\s*[:=]\s*["']?)[^\s,"']+/gi, "$1[key removed]")
    .replace(/(Bearer\s+)[A-Za-z0-9._-]{8,}/gi, "$1[key removed]")
    .replace(/\bsk-[A-Za-z0-9_-]{12,}/g, "[key removed]");
}

// Keeps the start and the end of a long text, and says how much went missing:
// the start shows what was asked for, the end shows how it finished.
export function clip(text, head, tail) {
  const s = text == null ? "" : String(text);
  if (s.length <= head + tail) return s;
  return `${s.slice(0, head)}\n…[${s.length - head - tail} characters left out]…\n${s.slice(s.length - tail)}`;
}

export function createExchangeLog({ storage, key = EXCHANGE_KEY, max = 8, now = Date.now }) {
  const load = () => {
    const v = storage.readJson(key, []);
    return Array.isArray(v) ? v : [];
  };

  function record(entry) {
    const e = entry || {};
    const item = {
      at: new Date(now()).toISOString(),
      provider: e.provider || "",
      model: e.model || "",
      grounded: !!e.grounded,
      json: !!e.json,
      stream: !!e.stream,
      maxTokens: e.maxTokens || 0,
      prompt: clip(scrub(e.prompt), 14000, 6000),
      ms: e.ms == null ? null : e.ms,
      status: e.status == null ? null : e.status,
      ok: e.ok == null ? null : !!e.ok,
      error: clip(scrub(e.error), 600, 0),
      raw: clip(scrub(e.raw), 4000, 2000),
      finishReason: e.finishReason || "",
      blockReason: e.blockReason || "",
      searched: e.searched == null ? null : !!e.searched,
      queries: (e.queries || []).slice(0, 10).map((q) => scrub(q).slice(0, 200)),
      sources: (e.sources || []).slice(0, 10).map((s) => scrub(typeof s === "string" ? s : s && s.uri).slice(0, 300)),
      usage: e.usage && typeof e.usage === "object"
        ? { promptTokenCount: Number(e.usage.promptTokenCount) || 0, candidatesTokenCount: Number(e.usage.candidatesTokenCount) || 0 }
        : null,
    };
    const list = [item, ...load()].slice(0, max);
    storage.write(key, JSON.stringify(list));
    return item;
  }

  return { record, list: load, clear: () => storage.remove(key) };
}

const secs = (ms) => (ms == null ? "?" : `${(ms / 1000).toFixed(1)}s`);

export function exchangeText(e, n) {
  const out = [];
  out.push(`=== Request ${n}${e.at ? ` · ${e.at}` : ""} ===`);
  out.push(
    `Provider: ${e.provider || "?"}   Model: ${e.model || "?"}   Search offered: ${e.grounded ? "yes" : "no"}   ` +
      `JSON mode: ${e.json ? "yes" : "no"}   Streamed: ${e.stream ? "yes" : "no"}   Took: ${secs(e.ms)}`
  );
  out.push(
    `Result: ${e.status == null ? "no answer" : `HTTP ${e.status}`}${e.ok === false ? "  ERROR" : ""}` +
      `   finish reason: ${e.finishReason || "?"}${e.blockReason ? `   blocked: ${e.blockReason}` : ""}`
  );
  if (e.error) out.push(`ERROR: ${e.error}`);
  if (e.grounded) {
    const q = e.queries || [];
    out.push(
      `Searched the web: ${e.searched == null ? "?" : e.searched ? "yes" : "NO"}` +
        `${q.length ? ` - ${q.length} search${q.length === 1 ? "" : "es"}: ${q.join(" | ")}` : ""}`
    );
    if ((e.sources || []).length) out.push(`Sources: ${e.sources.join(", ")}`);
  }
  if (e.usage) out.push(`Tokens: ${e.usage.promptTokenCount} in, ${e.usage.candidatesTokenCount} out`);
  out.push(`--- sent ---\n${e.prompt || "(empty)"}`);
  out.push(`--- returned ---\n${e.raw ? e.raw : "(empty)"}`);
  return out.join("\n");
}

export function reportText({ header, verdict, steps, exchanges, trace }) {
  const h = header || {};
  const out = [];
  out.push(`Wayfare troubleshooting report${h.at ? ` ${h.at}` : ""}${h.app ? ` (build ${h.app})` : ""}`);
  out.push(
    `provider: ${h.provider || "?"}   model: ${h.model || "?"}${h.pinned ? " (pinned in Settings)" : ""}   ` +
      `key: ${h.keySet ? "set" : "NOT set"}   online: ${h.online === false ? "NO" : "yes"}`
  );
  if (verdict) out.push(`\nVERDICT: ${verdict}`);
  if ((steps || []).length) {
    out.push("\n--- checks ---");
    steps.forEach((s) => out.push(`[${s.status}] ${s.label}${s.ms != null ? ` (${secs(s.ms)})` : ""}${s.detail ? `: ${s.detail}` : ""}`));
  }
  out.push("\n--- requests to the model, newest first ---");
  if ((exchanges || []).length) exchanges.forEach((e, i) => out.push(exchangeText(e, i + 1), ""));
  else out.push("No requests to a model have been made on this phone yet.");
  if (trace) out.push(`--- last event search ---\n${trace}`);
  return scrub(out.join("\n"));
}
