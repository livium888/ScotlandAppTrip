// "Test search" in Settings.
//
// Gemini decides for itself whether to use the Google Search it is offered,
// and the traces from a real phone showed the lite model answering in two
// seconds without looking, while a full flash model took twenty and found a
// real listing. This button settles it for a given key and model in one
// request: one question that needs the web, and whether it was searched.
import { chromium } from 'playwright';
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

const asked = [];
let broken = false;
await page.route(/generativelanguage\.googleapis\.com/, (route) => {
  const url = route.request().url();
  if (/\/models\?/.test(url)) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      models: [{ name: 'models/gemini-3.5-flash-lite', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/gemini-3.5-flash', supportedGenerationMethods: ['generateContent'] }] }) });
  }
  if (broken) return route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ error: { code: 429, message: 'Quota exceeded', status: 'RESOURCE_EXHAUSTED' } }) });
  const body = JSON.parse(route.request().postData() || '{}');
  const model = (url.match(/models\/([^:]+):/) || [])[1] || '';
  asked.push({ model, tools: !!(body.tools && body.tools.length), prompt: body.contents[0].parts[0].text });
  const cand = /lite/.test(model)
    ? { content: { parts: [{ text: 'Paddington in Peru at Vue Portsmouth (vue.com)' }] } }
    : { content: { parts: [{ text: 'The Wild Robot at Cineworld Whiteley (cineworld.co.uk)' }] },
        groundingMetadata: { webSearchQueries: ['films showing Fareham this week', 'Cineworld Whiteley listings'],
          groundingChunks: [{ web: { uri: 'https://cineworld.co.uk/whiteley', title: 'Cineworld' } }] } };
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ candidates: [cand] }) });
});
await page.route(/nominatim|overpass|wikidata|wikipedia|tile\.|photon|open-meteo/, (r) => r.abort());

const seed = async (settings) => {
  asked.length = 0;
  await page.goto(BASE, { waitUntil: 'load' });
  await page.evaluate((s) => {
    localStorage.clear();
    localStorage.setItem('onboarded-v1', '1');
    localStorage.setItem('boards-v1', JSON.stringify({
      activeId: 'b', boards: [{ id: 'b', name: 'Hampshire', destination: 'Fareham', dated: true, createdAt: 1 }] }));
    localStorage.setItem('trip-settings-v1', JSON.stringify(s));
  }, settings);
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(400);
  await page.click('#settingsBtn');
  await page.waitForTimeout(400);
};
const result = () => page.evaluate(() => {
  const el = document.getElementById('searchTestResult');
  return { text: el ? el.textContent : '', cls: el ? el.className : '', hidden: el ? el.hidden : true };
});
const runTest = async () => {
  await page.evaluate(() => document.getElementById('testSearchBtn').click());
  await page.waitForFunction(() => !/Asking/.test(document.getElementById('searchTestResult').textContent), null, { timeout: 20000 });
};

// ---------- Before any models are known ----------
await seed({ geminiKey: 'k' });
check('the button waits until the key has been tested and its models are known',
  await page.evaluate(() => document.getElementById('testSearchBtn')?.disabled === true));
await page.click('#testGeminiBtn');
await page.waitForTimeout(800);
check('and comes on once they are', await page.evaluate(() => document.getElementById('testSearchBtn')?.disabled === false));

// ---------- A lite model that answers from memory ----------
await seed({ geminiKey: 'k', geminiModels: ['models/gemini-3.5-flash-lite', 'models/gemini-3.5-flash'],
  geminiModel: 'models/gemini-3.5-flash-lite', geminiModelPinned: true });
await runTest();
let r = await result();
check('it asks the model selected in the picker, with search offered', asked.length === 1 &&
  asked[0].model === 'gemini-3.5-flash-lite' && asked[0].tools, JSON.stringify(asked));
check('one question that needs the web, about the trip\'s own place', /film showing at a cinema in or near Fareham this week/.test(asked[0].prompt));
check('a lite model that did not search is reported plainly', /✗ gemini-3\.5-flash-lite answered from memory without searching/.test(r.text) &&
  /bad/.test(r.cls), r.text);
check('with what that means for event searches, and what to try', /set aside as unconfirmed/.test(r.text) && /try a full flash model/.test(r.text));
check('and how long it took', /in \d+\.\ds/.test(r.text));

// ---------- A full model that searches ----------
await page.evaluate(() => {
  const sel = document.getElementById('setGeminiModel');
  sel.value = 'models/gemini-3.5-flash';
  sel.dispatchEvent(new Event('change'));
});
await runTest();
r = await result();
check('after picking another model, the test asks that one', asked[1] && asked[1].model === 'gemini-3.5-flash', JSON.stringify(asked.map((a) => a.model)));
check('a model that searched says so', /✓ gemini-3\.5-flash searched the web/.test(r.text) && /ok/.test(r.cls), r.text);
check('with the Google searches it ran and how many sources', /2 Google searches: films showing Fareham this week \| Cineworld Whiteley listings/.test(r.text) &&
  /1 source/.test(r.text), r.text);
check('and its answer', /The Wild Robot at Cineworld Whiteley/.test(r.text));

// ---------- A failure says why ----------
broken = true;
await runTest();
r = await result();
check('a request that fails says why rather than hanging', /The test didn't work/.test(r.text) && /bad/.test(r.cls), r.text);
check('and the button is usable again', await page.evaluate(() => document.getElementById('testSearchBtn').disabled === false));

await browser.close();
console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
