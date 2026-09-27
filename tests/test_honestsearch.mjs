// "The search function doesn't work, I keep seeing this": a Find screen whose
// every result was flagged "Nothing here was looked up. The model answered
// without searching" - a stage Frozen "performed by local theatre talent"
// with no times, and eight films with no rating.
//
// Each kind was asked twice: first with Google Search on, then, if that
// reply was late (45 seconds, on a phone, for a week of listings) or came
// back as prose, the same question with search off - and whatever that
// produced was shown as results. So the app's most common failure looked
// like success, filled with what a model believes is on.
//
// Now: event searches are only ever answered by a search. A searched reply
// that cannot be read is rewritten into the list format, keeping its
// sources. A search that fails says it failed, and why. Searches get longer
// than 45 seconds. And a week-old cache of guessed answers is not served.
import { chromium } from 'playwright';
import { goTo, openEventForm } from './lib/screens.mjs';
import { angleFromPrompt } from './lib/angles.mjs';
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
// What each test wants the model to do, by whether search was switched on.
let behaviour = null;
let requests = [];
await page.route(/generativelanguage\.googleapis\.com/, async (route) => {
  if (/\/models\?/.test(route.request().url())) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      // What a real key lists: the cheap lite model the app uses day to
      // day, a full flash model, and ones that are not text models at all.
      models: [
        { name: 'models/gemini-3.5-flash-lite', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/gemini-3.5-flash', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/gemini-3.5-flash-image', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/gemini-3.5-flash-preview-tts', supportedGenerationMethods: ['generateContent'] },
      ] }) });
  }
  const model = (route.request().url().match(/models\/([^:]+):generateContent/) || [])[1] || '';
  const body = JSON.parse(route.request().postData() || '{}');
  const prompt = body.contents[0].parts[0].text;
  const grounded = !!(body.tools && body.tools.length);
  const json = !!(body.generationConfig && body.generationConfig.responseMimeType);
  requests.push({ grounded, json, prompt, model, angle: angleFromPrompt(prompt) });
  const r = await behaviour({ grounded, json, prompt, model });
  if (r.delay) await new Promise((res) => setTimeout(res, r.delay));
  if (r.status) return route.fulfill({ status: r.status, contentType: 'application/json', body: JSON.stringify({ error: { message: 'boom' } }) });
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    candidates: [{ content: { parts: [{ text: r.text }] }, groundingMetadata: r.gm || {} }] }) });
});
await page.route(/nominatim/, (route) => route.fulfill({ status: 200, contentType: 'application/json',
  body: JSON.stringify([{ lat: '53.2129', lon: '-1.6753', display_name: 'Bakewell', type: 'town',
    namedetails: { name: 'Bakewell' }, address: { town: 'Bakewell' }, extratags: {} }]) }));
await page.route(/overpass/, (route) => route.fulfill({ status: 200, contentType: 'application/json',
  body: JSON.stringify({ elements: [] }) }));
await page.route(/wikidata|wikipedia|googleapis\.com\/maps|tile\.|photon|open-meteo/, (r) => r.abort());

