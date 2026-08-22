// "What's on" — the one question the app could not answer.
//
// Every other search here is about places, which are permanent: a castle is
// there whether you go on Tuesday or in March. An event is somewhere for one
// afternoon and then it is nothing, and the app had no way to express that,
// so the answer to "what's on while we're here" was to put the phone down
// and open a browser.
//
// There is no open dataset for this — OpenStreetMap maps things that stay
// still, and the event APIs that exist are partner-only or paid. So this is a
// grounded AI search, which makes two things load-bearing: an event you
// cannot place or date is not an answer, and nothing is presented as certain.
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

// Three days out, so it is comfortably inside every window under test.
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const soon = new Date(Date.now() + 3 * 86400000);
const soonIso = iso(soon);
const longAgo = iso(new Date(Date.now() - 30 * 86400000));
const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const soonLabel = `Day 1 · ${DAYS[soon.getDay()]} ${soon.getDate()} ${MONTHS[soon.getMonth()]}`;

// What the model comes back with: two real ones, one with no date, one it
// cannot place, and one three hundred miles away.
let geminiCalls = 0;
let lastPrompt = '';
let groundedReplies = true;
await page.route(/generativelanguage\.googleapis\.com/, (route) => {
  const url = route.request().url();
  if (/\/models\?/.test(url)) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      models: [{ name: 'models/gemini-3.5-flash-lite', supportedGenerationMethods: ['generateContent'] }] }) });
  }
  geminiCalls++;
  const body = JSON.parse(route.request().postData() || '{}');
  lastPrompt = body.contents[0].parts[0].text;
  const grounded = !!body.tools;
  // The real failure mode this guards: a grounded reply comes back as prose
  // with citations rather than clean JSON, often enough that the app needs a
  // second, ungrounded attempt in the API's own JSON mode.
  if (grounded && !groundedReplies) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      candidates: [{ content: { parts: [{ text: 'Here is what I found for you this week!' }] } }] }) });
  }
  const events = JSON.stringify([
    { name: 'Stirling Farmers Market', date: soonIso, time: '09:00', venue: 'Port Street',
      area: 'Stirling', what: 'Producers from round about.', price: 'free', tickets: '', recurring: true },
    { name: 'Albert Halls Ceilidh', date: soonIso, time: '19:30', venue: 'Albert Halls',
      area: 'Stirling', what: 'A proper ceilidh band.', price: '££', tickets: 'https://example.com/tix', recurring: false },
    { name: 'A Thing With No Date', date: 'next Saturday', venue: 'Somewhere', area: 'Stirling', what: 'Vague.' },
    { name: 'Unfindable Happening', date: soonIso, venue: 'Nowhere At All', area: 'Stirling', what: 'No map has this.' },
    { name: 'Chelsea Street Party', date: soonIso, venue: 'Kings Road', area: 'Chelsea, London', what: 'The model got lost.' },
  ]);
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    candidates: [{
      content: { parts: [{ text: events }] },
      groundingMetadata: grounded ? { groundingChunks: [
        { web: { uri: 'https://example.com/whats-on', title: 'What’s on in Stirling' } }] } : undefined,
    }] }) });
});

await page.route(/nominatim\.openstreetmap\.org/, (route) => {
  const q = decodeURIComponent(route.request().url());
  if (/Port\+Street|Port Street|Farmers/i.test(q)) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{
      lat: '56.1180', lon: '-3.9370', display_name: 'Port Street, Stirling', type: 'road',
      namedetails: { name: 'Port Street' }, address: { town: 'Stirling' }, extratags: {} }]) });
  }
  if (/Albert/i.test(q)) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{
      lat: '56.1195', lon: '-3.9400', display_name: 'Albert Halls, Stirling', type: 'theatre',
      namedetails: { name: 'Albert Halls' }, address: { town: 'Stirling' }, extratags: {} }]) });
  }
  if (/Kings\+Road|Kings Road|Chelsea/i.test(q)) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{
      lat: '51.4875', lon: '-0.1687', display_name: 'Kings Road, London', type: 'road',
      namedetails: { name: 'Kings Road' }, address: { city: 'London' }, extratags: {} }]) });
  }
  return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
});
await page.route(/wikidata|wikipedia|overpass|open-meteo|photon|places\.googleapis|upload\.|tile\./, (r) => r.abort());

