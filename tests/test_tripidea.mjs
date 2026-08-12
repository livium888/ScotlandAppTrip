// "I'm in Edinburgh and I want to head towards the Highlands, but no more
// than 100 miles. Recommend stops, attractions and places to eat."
//
// That is a trip, not a search. Search answers a question you already know how
// to ask; this one is a shape, and the hard part is knowing what to ask for at
// all. So the question gets built rather than typed - each part a row of chips
// drawn from what the app already knows, each answer changing the advice on
// the parts still to come - and what comes back is whole routes with their
// stops in driving order, one tap from being an itinerary.
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

// Two routes back. The second carries a stop the model claims is 60 miles out
// and which is really 180 - the case the distance check exists for.
const TRIP = {
  options: [
    {
      title: 'Up the A9',
      summary: 'The straight run north, with the cathedral and the castle.',
      miles: 140,
      days: [
        {
          label: 'Day 1',
          stops: [
            { name: 'Dunkeld Cathedral', kind: 'see', area: 'Dunkeld', why: 'Ruined nave by the river.',
              milesFromStart: 45, time: '',
              alternatives: [{ name: 'The Birnam Oak', area: 'Birnam', why: 'Ten minutes on foot from the bridge.' }] },
            { name: 'The Taybank', kind: 'eat', area: 'Dunkeld', why: 'Riverside pub that feeds children early.',
              milesFromStart: 45, time: '12:30', alternatives: [] },
          ],
        },
        {
          label: 'Day 2',
          stops: [
            { name: 'Blair Castle', kind: 'see', area: 'Blair Atholl', why: 'White castle, deer park, flat paths.',
              milesFromStart: 70, time: '', alternatives: [] },
          ],
        },
      ],
    },
    {
      title: 'West to the lochs',
      summary: 'Water rather than hills.',
      miles: 120,
      days: [
        {
          label: 'Day 1',
          stops: [
            { name: 'Far North Museum', kind: 'see', area: 'Thurso', why: 'Claimed to be an hour away.',
              milesFromStart: 60, time: '', alternatives: [] },
          ],
        },
      ],
    },
  ],
};

let aiPrompts = [];
await page.route(/generativelanguage\.googleapis\.com/, (route) => {
  if (/\/models\?/.test(route.request().url())) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      models: [{ name: 'models/gemini-3.5-flash-lite', supportedGenerationMethods: ['generateContent'] }] }) });
  }
  try { aiPrompts.push(JSON.parse(route.request().postData() || '{}').contents[0].parts[0].text); } catch (e) { /* not a prompt */ }
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    candidates: [{ content: { parts: [{ text: JSON.stringify(TRIP) }] } }] }) });
});

// Longest key first: "Dunkeld Cathedral, Dunkeld" must not match "Dunkeld".
const PLACES = [
  ['Dunkeld Cathedral', 56.5647, -3.5906],
  ['The Birnam Oak', 56.5600, -3.5800],
  ['The Taybank', 56.5650, -3.5900],
  ['Far North Museum', 58.6000, -3.5000],
  ['Blair Castle', 56.7700, -3.8400],
  ['Edinburgh', 55.9533, -3.1883],
];
let geoQueries = [];
await page.route(/nominatim\.openstreetmap\.org/, (route) => {
  const q = decodeURIComponent((/[?&]q=([^&]*)/.exec(route.request().url()) || [])[1] || '');
  geoQueries.push(q);
  const hit = PLACES.find(([name]) => q.toLowerCase().includes(name.toLowerCase()));
  if (!hit) return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  const [name, lat, lon] = hit;
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{
    lat: String(lat), lon: String(lon), display_name: `${name}, Scotland`, type: 'attraction', class: 'tourism',
    namedetails: { name }, address: { town: name }, extratags: {},
  }]) });
});
await page.route(/wikidata|wikipedia|overpass|tile\.|open-meteo|photon|places\.googleapis/, (r) => r.abort());

