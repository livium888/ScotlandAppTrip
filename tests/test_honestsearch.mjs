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
  if (/\/models(\?|$)/.test(route.request().url())) {
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
  const model = (route.request().url().match(/models\/([^:]+):(?:streamGenerateContent|generateContent)/) || [])[1] || '';
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

// ---------- 6. One request, on the model that searches ----------
// The lite model often decides not to search, and asking it first cost two
// paid requests for one answer. Event searches go straight to the full
// flash model - never an image or speech model - and ask once.
await seed();
behaviour = ({ grounded, model }) => !grounded
  ? { text: '[]' }
  : /lite/.test(model)
    ? { text: JSON.stringify([listing('Remembered Gala')]) }
    : { text: JSON.stringify([listing('Folk Evening')]), gm: GM };
await searchOne('hall');
check('every event question tells the model to search, not answer from memory',
  requests.every((r) => !r.grounded || /Search the web for current listings before answering - do not answer from memory/.test(r.prompt)));
check('one request for one kind', requests.filter((r) => r.grounded).length === 1, JSON.stringify(requests.map((r) => r.model)));
check('sent to the full flash model, not the lite one first', requests[0] && requests[0].model === 'gemini-3.5-flash',
  JSON.stringify(requests.map((r) => r.model)));
check('never to an image or speech model', !requests.some((r) => /image|tts/.test(r.model)));
check('and what it searched for is shown', JSON.stringify(await names()) === JSON.stringify(['Folk Evening']),
  JSON.stringify(await names()));

// A model pinned in Settings is the owner's choice - unless it is a lite
// one, which does not search reliably (see 6b).
await seed();
await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('trip-settings-v1'));
  localStorage.setItem('trip-settings-v1', JSON.stringify(Object.assign(s, { geminiModel: 'models/gemini-3.5-pro', geminiModelPinned: true })));
});
behaviour = ({ grounded }) => grounded ? { text: JSON.stringify([listing('Folk Evening')]), gm: GM } : { text: '[]' };
await searchOne('hall');
check('a full model pinned in Settings is used as chosen', requests[0] && requests[0].model === 'gemini-3.5-pro',
  JSON.stringify(requests.map((r) => r.model)));

// ---------- 6b. The key from the trace ----------
// A real trace: both searches went to gemini-3.5-flash-lite, answered "[]"
// in under two seconds and never searched. The ranking put version before
// tier, so a newer lite model beat an older full one.
check('a full flash model outranks a newer lite one', await page.evaluate(() => {
  const s = window.__tripTest.scoreSearchModel;
  return s('models/gemini-2.5-flash') > s('models/gemini-3.5-flash-lite') &&
    s('models/gemini-flash-latest') > s('models/gemini-3.5-flash-lite') &&
    s('models/gemini-3.5-flash') > s('models/gemini-2.5-flash') &&
    s('models/gemini-2.5-flash-image') === -Infinity;
}));
// A lite search model remembered from the old ranking, with nothing chosen
// in Settings: asked again, and replaced by a full one.
await seed();
await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('trip-settings-v1'));
  localStorage.setItem('trip-settings-v1', JSON.stringify(Object.assign(s, {
    geminiModel: 'models/gemini-3.5-flash-lite', geminiSearchModel: 'models/gemini-3.5-flash-lite' })));
});
behaviour = ({ grounded, model }) => grounded && !/lite/.test(model)
  ? { text: JSON.stringify([listing('Folk Evening')]), gm: GM }
  : { text: '[]' };
await searchOne('hall');
check('with nothing chosen, a lite model remembered from before is replaced by a full one',
  requests[0] && requests[0].model === 'gemini-3.5-flash', JSON.stringify(requests.map((r) => r.model)));
check('and finds what is on', (await names()).includes('Folk Evening'), JSON.stringify(await names()));
await page.evaluate(() => document.getElementById('evTrace')?.click());
await page.waitForTimeout(300);
let tr = await page.evaluate(() => document.querySelector('#placeModal .trace-text')?.textContent || '');
check('the trace says which models the key has', /Models on this key: .*gemini-3\.5-flash-lite.*gemini-3\.5-flash/.test(tr), tr.slice(0, 400));
check('and why this one was used', /Why this model: the best search model on this key/.test(tr), (tr.match(/Why this model:.*/) || [''])[0]);
await page.evaluate(() => document.querySelector('#placeModal .modal-close')?.click());