await page.goto(BASE, { waitUntil: 'load' });
await page.evaluate((label) => {
  localStorage.setItem('boards-v1', JSON.stringify({
    activeId: 'b-e', boards: [{ id: 'b-e', name: 'Trip', destination: 'Scotland', dated: true, hasGuide: false, createdAt: 1 }] }));
  localStorage.setItem('trip-settings-v1', JSON.stringify({
    destination: 'Scotland', geminiKey: 'KEY', geminiModel: 'models/gemini-3.5-flash-lite' }));
  localStorage.setItem('board:b-e:folders', JSON.stringify(['Stirling']));
  localStorage.setItem('board:b-e:picks', JSON.stringify([
    { id: 'p1', name: 'Stirling Castle', city: 'Stirling', category: 'Castle',
      lat: 56.1237, lon: -3.9474, addedAt: 1, photoChecked: true }]));
  localStorage.setItem('board:b-e:plan', JSON.stringify({
    days: [{ id: 'd1', label }], items: { d1: [] } }));
}, soonLabel);
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(500);

// ---------- The window comes from the plan ----------

const windows = await page.evaluate(() => {
  const f = (k) => {
    const w = window.__tripTest.eventWindow(k);
    return { from: w.from.toISOString().slice(0, 10), to: w.to.toISOString().slice(0, 10), label: w.label };
  };
  return { trip: f('trip'), week: f('week'), weekend: f('weekend') };
});
check('"while we\'re there" is read off the plan rather than asked for again',
  windows.trip.to === soonIso, JSON.stringify(windows.trip));
check('a week means a week', windows.week.to > windows.week.from, JSON.stringify(windows.week));
check('and a weekend is shorter than one', windows.weekend.to <= windows.week.to, JSON.stringify(windows.weekend));

// ---------- A date is the one thing an event cannot do without ----------

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

// ---------- The search itself ----------

const runSearch = async () => {
  await page.evaluate(() => document.querySelector('[data-view="picks"]').click());
  await page.waitForTimeout(300);
  await page.evaluate(() => document.querySelector('[data-open-pick]').click());
  await page.waitForSelector('#placeModal.open');
  await page.evaluate(() => document.querySelector('[data-explore-from]').click());
  await page.waitForSelector('#exploreCatBtn', { timeout: 5000 });
  await page.evaluate(() => document.getElementById('exploreCatBtn').click());
  await page.waitForSelector('[data-choose-cat="events"]', { timeout: 4000 });
  await page.evaluate(() => document.querySelector('[data-choose-cat="events"]').click());
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const btn = document.getElementById('exploreSearchBtn') ||
      Array.from(document.querySelectorAll('button')).find((b) => /^\s*(🔍\s*)?Search/i.test(b.textContent));
    if (btn) btn.click();
  });
  await page.waitForTimeout(9000);
  return page.evaluate(() => document.getElementById('view').textContent.replace(/\s+/g, ' '));
};

check('"What\'s on" is offered as something to search for', await page.evaluate(() => true));
const shown = await runSearch();

check('what is genuinely on comes back', /Farmers Market/.test(shown) && /Ceilidh/.test(shown), shown.slice(0, 400));
check('with the date on the row, which is the point of an event',
  new RegExp(`${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][soon.getDay()]}`).test(shown), shown.slice(0, 500));
check('and the start time', /09:00|19:30/.test(shown), shown.slice(0, 500));

// The three that are not answers.
check('something with no usable date is dropped', !/No Date/.test(shown), shown.slice(0, 400));
check('so is one that cannot be found on a map', !/Unfindable/.test(shown), shown.slice(0, 400));
check('and a street party in London is not on near Stirling',
  !/Chelsea/.test(shown), shown.slice(0, 400));

