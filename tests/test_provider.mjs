// Not everyone is going to bring a Gemini key.
//
// Every AI call in the app went to one place, with one key, from one vendor.
// Eight real call sites, all through callGemini. That is fine for one person
// with a key and impossible for anything shipped: whoever runs the inference
// pays, and asking each user to go and get a Google API key is a wall most
// people will not climb.
//
// The load-bearing distinction, and the reason this is not just a swap: five
// of those eight calls send tools:[{google_search:{}}]. They are not asking
// the model what it knows, they are asking it to read the live web and cite
// what it read - which is why every event carries its sources. An open model
// with no search does not return fewer events. It invents them, fluently,
// with a plausible venue and a date. For this app that is the worst failure
// there is: somebody drives forty minutes to an empty car park.
//
// So a provider declares whether it can search, and anything that depends on
// searching refuses rather than guessing.
import { chromium } from 'playwright';
import { goTo } from './lib/screens.mjs';
import fs from 'node:fs';
const SANDBOX_CHROMIUM = '/opt/pw-browsers/chromium';
const LAUNCH_OPTS = fs.existsSync(SANDBOX_CHROMIUM) ? { executablePath: SANDBOX_CHROMIUM } : {};

const BASE = 'http://localhost:8946';
let failures = 0;
const check = (l, c, extra) => { if (c) console.log(`PASS: ${l}`); else { console.log(`FAIL: ${l}${extra ? ' :: ' + extra : ''}`); failures++; } };

const browser = await chromium.launch(LAUNCH_OPTS);
const page = await browser.newPage();
await page.setViewportSize({ width: 390, height: 844 });
page.on('pageerror', (e) => { console.log('PAGEERROR:', e.message); failures++; });

// Two endpoints, so the suite can tell which one was actually asked.
let geminiCalls = [];
let openaiCalls = [];
await page.route(/generativelanguage\.googleapis\.com/, (route) => {
  const url = route.request().url();
  if (/\/models\?/.test(url)) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      models: [{ name: 'models/gemini-3.5-flash-lite', supportedGenerationMethods: ['generateContent'] }] }) });
  }
  geminiCalls.push(JSON.parse(route.request().postData() || '{}'));
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    candidates: [{ content: { parts: [{ text: '[]' }] } }],
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } }) });
});
await page.route(/llm\.example\.test/, (route) => {
  const body = JSON.parse(route.request().postData() || '{}');
  openaiCalls.push(body);
  if (/\/models/.test(route.request().url())) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      data: [{ id: 'llama-3.3-70b' }, { id: 'qwen-2.5-72b' }] }) });
  }
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    choices: [{ message: { content: '[]' } }],
    usage: { prompt_tokens: 12, completion_tokens: 7 } }) });
});
await page.route(/nominatim/, (route) => route.fulfill({ status: 200, contentType: 'application/json',
  body: JSON.stringify([{ lat: '53.2129', lon: '-1.6753', display_name: 'Bakewell', type: 'town',
    namedetails: { name: 'Bakewell' }, address: { town: 'Bakewell' }, extratags: {} }]) }));
await page.route(/overpass/, (route) => route.fulfill({ status: 200, contentType: 'application/json',
  body: JSON.stringify({ elements: [] }) }));
await page.route(/wikidata|wikipedia|googleapis\.com\/maps|tile\.|photon/, (r) => r.abort());

const seed = async (settings) => {
  await page.goto(BASE, { waitUntil: 'load' });
  await page.evaluate((s) => {
    localStorage.clear();
    localStorage.setItem('boards-v1', JSON.stringify({
      activeId: 'b', boards: [{ id: 'b', name: 'Peak', destination: 'Bakewell', dated: true, createdAt: 1 }],
    }));
    localStorage.setItem('board:b:picks', JSON.stringify([
      { id: 'a:1', name: 'Bakewell', city: 'Bakewell', category: 'Town', lat: 53.2129, lon: -1.6753, major: true },
    ]));
    localStorage.setItem('board:b:folders', JSON.stringify(['Bakewell']));
    localStorage.setItem('trip-settings-v1', JSON.stringify(s));
  }, settings);
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(700);
};

const txt = () => page.evaluate(() => document.getElementById('view').textContent.replace(/\s+/g, ' '));

// ---------- There is more than one provider ----------
await seed({ geminiKey: 'g-key' });
const providers = await page.evaluate(() =>
  window.__tripTest && window.__tripTest.AI_PROVIDERS ? Object.keys(window.__tripTest.AI_PROVIDERS) : []);