// A model chosen in Settings is used for searches too - whatever it is.
// "I select a model in settings, you need to use that one, end of story."
await seed();
await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('trip-settings-v1'));
  localStorage.setItem('trip-settings-v1', JSON.stringify(Object.assign(s, {
    geminiModel: 'models/gemini-3.5-flash-lite', geminiModelPinned: true })));
});
behaviour = ({ grounded }) => grounded ? { text: JSON.stringify([listing('Folk Evening')]), gm: GM } : { text: '[]' };
await searchOne('hall');
check('a lite model chosen in Settings is the one used to search', requests[0] && requests[0].model === 'gemini-3.5-flash-lite',
  JSON.stringify(requests.map((r) => r.model)));
check('and only that one - no other model is asked', requests.every((r) => r.model === 'gemini-3.5-flash-lite'),
  JSON.stringify(requests.map((r) => r.model)));
await page.evaluate(() => document.getElementById('evTrace')?.click());
await page.waitForTimeout(300);
tr = await page.evaluate(() => document.querySelector('#placeModal .trace-text')?.textContent || '');
check('and the trace says it was chosen in Settings', /Why this model: the model chosen in Settings/.test(tr), (tr.match(/Why this model:.*/) || [''])[0]);
await page.evaluate(() => document.querySelector('#placeModal .modal-close')?.click());

// ---------- 6c. Lines of text, read on the phone ----------
// Asking for JSON switches Google Search off on the Gemini 3 flash models
// (google-gemini/cookbook#1274), which is what the second trace from the
// phone showed. The search is asked for as labelled lines instead, and the
// phone reads them itself: one request, no second one to reformat.
await seed();
const LINES = [
  `- name: Mini Music Makers; venue: Emsworth Community Centre; town: Emsworth; date: ${day}; time: 09:40; ages: 2-4; for children: aimed; price: £; booking: required; link: https://educationthroughmusic.net; what: Early years music; movement and song`,
  `- name: Folk Evening; venue: Town Hall; town: Bakewell; date: ${day}; time: 19:30; price: ££; weekly: yes`,
  '- name: Half-written line; venue: Somewh',
].join('\n');
behaviour = ({ grounded }) => grounded ? { text: LINES, gm: GM } : { text: '[]' };
await searchOne('hall');
check('no event question asks for JSON', requests.every((r) => !r.grounded || !/JSON/.test(r.prompt)),
  (requests[0] || {}).prompt?.slice(-300));
check('the lines are read on the phone, with no second request', requests.length === 1, `${requests.length} requests`);
const parsed = await page.evaluate((t) => window.__tripTest.parseListingLines(t, true), LINES);
check('while it streams, every complete line becomes a listing and the half-written one waits',
  JSON.stringify(parsed.map((x) => x.name)) === JSON.stringify(['Mini Music Makers', 'Folk Evening']), JSON.stringify(parsed.map((x) => x.name)));
const mm = parsed[0] || {};
check('with its time, ages and booking read correctly', mm.time === '09:40' && mm.minAge === 2 && mm.maxAge === 4 && mm.booking === 'required' && mm.childFocus === 'aimed',
  JSON.stringify(mm));
check('a semicolon inside the description does not break the line', /movement and song/.test(mm.what || ''), mm.what);
check('and "weekly: yes" is a weekly event', (parsed[1] || {}).recurring === true);
// This search is in adults mode, so the children's class is filtered out
// and the evening is shown - the lines feed the same filters as before.
check('and they go through the same filters: in adults mode, the evening is shown and the toddler class is not',
  JSON.stringify(await names()) === JSON.stringify(['Folk Evening']), JSON.stringify(await names()));

