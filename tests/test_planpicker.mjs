// "Plan my days for me" used to take every saved place, send the lot, and
// write whatever came back straight into the itinerary.
//
// Three things wrong with that. There was no way to say "just the Perthshire
// ones this time" - planning is usually done a region at a time. It never said
// what it could not do, so a place four hours away simply did not appear,
// which looks identical to the model forgetting it. And it overwrote the plan
// on arrival, so an afternoon of arranging days by hand was gone before you
// had read the result.
import { chromium } from 'playwright';
import fs from 'node:fs';
const SANDBOX_CHROMIUM = '/opt/pw-browsers/chromium';
const LAUNCH_OPTS = fs.existsSync(SANDBOX_CHROMIUM) ? { executablePath: SANDBOX_CHROMIUM } : {};

const BASE = 'http://localhost:8946';
let failures = 0;
const check = (l, c, extra) => { if (c) console.log(`PASS: ${l}`); else { console.log(`FAIL: ${l}${extra ? ' :: ' + extra : ''}`); failures++; } };

const browser = await chromium.launch(LAUNCH_OPTS);
const page = await browser.newPage();
await page.setViewportSize({ width: 390, height: 820 });
page.on('pageerror', (e) => { console.log('PAGEERROR:', e.message); failures++; });

// Two clusters an hour and a half apart, which is the situation the feedback
// exists for: they cannot share a day, and saying so is the useful part.
const PERTH = [
  ['Blair Castle', 56.7658, -3.8489, 'Blair Atholl'],
  ['Dunkeld Cathedral', 56.5647, -3.5906, 'Blair Atholl'],
  ['The Taybank', 56.5650, -3.5900, 'Blair Atholl'],
  ['Killiecrankie', 56.7333, -3.7833, 'Blair Atholl'],
];
const EDIN = [
  ['Edinburgh Castle', 55.9486, -3.1999, 'Edinburgh'],
  ['Camera Obscura', 55.9489, -3.1959, 'Edinburgh'],
  ['Dynamic Earth', 55.9506, -3.1749, 'Edinburgh'],
];
const PICKS = PERTH.concat(EDIN).map(([name, lat, lon, city], i) => ({
  id: `custom:${name}`, name, city, category: 'Attraction', lat, lon, addedAt: i + 1,
}));

let prompts = [];
let reply = () => ({});
await page.route(/generativelanguage\.googleapis\.com/, (route) => {
  if (/\/models\?/.test(route.request().url())) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      models: [{ name: 'models/gemini-3.5-flash-lite', supportedGenerationMethods: ['generateContent'] }] }) });
  }
  const body = JSON.parse(route.request().postData() || '{}');
  const prompt = body.contents[0].parts[0].text;
  prompts.push({ text: prompt, json: (body.generationConfig || {}).responseMimeType || '', grounded: !!body.tools });
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    candidates: [{ content: { parts: [{ text: JSON.stringify(reply(prompt)) }] } }] }) });
});
await page.route(/nominatim|wikidata|wikipedia|overpass|tile\.|open-meteo|photon|places\.googleapis/, (r) => r.abort());

const readPlan = () => page.evaluate(() => JSON.parse(localStorage.getItem('board:b-pp:plan') || '{"days":[],"items":{}}'));
const bodyText = () => page.evaluate(() => document.getElementById('planOverlay').textContent);

async function seed(items) {
  await page.evaluate(([picks, plan]) => {
    localStorage.clear();
    localStorage.setItem('boards-v1', JSON.stringify({
      activeId: 'b-pp', boards: [{ id: 'b-pp', name: 'Picker', destination: 'Scotland', dated: true, hasGuide: false, createdAt: 1 }],
    }));
    localStorage.setItem('trip-settings-v1', JSON.stringify({
      destination: 'Scotland', geminiKey: 'KEY', geminiModel: 'models/gemini-3.5-flash-lite',
      travellers: 'family of 3, 4-year-old who walks',
    }));
    localStorage.setItem('board:b-pp:folders', JSON.stringify(['Blair Atholl', 'Edinburgh']));
    localStorage.setItem('board:b-pp:picks', JSON.stringify(picks));
    localStorage.setItem('board:b-pp:plan', JSON.stringify(plan));
  }, [PICKS, items]);
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(300);
  await page.evaluate(() => document.querySelector('[data-view="itinerary"]').click());
  await page.waitForTimeout(400);
}

