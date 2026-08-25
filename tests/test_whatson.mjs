// "The events near me barely returns any results. But if I check online,
// Facebook, Instagram, etc., there are a ton of events."
//
// Both halves of that were the app's fault, and neither was the model's.
//
// The prompt ended with "leave out anything you cannot confirm; six real ones
// are worth more than twelve guesses" — so it left things out, as instructed.
// And every result then had to be geocoded by venue name or be thrown away,
// which is a reasonable rule for a café and a terrible one for an event: "the
// Tolbooth", "the Settle Inn", "St Mary's church hall" are perfectly real and
// simply not in a gazetteer of businesses. A whole evening's worth of things
// to do was being discarded for failing to be a registered address.
//
// Events also had no home. They were a category buried in the place search,
// mixed into a list of permanent places where the one thing that matters
// about them — when — had nowhere to sit.
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
await page.addInitScript(() => { localStorage.setItem('onboarded-v1', '1'); });

const soon = new Date(Date.now() + 2 * 86400000);
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const soonIso = iso(soon);
const laterIso = iso(new Date(Date.now() + 4 * 86400000));

// Six angles, six different answers — which is the point. One of them repeats
// another's find, and one is a festival that started before the window opened.
const ANGLES = {
  music: [{ name: 'Folk Session at the Settle Inn', time: '21:00', venue: 'Settle Inn', area: 'Stirling', what: 'Fiddles, free in.', price: 'free' }],
  market: [{ name: 'Stirling Farmers Market', time: '09:00', venue: 'Port Street', area: 'Stirling', what: 'Producers from round about.', price: 'free' }],
  family: [{ name: 'Toddler Storytime', time: '10:30', venue: 'Stirling Library', area: 'Stirling', what: 'Under fives.', price: 'free' }],
  arts: [{ name: 'Macbeth at the Tolbooth', time: '19:30', venue: 'The Tolbooth', area: 'Stirling', what: 'Am-dram.', price: '££', tickets: 'https://example.com/tix' }],
  outdoors: [{ name: 'Ochils Guided Walk', time: '10:00', venue: 'Dumyat car park', area: 'Stirling', what: 'Five miles.', price: '£' }],
  local: [
    { name: 'The Folk Session at the Settle Inn', time: '21:00', venue: 'Settle Inn', area: 'Stirling', what: 'The same one, found twice.', price: 'free' },
    { name: 'Bridge of Allan Quiz Night', time: '20:00', venue: 'Westerton Arms', area: 'Bridge of Allan', what: 'Quiz.', price: 'free' },
    { name: 'A Thing In London', time: '19:00', venue: 'Somewhere', area: 'Chelsea, London', what: 'The model got lost.', price: 'free' },
    { name: 'Nowhere At All Gathering', time: '', venue: '', area: '', what: 'No place, no town.', price: 'free' },
  ],
};
const ANGLE_MARKERS = {
  music: 'live music', market: "farmers' markets", family: 'things on for children',
  arts: 'theatre, comedy', outdoors: 'guided walks', local: 'a local would know',
};

let geminiCalls = 0;
let promptsSeen = [];
await page.route(/generativelanguage\.googleapis\.com/, (route) => {
  const url = route.request().url();
  if (/\/models\?/.test(url)) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      models: [{ name: 'models/gemini-3.5-flash-lite', supportedGenerationMethods: ['generateContent'] }] }) });
  }
  geminiCalls++;
  const prompt = JSON.parse(route.request().postData() || '{}').contents[0].parts[0].text;
  promptsSeen.push(prompt);
  const angle = Object.keys(ANGLE_MARKERS).find((k) => prompt.includes(ANGLE_MARKERS[k])) || 'music';
  let list = ANGLES[angle].map((e) => ({ ...e, date: soonIso }));
  // The arts angle also returns a run of days that began before the window.
  if (angle === 'arts') {
    list = list.concat([{ name: 'Stirling Fringe', date: iso(new Date(Date.now() - 3 * 86400000)),
      endDate: laterIso, time: '', venue: 'Various', area: 'Stirling', what: 'Runs all week.', price: '£' }]);
  }
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    candidates: [{ content: { parts: [{ text: JSON.stringify(list) }] },
      groundingMetadata: { groundingChunks: [{ web: { uri: 'https://example.com/whats-on', title: "What's on" } }] } }] }) });
});