const readPicks = () => page.evaluate(() => JSON.parse(localStorage.getItem('board:b-i:picks') || '[]'));
const readPlan = () => page.evaluate(() => JSON.parse(localStorage.getItem('board:b-i:plan') || '{"days":[],"items":{}}'));
const readFolders = () => page.evaluate(() => JSON.parse(localStorage.getItem('board:b-i:folders') || '[]'));
const sentence = () => page.evaluate(() => (document.getElementById('ideaSentence') || {}).textContent || '');
const hintFor = (slot) => page.evaluate((s) => {
  const el = document.querySelector(`[data-idea-slot="${s}"] .idea-slot-hint`);
  return el ? el.textContent.trim() : '';
}, slot);
const chip = (label) => page.evaluate((text) => {
  const el = Array.from(document.querySelectorAll('.idea-chip')).find((c) => c.textContent.trim() === text);
  if (!el) throw new Error(`no chip "${text}"`);
  el.click();
}, label);

async function seed(extra) {
  await page.evaluate((over) => {
    localStorage.clear();
    localStorage.setItem('boards-v1', JSON.stringify({
      activeId: 'b-i', boards: [{ id: 'b-i', name: 'Idea', destination: 'Scotland', dated: true, hasGuide: false, createdAt: 1 }],
    }));
    localStorage.setItem('trip-settings-v1', JSON.stringify(Object.assign({
      destination: 'Scotland', geminiKey: 'KEY', geminiModel: 'models/gemini-3.5-flash-lite',
      travellers: 'family of 3, 4-year-old who walks',
    }, over || {})));
    localStorage.setItem('board:b-i:folders', JSON.stringify(['Edinburgh']));
    localStorage.setItem('board:b-i:picks', JSON.stringify([
      { id: 'custom:Edinburgh', name: 'Edinburgh', city: 'Edinburgh', major: true, category: 'City',
        lat: 55.9533, lon: -3.1883, addedAt: 1 },
    ]));
  }, extra);
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(350);
}

await page.goto(BASE, { waitUntil: 'load' });
await seed();

// ---------- It is offered where a trip would be built ----------

await page.evaluate(() => document.querySelector('[data-view="itinerary"]').click());
await page.waitForTimeout(400);
check('the itinerary offers to suggest a trip', await page.evaluate(() => !!document.getElementById('tripIdeaBtn')));

await page.evaluate(() => document.getElementById('tripIdeaBtn').click());
await page.waitForSelector('#ideaOverlay.open', { timeout: 4000 });

// ---------- The question, before it is asked ----------