const openPicker = async () => {
  await page.evaluate(() => document.getElementById('autoPlanBtn').click());
  await page.waitForSelector('#planOverlay.open', { timeout: 4000 });
};
const tapArea = (name) => page.evaluate((n) => {
  const el = Array.from(document.querySelectorAll('[data-plan-area]')).find((b) => b.getAttribute('data-plan-area') === n);
  if (!el) throw new Error(`no area "${n}"`);
  el.click();
}, name);
const selectedCount = () => page.evaluate(() => document.querySelectorAll('.planner-place.on').length);

await page.goto(BASE, { waitUntil: 'load' });
await seed({ days: [{ id: 'd1', label: 'Day 1 · Wed 19 Aug' }, { id: 'd2', label: 'Day 2 · Thu 20 Aug' }], items: {} });

// ---------- Choosing what to plan ----------

await openPicker();
check('the places are offered grouped by the area they are in', await page.evaluate(() =>
  document.querySelectorAll('[data-plan-area]').length === 2));
check('and every place can be picked on its own', await page.evaluate(() =>
  document.querySelectorAll('[data-plan-pick]').length === 7));
check('with nothing scheduled yet, everything starts selected', (await selectedCount()) === 7);

await page.evaluate(() => document.querySelector('[data-plan-none]').click());
await page.waitForTimeout(200);
check('clearing clears', (await selectedCount()) === 0);
check('and there is nothing to plan', await page.evaluate(() =>
  document.querySelector('[data-plan-run]').disabled === true));

// A whole location in one tap - the thing that was impossible before.
await tapArea('Blair Atholl');
await page.waitForTimeout(200);
check('one tap takes a whole area', (await selectedCount()) === 4, String(await selectedCount()));
check('and the area shows it is fully in', await page.evaluate(() =>
  !!document.querySelector('.planner-area-head.on')));
await tapArea('Blair Atholl');
await page.waitForTimeout(200);
check('tapping it again takes it back out', (await selectedCount()) === 0);

await tapArea('Blair Atholl');
await page.evaluate(() => document.querySelector('[data-plan-pick]').click());
await page.waitForTimeout(200);
check('a part-selected area says so rather than looking empty', await page.evaluate(() =>
  !!document.querySelector('.planner-area-head.part')));

// ---------- What it was asked, and what it says back ----------

await page.evaluate(() => document.querySelector('[data-plan-none]').click());
await tapArea('Blair Atholl');
await tapArea('Edinburgh');
await page.waitForTimeout(200);

prompts = [];
reply = () => ({
  days: [
    { day: 1, stops: [
      { name: 'Blair Castle', time: '10:00', why: 'Opens at ten and the grounds take a morning.' },
      { name: 'Killiecrankie', time: '14:00', why: 'Ten minutes down the road.' },
    ] },
    { day: 2, stops: [
      { name: 'Edinburgh Castle', time: '10:00', why: 'First thing, before the queues.' },
      { name: 'Camera Obscura', time: '13:30', why: 'Two minutes away and indoors if it rains.' },
    ] },
  ],
  leftOut: [
    { name: 'Dunkeld Cathedral', reason: 'An hour off the Edinburgh day and it would make Day 1 too long.' },
    { name: 'The Taybank', reason: 'Same detour as the cathedral.' },
  ],
  notes: 'Two days works, but only because each day stays in one place.',
  separateTrips: [
    { title: 'Dunkeld in a day', why: 'The cathedral and lunch by the river make an easy day of their own.',
      days: 1, places: ['Dunkeld Cathedral', 'The Taybank'] },
  ],
});
await page.evaluate(() => document.querySelector('[data-plan-run]').click());
await page.waitForSelector('.planner-day', { timeout: 8000 });

