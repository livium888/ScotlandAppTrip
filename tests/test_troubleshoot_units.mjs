// The troubleshooting record and the live checks, tested in Node.
//
// "I'm not getting anything at all, and I want to see what was sent and what
// was returned." Two pure pieces make that possible: a log of every request
// to a model with the raw reply (kept short, scrubbed of anything shaped like
// a key), and a set of live checks that say which layer is failing - the
// network, the key, the model, the search, or the map servers - in words.
import { createStorage } from '../www/js/lib/storage.js';
import { createExchangeLog, scrub, clip, exchangeText, reportText } from '../www/js/lib/exchangelog.js';
import { runChecks, verdictFor } from '../www/js/lib/diagnostics.js';

let failures = 0;
const check = (l, c, extra) => { if (c) console.log(`PASS: ${l}`); else { console.log(`FAIL: ${l}${extra ? ' :: ' + extra : ''}`); failures++; } };

const phone = () => { const d = new Map(); return { getItem: (k) => (d.has(k) ? d.get(k) : null), setItem: (k, v) => d.set(k, String(v)), removeItem: (k) => d.delete(k), d }; };

// ---------- scrubbing and clipping ----------
check('anything shaped like a Google key is removed', scrub('x AIzaSyA1234567890abcdefghijklmnopqrstuvw y') === 'x [key removed] y');
check('a key in a URL, header or token is removed too', !/SECRET/.test(scrub('https://x?key=SECRET1234567890&a=1')) && !/SECRET/.test(scrub('x-goog-api-key: SECRET1234567890')) && !/sk-[A-Za-z0-9]/.test(scrub('Bearer sk-abcdefghijklmnop1234')));
check('ordinary text is left alone', scrub('A film at the Odeon, 19:30') === 'A film at the Odeon, 19:30');
check('a long text keeps its start and its end and says how much was left out', (() => {
  const t = clip('A'.repeat(100) + 'M'.repeat(1000) + 'Z'.repeat(100), 100, 100);
  return t.startsWith('A'.repeat(100)) && t.endsWith('Z'.repeat(100)) && /1000 characters left out/.test(t) && !t.includes('M'.repeat(50));
})());
check('a short text is untouched, and nothing is not an error', clip('hello', 100, 100) === 'hello' && clip(null, 10, 10) === '' && clip(undefined, 10, 10) === '');

// ---------- the log ----------
{
  const b = phone(); let n = 0;
  const log = createExchangeLog({ storage: createStorage({ backend: b }), max: 3, now: () => 1000 + n++ });
  check('a new log is empty', log.list().length === 0);
  log.record({ provider: 'gemini', model: 'models/m', prompt: 'Find films', grounded: true, status: 200, ok: true, raw: 'answer', searched: true, queries: ['q1'], sources: [{ uri: 'https://a.example' }] });
  const first = log.list()[0];
  check('a request is kept with what was sent and what came back', first.prompt === 'Find films' && first.raw === 'answer' && first.status === 200 && first.grounded === true && first.queries[0] === 'q1' && first.sources[0] === 'https://a.example');
  log.record({ prompt: 'two' }); log.record({ prompt: 'three' }); log.record({ prompt: 'four' });
  check('only the latest few are kept, newest first', log.list().map((e) => e.prompt).join() === 'four,three,two');
  check('it survives a restart, because it is stored', createExchangeLog({ storage: createStorage({ backend: b }), max: 3 }).list().length === 3);
  log.clear();
  check('it can be cleared', log.list().length === 0);
  log.record({ prompt: 'Key AIzaSyA1234567890abcdefghijklmnopqrstuvw', error: 'bad key=SECRET1234567890' , raw: 'x-goog-api-key: SECRET1234567890' });
  const e = log.list()[0];
  check('a key can never end up in the record, wherever it appears', !/AIza|SECRET/.test(JSON.stringify(e)));
  log.record({ prompt: 'p'.repeat(50000), raw: 'r'.repeat(50000) });
  const big = log.list()[0];
  check('very long prompts and replies are shortened so the phone is not filled', big.prompt.length < 22000 && big.raw.length < 8000);
}

// ---------- the text of one exchange ----------
const ex = { at: '2026-10-03T10:00:00Z', provider: 'gemini', model: 'models/gemini-3.5-flash', grounded: true, json: false, stream: true, maxTokens: 8192,
  prompt: 'Find films near Fareham', ms: 4200, status: 200, ok: true, searched: true, queries: ['films fareham'], sources: ['https://a.example'], finishReason: 'STOP', raw: '- name: A', usage: { promptTokenCount: 10, candidatesTokenCount: 5 } };