check('the question is on screen as a sentence, not a form',
  /I'm in/.test(await sentence()), await sentence());
check('and what is missing reads as missing', await page.evaluate(() =>
  document.querySelectorAll('#ideaSentence .idea-blank').length >= 3));
check('the first thing to answer is marked', await page.evaluate(() =>
  (document.querySelector('.idea-slot.next') || {}).getAttribute?.('data-idea-slot') === 'from'));
check('a saved area is offered as a starting point', await page.evaluate(() =>
  Array.from(document.querySelectorAll('.idea-chip')).some((c) => c.textContent.trim() === 'Edinburgh')));

const beforeFrom = await hintFor('towards');
await chip('Edinburgh');
await page.waitForTimeout(300);
check('choosing a start writes it into the sentence', /Edinburgh/.test(await sentence()), await sentence());
check('and the advice below it changes to match',
  (await hintFor('towards')) !== beforeFrom && /Edinburgh/.test(await hintFor('towards')),
  await hintFor('towards'));
check('the next thing to answer moves on', await page.evaluate(() =>
  (document.querySelector('.idea-slot.next') || {}).getAttribute?.('data-idea-slot') === 'miles'));

// The advice is not a fixed string per row: it reads the answers already given.
await chip('250 miles');
await chip('A day out');
await page.waitForTimeout(300);
const overreach = await hintFor('miles');
check('250 miles in one day is called what it is', /mostly driving|Two days would suit/i.test(overreach), overreach);

await chip('250 miles'); // tapping the chip again clears it
await page.waitForTimeout(200);
check('tapping the same chip again clears it', !/250 miles/.test(await sentence()), await sentence());

await chip('100 miles');
await chip('2 days');
await page.waitForTimeout(300);
const comfortable = await hintFor('miles');
check('100 miles across 2 days is called something else', /comfortable/i.test(comfortable), comfortable);

// A young child and "see as much as we can" is a contradiction worth saying
// once, rather than quietly producing a day nobody can do.
await chip('See as much as we can');
await page.waitForTimeout(250);
const paceHint = await hintFor('pace');
check('a packed day with a four-year-old gets a word of warning',
  /young child/i.test(paceHint), paceHint);
await chip('A steady pace');

await page.fill('[data-idea-text="towards"]', 'towards the Highlands');
await page.evaluate(() => document.querySelector('[data-idea-text="towards"]').blur());
await page.waitForTimeout(300);
await chip('🏰 Historic sites');
await chip('🚶 Easy walks');
await page.waitForTimeout(250);
check('interests go into the sentence in plain words',
  /historic sites/.test(await sentence()) && /easy walks/.test(await sentence()), await sentence());

await page.fill('[data-idea-text="extra"]', 'no motorways');
await page.evaluate(() => document.querySelector('[data-idea-text="extra"]').blur());
await page.waitForTimeout(300);

const built = await sentence();
check('the whole question reads as one sentence',
  /I'm in Edinburgh/.test(built) && /towards the Highlands/.test(built) &&
  /100 miles/.test(built) && /2 days/.test(built) && /no motorways/.test(built), built);

// ---------- What is actually asked ----------

aiPrompts = [];
await page.evaluate(() => document.getElementById('ideaRun').click());
await page.waitForSelector('.idea-option', { timeout: 8000 });

const prompt = aiPrompts.join('\n---\n');
check('the prompt carries the starting point', /Starting point: Edinburgh/.test(prompt), prompt.slice(0, 200));
check('and the distance, as a rule not a hint',
  /Maximum distance from the start: 100 miles/.test(prompt) && /Nothing further than 100 miles/.test(prompt));
check('and how long for', /Time available: 2 days/.test(prompt));
check('and who is going', /4-year-old who walks/.test(prompt));
check('and what you are after, in the category\'s own words',
  /castles, ruins and historic buildings/.test(prompt), prompt.slice(0, 400));
check('and your own words, as written', /no motorways/.test(prompt));
check('it asks for several whole routes, not a list of places',
  /genuinely different options/.test(prompt) && /Order the stops the way you would actually drive them/.test(prompt));

// ---------- Routes back, not a list ----------

const options = await page.evaluate(() =>
  Array.from(document.querySelectorAll('.idea-option-title')).map((e) => e.textContent.trim()));
check('both routes are offered', options.length === 2 && /Up the A9/.test(options[0]), JSON.stringify(options));
check('with what each involves', await page.evaluate(() =>
  /2 days · 3 stops/.test(document.querySelector('.idea-option-meta').textContent)),
  await page.evaluate(() => document.querySelector('.idea-option-meta').textContent));

check('the first is open, with its days named', await page.evaluate(() => {
  const labels = Array.from(document.querySelectorAll('.idea-day-label')).map((e) => e.textContent.trim());
  return labels.join(',') === 'Day 1,Day 2';
}));
const stops = await page.evaluate(() =>
  Array.from(document.querySelectorAll('.idea-stop-name')).map((e) => e.textContent.trim()));
check('and its stops in the order you would drive them',
  stops[0].startsWith('Dunkeld Cathedral') && /Taybank/.test(stops[1]) && /Blair Castle/.test(stops[2]),
  JSON.stringify(stops));
check('somewhere to eat is marked as such', await page.evaluate(() =>
  Array.from(document.querySelectorAll('.idea-stop')).some((s) =>
    /Taybank/.test(s.textContent) && /🍽️/.test(s.textContent))));
check('a time the model gave is kept', await page.evaluate(() =>
  /12:30/.test(document.querySelector('.idea-stop-time').textContent)));

// ---------- The mileage is measured, not believed ----------

await page.waitForTimeout(1200);
check('a stop is shown with its real distance from the start', await page.evaluate(() =>
  /\d+ mi out/.test(document.querySelector('.idea-stop-meta').textContent)),
  await page.evaluate(() => document.querySelector('.idea-stop-meta').textContent));

await page.evaluate(() => document.querySelectorAll('[data-idea-option]')[1].click());
await page.waitForTimeout(1500);
check('a stop that is really 180 miles away is flagged, whatever the model claimed',
  await page.evaluate(() => !!document.querySelector('.idea-stop.over')),
  await page.evaluate(() => (document.querySelector('.idea-stop') || {}).textContent || ''));
check('and it says by how much, and against what',
  await page.evaluate(() => /past your 100/.test(document.querySelector('.idea-stop-warn').textContent)),
  await page.evaluate(() => (document.querySelector('.idea-stop-warn') || {}).textContent || ''));

// ---------- One tap swaps a stop for its alternative ----------

await page.evaluate(() => document.querySelectorAll('[data-idea-option]')[0].click());
await page.waitForTimeout(500);
check('a stop with an alternative offers the swap', await page.evaluate(() =>
  !!document.querySelector('[data-idea-swap]')));
await page.evaluate(() => document.querySelector('[data-idea-swap]').click());
await page.waitForTimeout(600);
const swapped = await page.evaluate(() =>
  Array.from(document.querySelectorAll('.idea-stop-name')).map((e) => e.textContent.trim()));
check('swapping puts the alternative in its place', /Birnam Oak/.test(swapped[0] || ''), JSON.stringify(swapped));
await page.evaluate(() => document.querySelector('[data-idea-swap]').click());
await page.waitForTimeout(600);
check('and swapping again brings the first one back', await page.evaluate(() =>
  /Dunkeld Cathedral/.test(document.querySelector('.idea-stop-name').textContent)));

// ---------- A single stop, without taking the whole route ----------

await page.evaluate(() => document.querySelector('[data-idea-add]').click());
await page.waitForTimeout(1200);
const savedOne = (await readPicks()).find((p) => /Dunkeld Cathedral/.test(p.name));
check('a stop can be saved on its own', !!savedOne, JSON.stringify((await readPicks()).map((p) => p.name)));
check('filed under the town it is in, not Unsorted', !!savedOne && savedOne.city === 'Dunkeld', JSON.stringify(savedOne));
check('and that section now exists', (await readFolders()).includes('Dunkeld'), JSON.stringify(await readFolders()));
check('the list shows it as saved', await page.evaluate(() =>
  !!document.querySelector('.candidate-add.saved')));

// A stop can go straight on a day, with no itinerary built yet.
await page.evaluate(() => document.querySelector('[data-idea-day]').click());
await page.waitForSelector('[data-day-quick]', { timeout: 5000 });
await page.evaluate(() => document.querySelector('[data-day-quick]').click());
await page.waitForTimeout(400);
await page.evaluate(() => document.getElementById('daySheetDone').click());
await page.waitForTimeout(600);
check('a stop can be put on a day from here too',
  Object.values((await readPlan()).items).flat().some((it) => /Dunkeld Cathedral/.test(it.pickId)),
  JSON.stringify((await readPlan()).items));
check('and the trip screen is still where you left it', await page.evaluate(() =>
  document.getElementById('ideaOverlay').classList.contains('open')));

// ---------- Or the whole route, in one ----------

await page.evaluate(() => localStorage.setItem('board:b-i:plan', JSON.stringify({ days: [], items: {} })));
await page.evaluate(() => document.querySelector('[data-idea-use]').click());
await page.waitForTimeout(2000);

const plan = await readPlan();
check('building the trip makes a day per day of the route', plan.days.length === 2,
  JSON.stringify(plan.days.map((d) => d.label)));
check('and the days are numbered and dated', /^Day 1 · /.test(plan.days[0].label), plan.days[0].label);
// Days made in the same millisecond used to share an id, which put every stop
// on the first one and left the rest as days you could see and not fill.
check('each day is its own day', plan.days[0].id !== plan.days[1].id,
  JSON.stringify(plan.days.map((d) => d.id)));

const picks = await readPicks();
const byId = {};
picks.forEach((p) => (byId[p.id] = p));
const dayOne = (plan.items[plan.days[0].id] || []).map((it) => (byId[it.pickId] || {}).name);
const dayTwo = (plan.items[plan.days[1].id] || []).map((it) => (byId[it.pickId] || {}).name);
check('the first day has its stops, in order',
  dayOne.join(',') === 'Dunkeld Cathedral,The Taybank', JSON.stringify(dayOne));
check('the second has its own', dayTwo.join(',') === 'Blair Castle', JSON.stringify(dayTwo));
check('a time the model gave survives into the plan',
  (plan.items[plan.days[0].id] || []).some((it) => it.time === '12:30'),
  JSON.stringify(plan.items[plan.days[0].id]));
check('every stop is saved as a place', ['Dunkeld Cathedral', 'The Taybank', 'Blair Castle']
  .every((n) => picks.some((p) => p.name === n)), JSON.stringify(picks.map((p) => p.name)));
check('each filed under its own town',
  (picks.find((p) => p.name === 'Blair Castle') || {}).city === 'Blair Atholl',
  JSON.stringify(picks.map((p) => `${p.name}=${p.city}`)));

check('and it drops you on the itinerary, with the trip in it', await page.evaluate(() =>
  !document.getElementById('ideaOverlay').classList.contains('open') &&
  document.getElementById('view').dataset.activeTab === 'itinerary'));
check('which is the trip you were shown', await page.evaluate(() =>
  /Dunkeld Cathedral/.test(document.getElementById('view').textContent) &&
  /Blair Castle/.test(document.getElementById('view').textContent)));

// ---------- The question keeps, so it can be changed rather than retyped ----------

await page.evaluate(() => document.getElementById('tripIdeaBtn').click());
await page.waitForSelector('#ideaOverlay.open', { timeout: 4000 });
check('coming back shows the routes you already have', await page.evaluate(() =>
  !!document.querySelector('.idea-option')));
await page.evaluate(() => document.querySelector('[data-idea-edit]').click());
await page.waitForTimeout(400);
check('and the question exactly as you built it',
  /Edinburgh/.test(await sentence()) && /100 miles/.test(await sentence()) && /no motorways/.test(await sentence()),
  await sentence());

// ---------- Nothing to ask with ----------

await seed({ geminiKey: '' });
await page.evaluate(() => document.querySelector('[data-view="itinerary"]').click());
await page.waitForTimeout(400);
await page.evaluate(() => document.getElementById('tripIdeaBtn').click());
await page.waitForSelector('#ideaOverlay.open', { timeout: 4000 });
await chip('Edinburgh');
await page.waitForTimeout(200);
await page.evaluate(() => document.getElementById('ideaRun').click());
await page.waitForTimeout(700);
check('with no AI key it says where to put one rather than failing quietly',
  await page.evaluate(() => document.getElementById('placeModal').classList.contains('open') &&
    /Gemini/i.test(document.getElementById('placeModal').textContent)));

await browser.close();
console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILED`);
process.exit(failures ? 1 : 0);