const asked = prompts[0] || { text: '' };
check('it is asked to arrange only what was chosen', /Blair Castle/.test(asked.text) && /Edinburgh Castle/.test(asked.text));
check('with the coordinates, so "close together" means something',
  /56\.7658,-3\.8489/.test(asked.text), asked.text.slice(0, 300));
check('and asked to say what it left out and why',
  /what you left out and why/.test(asked.text));
check('and to propose separate trips rather than squeezing them in',
  /separate trips/.test(asked.text));
check('asked in JSON mode rather than being asked nicely in prose',
  /json/.test(asked.json) && !asked.grounded, JSON.stringify({ json: asked.json, grounded: asked.grounded }));

check('the days come back with their stops', await page.evaluate(() =>
  document.querySelectorAll('.planner-day').length === 2));
check('each stop says why it sits there', /before the queues/.test(await bodyText()));
check('what was left out is listed, with the reason',
  /Dunkeld Cathedral/.test(await bodyText()) && /would make Day 1 too long/.test(await bodyText()));
check('and there is an honest word on the whole thing',
  /only because each day stays in one place/.test(await bodyText()));

// ---------- Nothing has changed yet ----------

check('the itinerary is untouched until you say so',
  Object.keys((await readPlan()).items || {}).length === 0, JSON.stringify((await readPlan()).items));
check('and the screen says as much', await page.evaluate(() =>
  /Nothing has changed yet/.test(document.getElementById('planOverlay').textContent)));

// ---------- Too much for the days: a trip of its own ----------

check('the surplus comes back as a trip rather than being dropped', await page.evaluate(() =>
  !!document.querySelector('[data-plan-trip]')));
check('named, explained, and with its places listed',
  /Dunkeld in a day/.test(await bodyText()) && /easy day of their own/.test(await bodyText()));

// ---------- Applying it ----------

await page.evaluate(() => document.querySelector('[data-plan-apply]').click());
await page.waitForTimeout(1200);
const applied = await readPlan();
const names = (dayId) => (applied.items[dayId] || []).map((it) => it.pickId.replace('custom:', ''));
check('now the days are filled', names('d1').join(',') === 'Blair Castle,Killiecrankie', JSON.stringify(names('d1')));
check('with the times it suggested',
  (applied.items.d1 || []).some((it) => it.time === '10:00'), JSON.stringify(applied.items.d1));
check('and the second day too', names('d2').join(',') === 'Edinburgh Castle,Camera Obscura', JSON.stringify(names('d2')));
check('and it drops you on the itinerary', await page.evaluate(() =>
  document.getElementById('view').dataset.activeTab === 'itinerary'));

// ---------- Adding the separate trip ----------

await openPicker();
await page.evaluate(() => document.querySelector('[data-plan-none]').click());
await tapArea('Blair Atholl');
await tapArea('Edinburgh');
await page.evaluate(() => document.querySelector('[data-plan-run]').click());
await page.waitForSelector('[data-plan-trip]', { timeout: 8000 });
await page.evaluate(() => document.querySelector('[data-plan-trip]').click());
await page.waitForTimeout(1500);

const withTrip = await readPlan();
check('a proposed trip becomes real days on the end', withTrip.days.length === 3,
  JSON.stringify(withTrip.days.map((d) => d.label)));
const third = withTrip.days[2];
check('with its places on them',
  (withTrip.items[third.id] || []).some((it) => /Dunkeld|Taybank/.test(it.pickId)),
  JSON.stringify(withTrip.items[third.id]));

// ---------- A day the arithmetic says is too much ----------
// The model's own opinion of its plan is not evidence. This is measured from
// the coordinates, so it disagrees when it should.