const seed = async (cache) => {
  await page.goto(BASE, { waitUntil: 'load' });
  await page.evaluate((c) => {
    localStorage.clear();
    localStorage.setItem('onboarded-v1', '1');
    localStorage.setItem('boards-v1', JSON.stringify({
      activeId: 'b', boards: [{ id: 'b', name: 'Peak', destination: 'Bakewell', dated: true, createdAt: 1 }] }));
    localStorage.setItem('board:b:picks', JSON.stringify([
      { id: 'a:1', name: 'Bakewell', city: 'Bakewell', category: 'Town', lat: 53.2129, lon: -1.6753, major: true }]));
    localStorage.setItem('board:b:folders', JSON.stringify(['Bakewell']));
    localStorage.setItem('trip-settings-v1', JSON.stringify({ geminiKey: 'k', mode: 'adults' }));
    if (c) localStorage.setItem('event-cache-v1', JSON.stringify(c));
  }, cache || null);
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(600);
};
// One kind only, so each case is one question.
const searchOne = async (kind, maxWait) => {
  requests = [];
  await goTo(page, 'events', 400);
  await page.evaluate((k) => window.__tripTest.setEventKinds([k]), kind);
  await openEventForm(page);
  await page.evaluate(() => document.getElementById('evSearch').click());
  await page.waitForFunction(() => document.querySelector('.ev-angle-done, .ev-angle-failed'),
    null, { timeout: maxWait || 30000 }).catch(() => {});
  await page.waitForTimeout(1200);
};
const names = () => page.evaluate(() => (window.__tripTest.eventResults || []).map((e) => e.name));
const view = () => page.evaluate(() => document.getElementById('view').textContent.replace(/\s+/g, ' '));
const listing = (name) => ({ name, date: day, time: '19:30', venue: 'Town Hall', area: 'Bakewell', what: 'A thing.', price: '£' });
const GM = { webSearchQueries: ['what is on bakewell'], groundingChunks: [{ web: { uri: 'https://bakewell.example/on', title: 'On' } }] };

// ---------- 1. The search fails: nothing is made up ----------
await seed();
behaviour = ({ grounded }) => grounded
  ? { status: 500 }
  // What the old fallback got, and showed.
  : { text: JSON.stringify([listing('Invented Quiz Night')]) };
await searchOne('hall');
check('when the search fails, no question is asked with search switched off',
  requests.length >= 1 && requests.every((r) => r.grounded),
  JSON.stringify(requests.map((r) => ({ g: r.grounded, j: r.json }))));
check('and nothing is shown', (await names()).length === 0, JSON.stringify(await names()));
check('instead it says the search did not work, and why', /Village hall & church: the search didn't work/.test(await view()),
  (await view()).slice(0, 300));
check('with a way to try it again', await page.evaluate(() => !!document.querySelector('[data-ev-retry="hall"]')));
check('and never claims a model answered from memory', !/Nothing here was looked up/.test(await view()));

// ---------- 2. The search answers in prose: rewritten, not re-asked ----------
await seed();
const PROSE = 'Here is what I found on in Bakewell this week: a Folk Evening at the Town Hall on ' +
  `${day} at 19:30, tickets £8; and a Talk on Lead Mining at the library.`;
behaviour = ({ grounded, json, prompt }) => grounded
  ? { text: PROSE, gm: GM }
  : json && /Rewrite it as data/.test(prompt) && prompt.includes('Folk Evening')
    ? { text: JSON.stringify([listing('Folk Evening')]) }
    : { text: JSON.stringify([listing('Invented Quiz Night')]) };
await searchOne('hall');
const rewrite = requests.find((r) => !r.grounded);
check('a searched reply that is prose is rewritten into a list', !!rewrite && rewrite.json && /Rewrite it as data/.test(rewrite.prompt),
  JSON.stringify(requests.map((r) => ({ g: r.grounded, j: r.json }))));
check('from the text the search found, not from the original question',
  !!rewrite && rewrite.prompt.includes(PROSE) && /do not add events/.test(rewrite.prompt));
check('and what it found is shown', JSON.stringify(await names()) === JSON.stringify(['Folk Evening']), JSON.stringify(await names()));
check('as looked up, with its source kept', !/Nothing here was looked up/.test(await view()) &&
  await page.evaluate(() => (window.__tripTest.eventResults || [])[0]?.sources?.[0]?.uri === 'https://bakewell.example/on'));

// ---------- 3. Searched, but no page to cite: not "from memory" ----------
await seed();
behaviour = ({ grounded }) => grounded
  ? { text: JSON.stringify([listing('Folk Evening')]), gm: { webSearchQueries: ['bakewell events'] } }
  : { text: '[]' };