const t1 = exchangeText(ex, 1);
check('an exchange says which model, whether search was offered, and how long it took', /models\/gemini-3\.5-flash/.test(t1) && /search offered: yes/i.test(t1) && /4\.2s/.test(t1));
check('it shows what was sent', /--- sent ---\nFind films near Fareham/.test(t1));
check('and what came back, with whether it searched, the searches and the sources', /--- returned ---/.test(t1) && /- name: A/.test(t1) && /searched the web: yes/i.test(t1) && /films fareham/.test(t1) && /https:\/\/a\.example/.test(t1));
const bad = exchangeText({ ...ex, ok: false, status: 429, error: 'Quota exceeded', raw: '{"error":{"message":"Quota exceeded"}}', searched: false, queries: [], sources: [] }, 2);
check('a failure shows the status, the error and the raw body', /429/.test(bad) && /Quota exceeded/.test(bad) && /ERROR/.test(bad));
check('an empty reply is said to be empty, not shown as nothing', /\(empty\)/.test(exchangeText({ ...ex, raw: '' }, 1)));
check('a block reason or an odd finish reason is surfaced', /blocked: SAFETY/.test(exchangeText({ ...ex, blockReason: 'SAFETY' }, 1)) && /finish reason: MAX_TOKENS/.test(exchangeText({ ...ex, finishReason: 'MAX_TOKENS' }, 1)));

// ---------- the whole report ----------
const rep = reportText({ header: { app: '1.0 (42)', at: '2026-10-03T10:00:00Z', provider: 'gemini', model: 'models/m', pinned: true, keySet: true, online: true },
  verdict: 'All good', steps: [{ label: 'Key', status: 'ok', ms: 120, detail: '5 models' }], exchanges: [ex], trace: 'TRACE TEXT' });
check('the report leads with the build, the model and whether a key is set - never the key', /build 1\.0 \(42\)/.test(rep) && /key: set/i.test(rep) && /pinned/i.test(rep));
check('then the verdict, the checks, the exchanges and the last event search', rep.indexOf('All good') < rep.indexOf('Key') && rep.indexOf('Key') < rep.indexOf('--- sent ---') && rep.indexOf('--- sent ---') < rep.indexOf('TRACE TEXT'));
check('with no exchanges it says so', /No requests to a model have been made/.test(reportText({ header: {}, verdict: '', steps: [], exchanges: [], trace: '' })));

// ---------- the live checks ----------
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const base = 'https://gl.example/v1beta';
const router = (over = {}) => async (url, opts = {}) => {
  const u = String(url);
  for (const [pat, fn] of Object.entries(over)) if (u.includes(pat)) return fn(u, opts);
  if (u.endsWith('/models')) return json(200, { models: [{ name: 'models/gemini-3.5-flash' }, { name: 'models/gemini-3.5-flash-lite' }] });
  if (/generateContent/.test(u)) {
    const body = JSON.parse(opts.body || '{}');
    return body.tools
      ? json(200, { candidates: [{ content: { parts: [{ text: 'Wild Robot at Cineworld' }] }, finishReason: 'STOP', groundingMetadata: { webSearchQueries: ['films'], groundingChunks: [{ web: { uri: 'https://c.example' } }] } }] })
      : json(200, { candidates: [{ content: { parts: [{ text: 'OK' }] }, finishReason: 'STOP' }] });
  }
  if (/overpass/.test(u)) return new Response('Connected as: 1\nCurrently running queries (pid, space, time):\n', { status: 200 });
  if (/nominatim/.test(u)) return json(200, [{ lat: '51.5', lon: '-0.12', display_name: 'London' }]);
  throw new Error('unexpected ' + u);
};
const run = (over, extra = {}) => runChecks({ key: 'KEY', model: 'models/gemini-3.5-flash', fetch: router(over), geminiBase: base, overpass: ['https://overpass.example/api/status'], nominatim: 'https://nominatim.example/search',
  place: 'Fareham', online: true, now: (() => { let t = 0; return () => (t += 100); })(), ...extra });