// Deliberately harsh, and true to life: not one venue name resolves. Only the
// towns do. Under the old rule this would have thrown away every result.
await page.route(/nominatim\.openstreetmap\.org/, (route) => {
  const q = decodeURIComponent(route.request().url());
  if (/Settle|Tolbooth|Dumyat|Library|Port\s*Street|Westerton|Various|Somewhere/i.test(q)) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  }
  if (/Chelsea|London/i.test(q)) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{
      lat: '51.4875', lon: '-0.1687', display_name: 'Chelsea, London', type: 'suburb',
      namedetails: { name: 'Chelsea' }, address: { city: 'London' }, extratags: {} }]) });
  }
  if (/Bridge\+of\+Allan|Bridge of Allan/i.test(q)) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{
      lat: '56.1530', lon: '-3.9470', display_name: 'Bridge of Allan', type: 'town',
      namedetails: { name: 'Bridge of Allan' }, address: { town: 'Bridge of Allan' }, extratags: {} }]) });
  }
  if (/Stirling/i.test(q)) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{
      lat: '56.1165', lon: '-3.9369', display_name: 'Stirling', type: 'town',
      namedetails: { name: 'Stirling' }, address: { town: 'Stirling' }, extratags: {} }]) });
  }
  return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
});
await page.route(/wikidata|wikipedia|overpass|open-meteo|photon|places\.googleapis|upload\.|tile\./, (r) => r.abort());

await page.goto(BASE, { waitUntil: 'load' });
await page.evaluate(() => {
  localStorage.setItem('boards-v1', JSON.stringify({
    activeId: 'b-w', boards: [{ id: 'b-w', name: 'Trip', destination: 'Scotland', dated: true, hasGuide: false, createdAt: 1 }] }));
  localStorage.setItem('trip-settings-v1', JSON.stringify({
    destination: 'Scotland', geminiKey: 'KEY', geminiModel: 'models/gemini-3.5-flash-lite' }));
  localStorage.setItem('board:b-w:folders', JSON.stringify(['Stirling']));
  localStorage.setItem('board:b-w:picks', JSON.stringify([
    { id: 'p1', name: 'Stirling Castle', city: 'Stirling', category: 'Castle', lat: 56.1237, lon: -3.9474, addedAt: 1, photoChecked: true }]));
  localStorage.setItem('board:b-w:plan', JSON.stringify({ days: [], items: {} }));
  localStorage.setItem('board:b-w:search-anchor', JSON.stringify({ name: 'Stirling', lat: 56.1165, lon: -3.9369, miles: 15 }));
});
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(600);

// ---------- It has a home of its own ----------

check('there is a tab for it, not a category buried in the place search',
  await page.evaluate(() => !!document.querySelector('.tabbar [data-view="events"]')));
check('and its label fits on one line like the other six', await page.evaluate(() => {
  const labels = Array.from(document.querySelectorAll('.tabbar .tab-label'));
  const heights = labels.map((l) => l.getBoundingClientRect().height);
  return Math.max(...heights) - Math.min(...heights) < 2;
}), await page.evaluate(() => Array.from(document.querySelectorAll('.tabbar .tab-label')).map((l) => l.getBoundingClientRect().height).join(',')));

await page.evaluate(() => document.querySelector('[data-view="events"]').click());
await page.waitForTimeout(500);
const screen = () => page.evaluate(() => document.getElementById('view').textContent.replace(/\s+/g, ' '));
check('the screen explains itself before you have searched anything',
  /Nothing saved yet/.test(await screen()), (await screen()).slice(0, 200));