await seed({ days: [{ id: 'd1', label: 'Day 1 · Wed 19 Aug' }], items: {} });
reply = () => ({
  days: [{ day: 1, stops: [
    { name: 'Blair Castle', time: '09:00', why: '' },
    { name: 'Edinburgh Castle', time: '12:00', why: '' },
    { name: 'Dunkeld Cathedral', time: '15:00', why: '' },
    { name: 'Camera Obscura', time: '17:00', why: '' },
  ] }],
  leftOut: [],
  notes: 'A full but achievable day.',
  separateTrips: [],
});
await openPicker();
await page.evaluate(() => document.querySelector('[data-plan-run]').click());
await page.waitForSelector('.planner-day', { timeout: 8000 });
check('a day with 200 miles of driving in it is flagged, whatever the model called it',
  await page.evaluate(() => !!document.querySelector('.planner-warn')), await bodyText());
check('and it says how much driving that is',
  /driving between stops/.test(await bodyText()), await bodyText());

// ---------- The answer wrapped in an array ----------
// Reported from the real model: a perfectly good plan inside [ { "days": … } ].
// Failing on that is a bug in the reader, not the reply.

await seed({ days: [{ id: 'd1', label: 'Day 1 · Wed 19 Aug' }], items: {} });
reply = () => [{
  days: [{ day: 1, stops: [{ name: 'Edinburgh Castle', time: '09:00', why: 'Before the queues.' }] }],
  leftOut: [{ name: 'Blair Castle', reason: 'Ninety minutes north of the rest.' }],
  notes: 'One day, one city.',
  separateTrips: [],
}];
await openPicker();
await page.evaluate(() => document.querySelector('[data-plan-run]').click());
await page.waitForSelector('.planner-day', { timeout: 8000 });
check('a plan wrapped in an array is still a plan',
  /Edinburgh Castle/.test(await bodyText()), (await bodyText()).slice(0, 200));
check('with everything else it said intact',
  /Ninety minutes north/.test(await bodyText()) && /One day, one city/.test(await bodyText()));

// A flat list of assignments is not a wrapper and must not be unwrapped.
await seed({ days: [{ id: 'd1', label: 'Day 1 · Wed 19 Aug' }], items: {} });
reply = () => [{ day: 1, name: 'Edinburgh Castle', time: '09:00' }];
await openPicker();
await page.evaluate(() => document.querySelector('[data-plan-run]').click());
await page.waitForSelector('.planner-day', { timeout: 8000 });
check('a bare list of assignments is read as one', /Edinburgh Castle/.test(await bodyText()),
  (await bodyText()).slice(0, 200));

// ---------- An answer cut off by the output limit ----------
// Reported from the real model: a plan that stops mid-word, because the reply
// ran past its token cap. Everything before the cut is perfectly good, and
// giving up on all of it is a bug in the reader.

await seed({ days: [{ id: 'd1', label: 'Day 1 · Wed 19 Aug' }], items: {} });
reply = () => 'TRUNCATED';
await page.unroute(/generativelanguage\.googleapis\.com/);
await page.route(/generativelanguage\.googleapis\.com/, (route) => {
  if (/\/models\?/.test(route.request().url())) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      models: [{ name: 'models/gemini-3.5-flash-lite', supportedGenerationMethods: ['generateContent'] }] }) });
  }
  const body = JSON.parse(route.request().postData() || '{}');
  prompts.push({ text: body.contents[0].parts[0].text, maxTokens: (body.generationConfig || {}).maxOutputTokens || 0 });
  // Exactly the shape that was on screen: cut off mid-key.
  const text = '{ "days": [ { "day": 1, "stops": [ { "name": "Edinburgh Castle", "time": "09:30", "w';
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    candidates: [{ content: { parts: [{ text }] } }] }) });
});
prompts = [];
await openPicker();
await page.evaluate(() => document.querySelector('[data-plan-run]').click());
await page.waitForSelector('.planner-day', { timeout: 8000 });
check('a plan cut off mid-word keeps everything before the cut',
  /Edinburgh Castle/.test(await bodyText()), (await bodyText()).slice(0, 200));