// ---------- 6d. The fourth trace, word for word ----------
// gemini-3.5-flash-lite chosen in Settings: 2.2 seconds, no search, and
// lines written its own way. Before, both answers were binned and the
// screen showed nothing at all.
const LITE_FILM = '- name; PAW Patrol: The Dino Movie; venue; Vue Portsmouth (Gunwharf Quays); town; Portsmouth; rating; U; for children; aimed; booking; advised; link; https://www.pearlanddean.com/cinemas/vue-portsmouth-gunwharf-quays; what; dinosaur rescue adventure';
const LITE_MUSIC = `- Once Upon a Tune Music Class; Whiteley Community Centre; Whiteley; date (${day}); times (10:15); ages (18 months-6 years); for children (aimed); booking (required); link (https://www.onceuponatune.org/book-now); what (toddler music class)`;
check('a line written "label; value" is read', await page.evaluate((t) => {
  const x = window.__tripTest.parseListingLines(t)[0] || {};
  return x.name === 'PAW Patrol: The Dino Movie' && x.venue === 'Vue Portsmouth (Gunwharf Quays)' && x.rating === 'U' && x.booking === 'advised';
}, LITE_FILM), JSON.stringify(await page.evaluate((t) => window.__tripTest.parseListingLines(t), LITE_FILM)));
check('and so is one with bare name, venue and town and "label (value)"', await page.evaluate((t) => {
  const x = window.__tripTest.parseListingLines(t)[0] || {};
  return x.name === 'Once Upon a Tune Music Class' && x.venue === 'Whiteley Community Centre' && x.area === 'Whiteley' &&
    x.time === undefined && x.times && x.times[0] === '10:15' && x.minAge === 0 && x.maxAge === 6 && /onceuponatune/.test(x.link);
}, LITE_MUSIC), JSON.stringify(await page.evaluate((t) => window.__tripTest.parseListingLines(t), LITE_MUSIC)));

await seed();
await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('trip-settings-v1'));
  localStorage.setItem('trip-settings-v1', JSON.stringify(Object.assign(s, {
    mode: 'kids', geminiModel: 'models/gemini-3.5-flash-lite', geminiModelPinned: true })));
  localStorage.setItem('people-v1', JSON.stringify([{ name: 'A', age: 38 }, { name: 'B', age: 4 }]));
});
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(500);
behaviour = ({ grounded }) => grounded ? { text: LITE_MUSIC } : { text: '[]' };
await searchOne('kidsmusic');
check('an answer Gemini gave from memory is not shown as a result', (await names()).length === 0, JSON.stringify(await names()));
check('but it is not thrown away either: it is set aside, and offered', await page.evaluate(() =>
  /Show the 1 it couldn't confirm/.test(document.getElementById('view').textContent)), (await view()).slice(0, 500));
await page.evaluate(() => document.getElementById('evShowHeld')?.click());
await page.waitForTimeout(400);
check('marked as Gemini\'s memory, to check before going', /Once Upon a Tune/.test(await view()) &&
  /not looked up - Gemini answered from memory/.test(await view()), (await view()).slice(0, 600));
check('and the screen says why, and what would search', /lite model, and lite models usually answer without searching/.test(await view()) &&
  /gemini-3\.5-flash/.test(await view()), (await view()).slice(0, 600));
await page.evaluate(() => document.getElementById('evTrace')?.click());
await page.waitForTimeout(300);
const tr4 = await page.evaluate(() => document.querySelector('#placeModal .trace-text')?.textContent || '');
check('the trace records it as set aside', /Once Upon a Tune.*set aside: Gemini didn't search/.test(tr4), tr4.slice(0, 600));
check('and what the map lookups did', /Map lookups:/.test(tr4) && /towns:/.test(tr4), (tr4.match(/Map lookups:[\s\S]{0,200}/) || [''])[0]);
await page.evaluate(() => document.querySelector('#placeModal .modal-close')?.click());

// ---------- 7. Neither searched: nothing shown, and said plainly ----------
await seed();
behaviour = ({ grounded }) => grounded ? { text: JSON.stringify([listing('Remembered Gala')]) } : { text: '[]' };
await searchOne('hall');
check('when the model will not search, nothing is shown', (await names()).length === 0, JSON.stringify(await names()));
check('and it is not asked a second time behind your back', requests.filter((r) => r.grounded).length === 1,
  `${requests.filter((r) => r.grounded).length} requests`);
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
// The newest good one is back on screen by itself; either way it is kept.
check('while one that was looked up still is - on the list, or back on screen',
  (await offered()).includes('goodkey') || (await names()).includes('Folk Evening'), JSON.stringify(await offered()));
check('and the guessed one is not the one put back on screen', !(await names()).some((n) => /Frozen/.test(n)),
  JSON.stringify(await names()));

await browser.close();
console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