// The presets by name rather than by count, so adding one does not fail this.
check('it offers the date window up front', await page.evaluate(() =>
  ['trip', 'weekend', 'week'].every((k) => !!document.querySelector(`[data-ev-when="${k}"]`))));
check('and the kinds of thing to look for', await page.evaluate(() =>
  document.querySelectorAll('[data-ev-kind]').length === 6));

// ---------- Recall: six questions, not one ----------

await page.evaluate(() => document.getElementById('evSearch').click());
await page.waitForTimeout(11000);

check('it asks six different questions rather than one general one',
  geminiCalls === 6, `${geminiCalls} calls`);
check('and no longer tells the model to hold back',
  promptsSeen.every((p) => !/worth more than twelve guesses|Leave out anything/.test(p)));
check('it asks for breadth instead', promptsSeen.some((p) => /Twenty real listings/.test(p)));
check('while still refusing invention', promptsSeen.every((p) => /[Dd]o not invent/.test(p)));

const names = () => page.evaluate(() =>
  Array.from(document.querySelectorAll('.ev-row .ev-name')).map((e) => e.textContent.trim()));
const found = await names();

// The heart of it: every single venue name failed to geocode, and every one of
// these is still here.
check('a venue no gazetteer has heard of is still an answer',
  found.some((n) => /Settle Inn/.test(n)) && found.some((n) => /Tolbooth/.test(n)),
  JSON.stringify(found));
check('so is a walk starting from a car park', found.some((n) => /Ochils/.test(n)), JSON.stringify(found));
check('and one in the next town along', found.some((n) => /Bridge of Allan/.test(n)), JSON.stringify(found));
check('six angles produce a real list, not three results',
  found.length >= 6, `${found.length}: ${JSON.stringify(found)}`);

// Things that must still be refused.
check('but a thing in London is not on near Stirling',
  !found.some((n) => /London/.test(n)), JSON.stringify(found));
check('and one with no venue and no town at all is dropped',
  !found.some((n) => /Nowhere At All/.test(n)), JSON.stringify(found));

// Deduped across angles.
check('the same session found twice is one row',
  found.filter((n) => /Settle Inn/.test(n)).length === 1, JSON.stringify(found));

// A run of days that began before you arrived is the thing you most want to
// know about, and used to be thrown away for starting too early.
check('a festival already running is shown against the first day you could go',
  found.some((n) => /Stirling Fringe/.test(n)), JSON.stringify(found));
check('and says how long it runs', /until/.test(await screen()), (await screen()).slice(0, 500));

// ---------- It reads as a diary ----------

check('results are grouped under the day they are on', await page.evaluate(() =>
  document.querySelectorAll('.ev-day').length >= 1));
const times = await page.evaluate(() =>
  Array.from(document.querySelectorAll('.ev-row .ev-time')).map((e) => e.textContent.trim()));
const clockOnly = times.filter((t) => /^\d{2}:\d{2}$/.test(t));
check('and within a day they run in clock order, which is what a diary is',
  JSON.stringify(clockOnly) === JSON.stringify([...clockOnly].sort()), JSON.stringify(times));
check('a town-level position says so rather than pretending to be the door',
  /approx\. location/.test(await screen()));
check('and the whole list says where it came from',
  /Worth a check before you set off/.test(await screen()));

// ---------- Saving one ----------

await page.evaluate(() => document.querySelector('[data-save-event]').click());
await page.waitForTimeout(2000);
const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('board:b-w:picks')).filter((p) => p.kind === 'event'));
check('saving keeps it as an event', saved.length === 1, JSON.stringify(saved.map((p) => [p.name, p.kind])));
check('with its date', !!(saved[0] && saved[0].startsAt), saved[0] && saved[0].startsAt);
check('and it moves into a section of its own', /Saved/.test(await screen()), (await screen()).slice(0, 300));

// ---------- Narrowing to one kind ----------

