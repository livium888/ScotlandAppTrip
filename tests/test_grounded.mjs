// Open-weight models can be grounded. I said otherwise and was wrong.
//
// Llama, Qwen, Mistral and DeepSeek are weights; by themselves they cannot
// search. But grounding is a property of the serving stack, not the weights,
// and several hosts run those same open models with a search tool attached -
// OpenRouter's :online, Groq's compound systems, Perplexity's Sonar. So
// marking the whole OpenAI-compatible provider canGround:false was a
// statement about the endpoint I happened to implement, dressed up as a
// statement about the field.
//
// What this cannot be is trusting. None of those hosts is reachable from
// where this was written, so the response shapes here are recalled rather
// than tested, and the citation check is what makes that acceptable: a
// provider that claims to search and returns nothing to click through to has
// its answers marked, whatever its configuration says.
import { chromium } from 'playwright';
import { goTo, openEventForm } from './lib/screens.mjs';
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

const day = new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10);
const LIST = [{ name: 'Bakewell Farmers Market', date: day, time: '09:00', venue: 'Market Place',
  area: 'Bakewell', what: 'Stalls.', price: 'free' }];

// Three shapes for the same idea, because these hosts do not agree on where
// citations live. Which one the mock returns is switched per scenario.
let shape = 'annotations';
let seen = [];
await page.route(/llm\.example\.test/, (route) => {
  const body = JSON.parse(route.request().postData() || '{}');
  seen.push(body);
  const msg = { content: JSON.stringify(LIST) };
  const out = { choices: [{ message: msg }], usage: { prompt_tokens: 10, completion_tokens: 4 } };
  if (shape === 'annotations') {
    // OpenRouter's web plugin hangs citations off the message.
    msg.annotations = [
      { type: 'url_citation', url_citation: { url: 'https://bakewell.example/on', title: 'What’s on' } },
    ];
  } else if (shape === 'citations') {
    // Perplexity puts a flat list at the top level.
    out.citations = ['https://bakewell.example/on'];
  } else if (shape === 'search_results') {
    out.search_results = [{ url: 'https://bakewell.example/on', title: 'What’s on' }];
  }
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(out) });
});
await page.route(/nominatim/, (route) => route.fulfill({ status: 200, contentType: 'application/json',
  body: JSON.stringify([{ lat: '53.2129', lon: '-1.6753', display_name: 'Bakewell', type: 'town',
    namedetails: { name: 'Bakewell' }, address: { town: 'Bakewell' }, extratags: {} }]) }));
await page.route(/overpass/, (route) => route.fulfill({ status: 200, contentType: 'application/json',
  body: JSON.stringify({ elements: [] }) }));
await page.route(/generativelanguage|wikidata|wikipedia|googleapis\.com\/maps|tile\.|photon/, (r) => r.abort());

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

const OPEN = {
  aiProvider: 'openai',
  aiBaseUrl: 'https://llm.example.test/v1',
  aiModel: 'meta-llama/llama-3.3-70b-instruct:online',
  aiKey: 'x',
  aiGrounded: true,
};

// ---------- Grounding is a setting, not a fact about the vendor ----------
await seed(OPEN);
check('an open provider can be told it searches', await page.evaluate(() => window.__tripTest.aiCanGround()));
await seed(Object.assign({}, OPEN, { aiGrounded: false }));
check('and told it does not', await page.evaluate(() => !window.__tripTest.aiCanGround()));

// ---------- The three shapes citations arrive in ----------
for (const s of ['annotations', 'citations', 'search_results']) {
  shape = s;
  await seed(OPEN);
  const got = await page.evaluate(async () =>
    (await window.__tripTest.callModel('anything', { grounded: true })).sources.length);
  check(`citations are read from ${s}`, got >= 1, `${got} sources`);
}

// ---------- End to end, on an open model ----------
shape = 'annotations';
seen = [];
await seed(OPEN);
await goTo(page, 'events', 400);
await openEventForm(page);
await page.evaluate(() => document.getElementById('evSearch').click());
await page.waitForFunction(() => (window.__tripTest.eventResults || []).length > 0, { timeout: 30000 }).catch(() => {});
await page.waitForFunction(() => !window.__tripTest.eventsBusy || !window.__tripTest.eventsBusy(),
  { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(600);

const r = await page.evaluate(() =>
  (window.__tripTest.eventResults || []).map((e) => ({ n: e.name, uns: !!e.unsourced, src: (e.sources || []).length })));
check('What\'s on works on an open model that can search', r.length >= 1, JSON.stringify(r));
check('and the results are properly sourced, not marked unchecked',
  r.length >= 1 && r.every((x) => !x.uns && x.src >= 1), JSON.stringify(r));
check('and Google was never asked', seen.length > 0);

// ---------- The claim is still only as good as the citations ----------
shape = 'none';
await seed(OPEN);
await goTo(page, 'events', 400);
await openEventForm(page);
await page.evaluate(() => document.getElementById('evSearch').click());
await page.waitForFunction(() => (window.__tripTest.eventResults || []).length > 0, { timeout: 30000 }).catch(() => {});
await page.waitForFunction(() => !window.__tripTest.eventsBusy || !window.__tripTest.eventsBusy(),
  { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(600);
const r2 = await page.evaluate(() =>
  (window.__tripTest.eventResults || []).map((e) => ({ n: e.name, uns: !!e.unsourced })));
check('a provider that claims to search but cites nothing is not believed',
  r2.length >= 1 && r2.every((x) => x.uns), JSON.stringify(r2));

await browser.close();
console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