check('and the time it had already given',
  /09:30/.test(await bodyText()), (await bodyText()).slice(0, 200));
check('the request asks for as much room as the trip planner does',
  (prompts[0] || {}).maxTokens >= 8192, JSON.stringify(prompts[0] && prompts[0].maxTokens));

// ---------- Names as the model writes them ----------
// It is asked for exact names and mostly gives them. It also drops a "The",
// adds the town, or lengthens the name - and matching on the exact string
// meant one paraphrase threw the whole plan away.

await seed({ days: [{ id: 'd1', label: 'Day 1 · Wed 19 Aug' }], items: {} });
await page.unroute(/generativelanguage\.googleapis\.com/);
await page.route(/generativelanguage\.googleapis\.com/, (route) => {
  if (/\/models\?/.test(route.request().url())) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      models: [{ name: 'models/gemini-3.5-flash-lite', supportedGenerationMethods: ['generateContent'] }] }) });
  }
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    candidates: [{ content: { parts: [{ text: JSON.stringify({
      days: [{ day: 1, stops: [
        { name: 'Edinburgh Castle, Castlehill', time: '10:00', why: 'The town appended.' },
        { name: 'Camera Obscura and World of Illusions', time: '13:00', why: 'The full name.' },
        { name: 'Dynamic Earth', time: '15:00', why: 'Exact.' },
      ] }],
      leftOut: [{ name: 'The Taybank', reason: 'Too far.' }],
      notes: '',
      separateTrips: [],
    }) }] } }] }) });
});
await openPicker();
await page.evaluate(() => document.querySelector('[data-plan-run]').click());
await page.waitForSelector('.planner-day', { timeout: 8000 });
const planned = await page.evaluate(() =>
  Array.from(document.querySelectorAll('.planner-stop-name')).map((e) => e.textContent.trim()));
check('a name with the town appended still finds the place',
  planned.includes('Edinburgh Castle'), JSON.stringify(planned));
check('and a longer version of the name does too',
  planned.includes('Camera Obscura'), JSON.stringify(planned));
check('all three are planned rather than none', planned.length === 3, JSON.stringify(planned));

// A name that is genuinely not one of yours is still refused - "Edinburgh
// Castle" must not quietly become "Edinburgh Zoo".
await seed({ days: [{ id: 'd1', label: 'Day 1 · Wed 19 Aug' }], items: {} });
await page.unroute(/generativelanguage\.googleapis\.com/);
await page.route(/generativelanguage\.googleapis\.com/, (route) => {
  if (/\/models\?/.test(route.request().url())) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      models: [{ name: 'models/gemini-3.5-flash-lite', supportedGenerationMethods: ['generateContent'] }] }) });
  }
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    candidates: [{ content: { parts: [{ text: JSON.stringify({
      days: [{ day: 1, stops: [{ name: 'Edinburgh Zoo', time: '10:00', why: 'Never saved.' }] }],
      leftOut: [], notes: '', separateTrips: [],
    }) }] } }] }) });
});
await openPicker();
await page.evaluate(() => document.querySelector('[data-plan-run]').click());
await page.waitForTimeout(2500);
check('a place you never saved is not scheduled by a near-enough name',
  /aren't in your list/.test(await bodyText()), (await bodyText()).slice(0, 220));
check('and it says which one it made up',
  /Edinburgh Zoo/.test(await bodyText()), (await bodyText()).slice(0, 220));

// ---------- No days to plan into ----------

await seed({ days: [], items: {} });
await openPicker();
await page.evaluate(() => document.querySelector('[data-plan-run]').click());
await page.waitForTimeout(800);
check('with no days yet, it says so rather than failing', await page.evaluate(() =>
  /Add a day first/.test((document.getElementById('toast') || {}).textContent || '')),
  await page.evaluate(() => (document.getElementById('toast') || {}).textContent || 'no toast'));

await browser.close();
console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILED`);
process.exit(failures ? 1 : 0);