await searchOne('hall');
check('a reply that searched but cited no page is not called unsearched',
  (await names()).includes('Folk Evening') && !/Nothing here was looked up/.test(await view()) &&
  await page.evaluate(() => !(window.__tripTest.eventResults || [])[0]?.unsourced), (await view()).slice(0, 300));

// ---------- 4. A slow search is waited for ----------
// A week of cinema listings, read by a searching model on a phone, took
// longer than the 45 seconds everything else is given.
await seed();
behaviour = ({ grounded }) => grounded
  ? { delay: 50000, text: JSON.stringify([listing('Late Folk Evening')]), gm: GM }
  : { text: JSON.stringify([listing('Invented Quiz Night')]) };
await searchOne('hall', 90000);
check('a search that takes fifty seconds is still waited for, not replaced with a guess',
  JSON.stringify(await names()) === JSON.stringify(['Late Folk Evening']), JSON.stringify(await names()));

// ---------- 6. Gemini skipped the search: the stronger model is asked ----------
// What the phone showed after the first fix: search on, offered, unused.
// Google leaves the search to the model, and the lite tier often decides it
// already knows what is on.
await seed();
behaviour = ({ grounded, model }) => !grounded
  ? { text: '[]' }
  : /lite/.test(model)
    ? { text: JSON.stringify([listing('Remembered Gala')]) } // no grounding metadata: did not search
    : { text: JSON.stringify([listing('Folk Evening')]), gm: GM };
await searchOne('hall');
check('every event question tells the model to search, not answer from memory',
  requests.every((r) => !r.grounded || /Search the web for current listings before answering - do not answer from memory/.test(r.prompt)));
check('an answer given without searching is not used', !(await names()).includes('Remembered Gala'), JSON.stringify(await names()));
check('the same question goes to the full flash model', requests.some((r) => r.grounded && r.model === 'gemini-3.5-flash'),
  JSON.stringify(requests.map((r) => r.model)));
check('never to an image or speech model', !requests.some((r) => /image|tts/.test(r.model)));
check('and what that one searched for is shown', JSON.stringify(await names()) === JSON.stringify(['Folk Evening']),
  JSON.stringify(await names()));

// ---------- 7. Neither searched: nothing shown, and said plainly ----------
await seed();
behaviour = ({ grounded }) => grounded ? { text: JSON.stringify([listing('Remembered Gala')]) } : { text: '[]' };
await searchOne('hall');
check('when no model will search, nothing is shown', (await names()).length === 0, JSON.stringify(await names()));
check('and the screen says it answered from memory, so nothing was used', /answered from memory/.test(await view()),
  (await view()).slice(0, 300));
check('with the retry button', await page.evaluate(() => !!document.querySelector('[data-ev-retry="hall"]')));

// ---------- 5. A remembered search of guesses is not served ----------
const cached = {
  at: Date.now() - 3600e3,
  results: [Object.assign(listing("Disney's Frozen"), { startsAt: new Date(Date.now() + 2 * 864e5).toISOString(), unsourced: true, sources: [] })],
  dropped: {}, held: [], meta: { centre: 'Bakewell', lat: 53.2129, lon: -1.6753, miles: 25, when: 'week', kinds: ['hall'] },
};
const good = JSON.parse(JSON.stringify(cached));
good.results[0].name = 'Folk Evening';
good.results[0].unsourced = false;
good.results[0].sources = [{ uri: 'https://bakewell.example/on', title: 'On' }];
await seed({ oldkey: cached, goodkey: good });
await goTo(page, 'events', 500);
const offered = () => page.evaluate(() => [...document.querySelectorAll('[data-recent]')].map((b) => b.getAttribute('data-recent')));
check('a search remembered from before, where nothing was looked up, is not offered again',
  !(await offered()).includes('oldkey'), JSON.stringify(await offered()));
check('while one that was looked up still is', (await offered()).includes('goodkey'), JSON.stringify(await offered()));

await browser.close();
console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