check('the app knows about more than one provider', providers.length >= 3, JSON.stringify(providers));
check('including an OpenAI-compatible one, which is what open models speak',
  providers.some((k) => /openai|compatible/i.test(k)), JSON.stringify(providers));
check('and a local one that needs no key at all',
  providers.some((k) => /ollama|local/i.test(k)), JSON.stringify(providers));

// ---------- Each says whether it can search the web ----------
const caps = await page.evaluate(() => {
  const p = window.__tripTest.AI_PROVIDERS;
  return Object.keys(p).map((k) => ({ k, ground: !!p[k].canGround, key: !!p[k].needsKey }));
});
check('Gemini is marked as able to search', caps.some((c) => c.k === 'gemini' && c.ground), JSON.stringify(caps));
check('and the open ones are honestly marked as not',
  caps.filter((c) => c.k !== 'gemini').every((c) => !c.ground), JSON.stringify(caps));
check('and the local one needs no key',
  caps.some((c) => /ollama|local/i.test(c.k) && !c.key), JSON.stringify(caps));

// ---------- A reasoning call goes wherever you pointed it ----------
geminiCalls = []; openaiCalls = [];
await seed({ aiProvider: 'openai', aiBaseUrl: 'https://llm.example.test/v1', aiModel: 'llama-3.3-70b', aiKey: 'x' });
await page.evaluate(async () => {
  await window.__tripTest.callModel('say ok', { json: true }).catch(() => {});
});
await page.waitForTimeout(600);
check('a reasoning call reaches the chosen endpoint', openaiCalls.length === 1, `openai:${openaiCalls.length} gemini:${geminiCalls.length}`);
check('and never leaks to Google', geminiCalls.length === 0, `gemini:${geminiCalls.length}`);
check('in the shape that endpoint speaks', await page.evaluate(() => true) && openaiCalls[0] &&
  Array.isArray(openaiCalls[0].messages), JSON.stringify(openaiCalls[0] || {}).slice(0, 160));
check('asking for JSON the way OpenAI-compatible servers want it',
  openaiCalls[0] && openaiCalls[0].response_format && /json/.test(openaiCalls[0].response_format.type),
  JSON.stringify((openaiCalls[0] || {}).response_format));

// ---------- The refusal that matters ----------
await goTo(page, 'events', 400);
await page.evaluate(() => {
  const b = document.getElementById('evEdit') || document.getElementById('evSearch');
  if (b) b.click();
});
await page.waitForTimeout(300);
await page.evaluate(() => {
  const b = document.getElementById('evSearch');
  if (b) b.click();
});
await page.waitForTimeout(1200);

const shown = await txt();
check('a provider that cannot search refuses to look for events',
  /search|ground|cannot|can't|Gemini/i.test(shown) && !/\[\]/.test(shown), shown.slice(0, 300));
check('and says why, rather than just failing',
  /invent|make up|made up|cannot search|no way to check|search the web/i.test(shown), shown.slice(0, 400));
check('and no request was sent to the model that could not answer it',
  openaiCalls.length === 1, `${openaiCalls.length} calls`);

// ---------- The half that does work on an open model ----------
// This is the point of the whole exercise: planning, budgets and trip ideas
// are reasoning over places you already saved. They need no web access, so
// they should not be asking anybody for a Google key.
const gates = await page.evaluate(() => ({
  ready: window.__tripTest.aiReady ? window.__tripTest.aiReady() : null,
  ground: window.__tripTest.aiCanGround(),
}));
check('an open provider with a key counts as set up', gates.ready === true, JSON.stringify(gates));
check('while still being honest that it cannot search', gates.ground === false, JSON.stringify(gates));

openaiCalls = [];
await goTo(page, 'itinerary', 400);
const planned = await page.evaluate(async () => {
  const before = document.body.textContent;
  const b = document.getElementById('tripIdeaBtn') || document.getElementById('autoPlanBtn');
  if (!b) return 'no button';
  b.click();
  await new Promise((r) => setTimeout(r, 600));
  return document.body.textContent === before ? 'nothing happened' : 'something happened';
});
check('planning does not send you to Settings for a Gemini key you do not need',
  !/Add a Gemini key|Gemini key field/i.test(await page.evaluate(() => document.body.textContent)),
  planned);

// ---------- Usage is still counted, whoever answered ----------
const usage = await page.evaluate(() => JSON.parse(localStorage.getItem('ai-usage-v1') || 'null'));
check('tokens are counted for the open provider too',
  usage && usage.total && usage.total.inTokens >= 12, JSON.stringify(usage && usage.total));

await browser.close();
console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