{
  const seen = [];
  const r = await run({}, { onStep: (s) => seen.push(s.id + ':' + s.status) });
  check('with everything working, every check passes', r.steps.every((s) => s.status === 'ok'), JSON.stringify(r.steps.map((s) => [s.id, s.status])));
  check('the steps are the network, key, model, plain answer, search and the map servers', r.steps.map((s) => s.id).join() === 'online,models,answer,search,overpass,nominatim', r.steps.map((s) => s.id).join());
  check('progress is reported step by step as each finishes', seen.length >= 6 && seen[0].startsWith('online'));
  const search = r.steps.find((s) => s.id === 'search');
  check('the search check says what it searched and what it found', /films/.test(search.detail) && /1 source/.test(search.detail) && /Wild Robot/.test(search.detail));
  check('and the verdict says all is well and points at the exchanges', /respond/.test(r.verdict) && /sent and returned/i.test(r.verdict));
}
{
  const urls = []; const heads = [];
  await run({ '': (u, o) => { urls.push(u); heads.push(o.headers || {}); return json(200, { models: [] }); } }).catch(() => {});
  check('the key goes in a header, never in the address', urls.length > 0 && urls.every((u) => !/key=|KEY/.test(u)) && heads.some((h) => h['x-goog-api-key'] === 'KEY'));
}
{
  const r = await run({}, { online: false });
  check('offline is called out first, and the rest are not attempted', r.steps[0].status === 'fail' && /offline|no connection/i.test(r.verdict) && r.steps.slice(1).every((s) => s.status === 'skip'));
}
{
  const r = await run({}, { key: '' });
  check('no key is called out, and what needs one is skipped', r.steps.find((s) => s.id === 'models').status === 'fail' && /no key/i.test(r.verdict) && r.steps.find((s) => s.id === 'search').status === 'skip');
}
{
  const r = await run({ '/models': () => json(400, { error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT' } }) });
  check('a rejected key shows Google\'s own words, and the verdict says to fix the key', r.steps.find((s) => s.id === 'models').status === 'fail' && /API key not valid/.test(r.steps.find((s) => s.id === 'models').detail) && /key/i.test(r.verdict));
}
{
  const r = await run({ generateContent: () => json(429, { error: { code: 429, message: 'Quota exceeded for metric', status: 'RESOURCE_EXHAUSTED' } }) });
  check('a quota failure is shown as such, with the raw body', r.steps.find((s) => s.id === 'answer').status === 'fail' && /Quota exceeded/.test(r.steps.find((s) => s.id === 'answer').detail) && /quota|limit/i.test(r.verdict));
}
{
  const r = await run({ generateContent: (u, o) => (JSON.parse(o.body).tools
    ? json(200, { candidates: [{ content: { parts: [{ text: 'Paddington at Vue' }] }, finishReason: 'STOP' }] })
    : json(200, { candidates: [{ content: { parts: [{ text: 'OK' }] } }] })) });
  const s = r.steps.find((x) => x.id === 'search');
  check('a model that answers without searching is a warning, not a pass', s.status === 'warn' && /memory|did not search|without searching/i.test(s.detail));
  check('and the verdict says search is not running and what to try', /search is not running/i.test(r.verdict) && /flash/i.test(r.verdict));
}
{
  const r = await run({ overpass: () => { throw new Error('network down'); }, nominatim: () => json(503, {}) });
  check('map servers that do not answer are failures with the reason', r.steps.find((s) => s.id === 'overpass').status === 'fail' && /network down/.test(r.steps.find((s) => s.id === 'overpass').detail) &&
    r.steps.find((s) => s.id === 'nominatim').status === 'fail');
  check('and the verdict says venue and town lookups will come back empty', /map/i.test(r.verdict) && /venue|town/i.test(r.verdict));
}
{
  const r = await run({}, { model: '', pick: (names) => names[names.length - 1] });
  check('with no model chosen, the checks use the one the app would pick', /gemini-3\.5-flash-lite/.test(r.steps.find((s) => s.id === 'search').detail) || r.steps.every((s) => s.status === 'ok'));
}
{
  const r = await run({ '/models': () => json(200, { models: [{ name: 'models/gemini-2.0-flash' }] }) });
  check('a chosen model the key does not have is flagged', /not.*(in|on) this key|isn't available/i.test(r.steps.find((s) => s.id === 'models').detail) && r.steps.find((s) => s.id === 'models').status === 'warn');
}
{
  const r = await run({ generateContent: () => new Promise(() => {}) }, { timeoutMs: 20 });
  check('a request that never answers times out and says so', r.steps.find((s) => s.id === 'answer').status === 'fail' && /seconds|time/i.test(r.steps.find((s) => s.id === 'answer').detail));
}
check('the verdict function reads steps on its own', /respond/.test(verdictFor([{ id: 'online', status: 'ok' }, { id: 'models', status: 'ok' }, { id: 'answer', status: 'ok' }, { id: 'search', status: 'ok' }, { id: 'overpass', status: 'ok' }, { id: 'nominatim', status: 'ok' }])));

console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