geminiCalls = 0;
await page.evaluate(() => document.querySelector('[data-ev-kind="market"]').click());
await page.waitForTimeout(300);
await page.evaluate(() => document.getElementById('evSearch').click());
await page.waitForTimeout(6000);
check('picking one kind asks one question, not six', geminiCalls === 1, `${geminiCalls} calls`);

// ---------- No key is a plain answer, not an empty screen ----------

await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('trip-settings-v1'));
  s.geminiKey = '';
  localStorage.setItem('trip-settings-v1', JSON.stringify(s));
});
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(500);
await page.evaluate(() => document.querySelector('[data-view="events"]').click());
await page.waitForTimeout(400);
await page.evaluate(() => document.getElementById('evSearch').click());
await page.waitForTimeout(700);
check('with no AI key it says why rather than showing nothing',
  /needs an AI key/.test(await screen()), (await screen()).slice(0, 300));
check('and the events already saved are still there',
  /Saved/.test(await screen()), (await screen()).slice(0, 300));

// ---------- Absorbed from test_events.mjs ----------
//
// Events used to have two ways in: this screen, and a category buried in the
// place search. Two entry points to one feature is the shape that made Places
// and Eats confusing as separate tabs, and it meant two suites testing the
// same thing from different angles. The Explore category is gone; the checks
// from its suite that were about the events themselves rather than about that
// screen live here now.

const dates = await page.evaluate(() => ({
  good: !!window.__tripTest.parseEventDate('2026-09-05'),
  vague: window.__tripTest.parseEventDate('next Saturday'),
  season: window.__tripTest.parseEventDate('late August'),
  empty: window.__tripTest.parseEventDate(''),
}));
check('a real date is read', dates.good === true, JSON.stringify(dates));
check('"next Saturday" is refused rather than guessed at', dates.vague === null, JSON.stringify(dates));
check('and so is "late August"', dates.season === null, JSON.stringify(dates));
check('and nothing at all', dates.empty === null, JSON.stringify(dates));

const windows = await page.evaluate(() => {
  const f = (k) => {
    const w = window.__tripTest.eventWindow(k);
    return { from: w.from.toISOString().slice(0, 10), to: w.to.toISOString().slice(0, 10) };
  };
  return { trip: f('trip'), week: f('week'), weekend: f('weekend') };
});
check('a week means a week', windows.week.to > windows.week.from, JSON.stringify(windows.week));
check('and a weekend is shorter than one', windows.weekend.to <= windows.week.to, JSON.stringify(windows.weekend));

const stale = await page.evaluate(() => ({
  past: window.__tripTest.eventIsPast({ startsAt: new Date(Date.now() - 30 * 86400000).toISOString() }),
  future: window.__tripTest.eventIsPast({ startsAt: new Date(Date.now() + 86400000).toISOString() }),
  place: window.__tripTest.eventIsPast({ name: 'A castle' }),
}));
check('a date that has passed is past', stale.past === true, JSON.stringify(stale));
check('tomorrow is not', stale.future === false, JSON.stringify(stale));
check('and a place with no date is never past', stale.place === false, JSON.stringify(stale));

// ---------- Your own dates, and a time to search onwards from ----------
//
// "I want to pick the date and time from a calendar... I give just the time
// from which the event should be searched onwards. It doesn't have to start at
// that time exactly, I want to filter what finished already. If I pick 3 PM as
// start time, don't show me events that ended at 2 PM but show me events that
// last from 9 am to 9 pm."
//
// That needs an end time, which the app never used to ask for - without one
// "has this finished" is not a question anybody can answer.