// The date window has to reach the model, or it is decoration.
check('the question sent actually names the dates asked about',
  lastPrompt.includes(String(soon.getFullYear())) && /between/i.test(lastPrompt),
  lastPrompt.slice(0, 200));
check('and says what an event is not', /[Nn]ot permanent attractions/.test(lastPrompt), lastPrompt.slice(0, 400));

// ---------- Prose instead of JSON falls back rather than failing ----------

groundedReplies = false;
geminiCalls = 0;
const second = await runSearch();
check('a grounded reply that comes back as prose is retried in JSON mode',
  geminiCalls >= 2, `${geminiCalls} calls`);
check('and the events still arrive', /Farmers Market/.test(second), second.slice(0, 300));
groundedReplies = true;

// ---------- Saving one puts it in the day it is on ----------

await runSearch();
// Events arrive through Explore, so this is the ＋ on an Explore result card -
// a different code path from the search overlay's, and one that rebuilds the
// candidate field by field rather than passing it through.
await page.evaluate(() => {
  const add = document.querySelector('[data-explore-add]');
  if (add) add.click();
});
await page.waitForTimeout(1200);
// Saving asks which folder it goes in; take whatever it offers first.
await page.evaluate(() => {
  const chip = document.querySelector('[data-folder-choice], [data-choose-folder], .folder-chip');
  if (chip) chip.click();
  const go = document.getElementById('folderConfirm') ||
    Array.from(document.querySelectorAll('button')).find((b) => /^(Save|Add|Done)$/i.test(b.textContent.trim()));
  if (go) go.click();
});
await page.waitForTimeout(2500);

const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('board:b-e:picks')));
const ev = saved.find((p) => p.kind === 'event');
check('an event saves as an event, not as a place', !!ev, JSON.stringify(saved.map((p) => [p.name, p.kind])));
check('keeping the date it is on', !!ev && !!ev.startsAt, ev && ev.startsAt);
check('and where it came from, because an invented festival is the obvious risk',
  !!ev && Array.isArray(ev.sources) && ev.sources.length > 0, JSON.stringify(ev && ev.sources));
check('and it is marked as worth checking rather than presented as certain',
  !!ev && ev.unverified === true, String(ev && ev.unverified));

const plan = await page.evaluate(() => JSON.parse(localStorage.getItem('board:b-e:plan')));
check('and it lands on the planned day it falls on, without being dragged there',
  (plan.items.d1 || []).some((it) => it.pickId === (ev && ev.id)), JSON.stringify(plan.items));
check('at the time it starts',
  (plan.items.d1 || []).some((it) => it.time === '09:00' || it.time === '19:30'), JSON.stringify(plan.items));

// ---------- An event that has been and gone says so ----------

const stale = await page.evaluate((past) => {
  const picks = JSON.parse(localStorage.getItem('board:b-e:picks'));
  picks.push({ id: 'old', name: 'Last Month Market', city: 'Stirling', kind: 'event',
    startsAt: new Date(past).toISOString(), lat: 56.118, lon: -3.937, addedAt: 2, photoChecked: true });
  localStorage.setItem('board:b-e:picks', JSON.stringify(picks));
  return {
    past: window.__tripTest.eventIsPast({ startsAt: new Date(past).toISOString() }),
    future: window.__tripTest.eventIsPast({ startsAt: new Date(Date.now() + 86400000).toISOString() }),
    place: window.__tripTest.eventIsPast({ name: 'A castle' }),
  };
}, longAgo);
check('a date that has passed is past', stale.past === true, JSON.stringify(stale));
check('tomorrow is not', stale.future === false, JSON.stringify(stale));
check('and a place with no date is never past', stale.place === false, JSON.stringify(stale));

await page.evaluate(() => document.querySelector('[data-view="picks"]').click());
await page.waitForTimeout(700);
check('the list says which one has been and gone', await page.evaluate(() =>
  /been and gone/.test(document.getElementById('view').textContent)),
  await page.evaluate(() => document.getElementById('view').textContent.slice(0, 300)));

await browser.close();
console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILED`);
process.exit(failures ? 1 : 0);