const filter = await page.evaluate(() => {
  const day = new Date(2026, 8, 12);
  const at = (h) => { const d = new Date(2026, 8, 12); d.setHours(h, 0, 0, 0); return d; };
  const ev = (time, endTime, dayOffset) => ({
    startsAt: new Date(2026, 8, 12 + (dayOffset || 0)).toISOString(), time, endTime });
  const f = window.__tripTest.stillOnAt;
  return {
    runsAcross: f(ev('09:00', '21:00'), at(15)),
    alreadyOver: f(ev('12:00', '14:00'), at(15)),
    laterTonight: f(ev('19:30', ''), at(15)),
    startedLongAgo: f(ev('12:00', ''), at(15)),
    startedJustNow: f(ev('14:00', ''), at(15)),
    allDayNoTimes: f(ev('', ''), at(15)),
    pastClosing: f(ev('09:00', '21:00'), at(22)),
    noCutoff: f(ev('09:00', '10:00'), null),
    anotherDay: f(ev('09:00', '10:00', 1), at(15)),
    ignored: day.getTime() > 0,
  };
});
check('a market running 09:00–21:00 still counts at 15:00', filter.runsAcross === true, JSON.stringify(filter));
check('and one that finished at 14:00 does not', filter.alreadyOver === false, JSON.stringify(filter));
check('something starting later tonight counts', filter.laterTonight === true, JSON.stringify(filter));
check('something with no finish time that started hours ago does not',
  filter.startedLongAgo === false, JSON.stringify(filter));
check('but one that started within the hour still does',
  filter.startedJustNow === true, JSON.stringify(filter));
check('an all-day thing with no times at all is never called over',
  filter.allDayNoTimes === true, JSON.stringify(filter));
check('and after closing time it is over', filter.pastClosing === false, JSON.stringify(filter));
check('with no time given, nothing is filtered on time', filter.noCutoff === true, JSON.stringify(filter));
// The one that would make the feature infuriating if it were wrong.
check('the time is a moment to start from, not a curfew on every later day',
  filter.anotherDay === true, JSON.stringify(filter));

// ---------- The controls ----------

await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('trip-settings-v1'));
  s.geminiKey = 'KEY';
  localStorage.setItem('trip-settings-v1', JSON.stringify(s));
});
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(500);
await page.evaluate(() => document.querySelector('[data-view="events"]').click());
await page.waitForTimeout(400);

check('there is a way to pick your own dates', await page.evaluate(() =>
  !!document.querySelector('[data-ev-when="custom"]')));
await page.evaluate(() => document.querySelector('[data-ev-when="custom"]').click());
await page.waitForTimeout(300);
check('which offers a calendar for both ends', await page.evaluate(() =>
  !!document.getElementById('evFrom') && !!document.getElementById('evTo')));
check('and a time to search onwards from', await page.evaluate(() =>
  !!document.getElementById('evFromTime')));
check('and says the time is a starting point rather than a start time',
  await page.evaluate(() => /starting point, not a start time/.test(document.getElementById('view').textContent)));

const day1 = '2026-09-12';
await page.evaluate((d) => {
  const from = document.getElementById('evFrom');
  from.value = d;
  from.dispatchEvent(new Event('change', { bubbles: true }));
}, day1);
await page.waitForTimeout(300);
check('picking one date means that one day, not an open-ended range', await page.evaluate(() =>
  document.getElementById('evTo').value) === day1, await page.evaluate(() => document.getElementById('evTo').value));

await page.evaluate(() => {
  const t = document.getElementById('evFromTime');
  t.value = '15:00';
  t.dispatchEvent(new Event('change', { bubbles: true }));
});
await page.waitForTimeout(300);
check('the chosen moment is shown back to you', await page.evaluate(() =>
  /from 15:00/.test(document.getElementById('view').textContent)),
  await page.evaluate(() => document.getElementById('view').textContent.slice(0, 400)));

// The model is told, so it does not spend its answer on the morning.
promptsSeen = [];
await page.evaluate(() => document.getElementById('evSearch').click());
await page.waitForTimeout(9000);
check('and the model is told to skip what finishes before then',
  promptsSeen.length > 0 && promptsSeen.every((p) => /still going at 15:00 or later/.test(p)),
  (promptsSeen[0] || '').slice(0, 300));

check('there is a way back to any time', await page.evaluate(() =>
  !!document.getElementById('evClearTime')));

await browser.close();
console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILED`);
process.exit(failures ? 1 : 0);
