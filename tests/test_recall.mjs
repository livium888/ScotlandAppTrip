// "The events near me barely returns any results... I feel there might be more
// results but you are hiding them???"
//
// Two separate complaints wearing one sentence, and both were fair.
//
// FINDING FEWER THAN THERE WERE. An event was placed by geocoding its venue
// first and its town second — but the first lookup that landed outside the
// search area ended the event there and then, as "too far away", before the
// town it actually named was ever looked at. A venue name is a weak claim
// about geography: "The Corn Exchange", "The Barn" and "St Mary's Hall" exist
// in fifty towns. A gazetteer hit on the wrong one threw away a perfectly
// local event. Separately, a date had to be typed exactly YYYY-MM-DD, so
// 2026-8-3 and 2026-08-03T19:30:00Z — the same day, said differently — were
// discarded as undated.
//
// HIDING WHAT IT FOUND. The counters explaining what had been dropped were
// only ever printed when *nothing* survived. Six results with thirty silently
// binned behind them looked exactly like a thin area. And the "Found" heading
// counted the results while the list underneath it counted the results minus
// the ones already saved, so the number never matched the rows.
import { chromium } from 'playwright';
import { ANGLE_MARKERS, angleFromPrompt, ANGLE_KEYS } from './lib/angles.mjs';
import { chooseWhen, openAnglePencils, openEventForm } from './lib/screens.mjs';
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

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const soonIso = iso(new Date(Date.now() + 2 * 86400000));
// The same day, written the three ways a model actually writes it.
const looseIso = soonIso.replace(/-0(\d)/g, '-$1');
const stampedIso = `${soonIso}T19:30:00Z`;
const slashIso = soonIso.replace(/-/g, '/');
const wayOutIso = iso(new Date(Date.now() + 300 * 86400000));

const ANGLES = {
  // The heart of it: a venue whose name belongs to a town 300 miles away,
  // in an event that plainly says Stirling.
  music: [{ name: 'Ceilidh at the Corn Exchange', date: soonIso, time: '20:00', endTime: '23:00',
    venue: 'The Corn Exchange', area: 'Stirling', what: 'Fiddles.', price: '£' }],
  // Same name, same day, two different towns. One event, not two, was wrong.
  market: [{ name: 'Farmers Market', date: soonIso, time: '09:00', endTime: '13:00',
    venue: 'Port Street', area: 'Stirling', what: 'Producers.', price: 'free' }],
  family: [{ name: 'Farmers Market', date: soonIso, time: '10:00', endTime: '14:00',
    venue: 'Fountain Road', area: 'Bridge of Allan', what: 'A different market.', price: 'free' }],
  // Dates written the ways a model writes them rather than the way we asked.
  arts: [
    { name: 'Loose Date Play', date: looseIso, time: '19:30', venue: 'The Tolbooth', area: 'Stirling', what: 'Am-dram.', price: '££' },
    { name: 'Stamped Date Recital', date: stampedIso, time: '19:30', venue: 'Albert Halls', area: 'Stirling', what: 'Piano.', price: '££' },
    { name: 'Slashed Date Screening', date: slashIso, time: '20:00', venue: 'Macrobert', area: 'Stirling', what: 'Film.', price: '£' },
  ],
  outdoors: [
    { name: 'Ochils Guided Walk', date: soonIso, time: '10:00', venue: 'Dumyat car park', area: 'Stirling', what: 'Five miles.', price: '£' },
    // Refused, and counted as refused rather than as nothing.
    { name: 'Sometime Soon Fair', date: 'next Saturday', venue: 'A field', area: 'Stirling', what: 'No date.', price: 'free' },
    { name: 'Christmas Market', date: wayOutIso, venue: 'The Square', area: 'Stirling', what: 'Months away.', price: 'free' },
  ],
  // Held back rather than binned: real listings that couldn't be pinned.
  fetes: [
    { name: 'A Thing In London', date: soonIso, time: '19:00', venue: 'Somewhere', area: 'Chelsea, London', what: 'The model got lost.', price: 'free' },
    { name: 'Nowhere Gathering', date: soonIso, time: '18:00', venue: '', area: '', what: 'No place, no town.', price: 'free',
      tickets: 'https://example.com/nowhere' },
  ],
};

await page.route(/generativelanguage\.googleapis\.com/, (route) => {
  const url = route.request().url();
  if (/\/models\?/.test(url)) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      models: [{ name: 'models/gemini-3.5-flash-lite', supportedGenerationMethods: ['generateContent'] }] }) });
  }
  const prompt = JSON.parse(route.request().postData() || '{}').contents[0].parts[0].text;
  const angle = angleFromPrompt(prompt) || 'music';
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    candidates: [{ content: { parts: [{ text: JSON.stringify(ANGLES[angle]) }] },
      groundingMetadata: { groundingChunks: [{ web: { uri: 'https://example.com/whats-on', title: "What's on" } }] } }] }) });
});

// True to life and deliberately awkward. "The Corn Exchange" resolves — to
// Newbury, 300 miles south. Every other venue name resolves to nothing. Only
// the towns are reliable, which is exactly the real-world shape.
await page.route(/nominatim\.openstreetmap\.org/, (route) => {
  const q = decodeURIComponent(route.request().url());
  const hit = (lat, lon, name, town) => route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify([{ lat: String(lat), lon: String(lon), display_name: name, type: 'town',
      namedetails: { name }, address: { town }, extratags: {} }]) });
  if (/Corn\+?\s*Exchange/i.test(q)) return hit(51.4014, -1.3231, 'The Corn Exchange, Newbury', 'Newbury');
  if (/Chelsea|London/i.test(q)) return hit(51.4875, -0.1687, 'Chelsea, London', 'London');
  if (/Bridge(\+|\s|%20)of(\+|\s|%20)Allan/i.test(q)) return hit(56.1530, -3.9470, 'Bridge of Allan', 'Bridge of Allan');
  if (/Stirling/i.test(q)) return hit(56.1165, -3.9369, 'Stirling', 'Stirling');
  return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
});
await page.route(/wikidata|wikipedia|overpass|open-meteo|photon|places\.googleapis|upload\.|tile\./, (r) => r.abort());

await page.goto(BASE, { waitUntil: 'load' });
await page.evaluate(() => {
  localStorage.setItem('boards-v1', JSON.stringify({
    activeId: 'b-r', boards: [{ id: 'b-r', name: 'Trip', destination: 'Scotland', dated: true, hasGuide: false, createdAt: 1 }] }));
  localStorage.setItem('trip-settings-v1', JSON.stringify({
    destination: 'Scotland', geminiKey: 'KEY', geminiModel: 'models/gemini-3.5-flash-lite' }));
  localStorage.setItem('board:b-r:folders', JSON.stringify(['Stirling']));
  localStorage.setItem('board:b-r:picks', JSON.stringify([]));
  localStorage.setItem('board:b-r:plan', JSON.stringify({ days: [], items: {} }));
  localStorage.setItem('board:b-r:search-anchor', JSON.stringify({ name: 'Stirling', lat: 56.1165, lon: -3.9369, miles: 15 }));
});
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(600);

// The search takes as long as it takes; sleeping a guess at it is either
// flaky or slow, and this suite was both. The loading card is on screen for
// exactly as long as the search runs, so that is the thing to wait on.
const searchDone = async () => {
  // A real end condition rather than the absence of a sentence. Results now
  // stream in, so "the loading copy has gone" was never the right question -
  // and the copy has changed anyway.
  await page.waitForFunction(() => !window.__tripTest.eventsBusy(), null, { timeout: 40000 });
  await page.waitForTimeout(250);
};

// ---------- Dates, read the way they are written ----------

const dates = await page.evaluate(() => {
  const p = window.__tripTest.parseEventDate;
  const day = (d) => (d ? `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}` : null);
  return {
    padded: day(p('2026-09-05')),
    loose: day(p('2026-9-5')),
    slashed: day(p('2026/09/05')),
    stamped: day(p('2026-09-05T19:30:00Z')),
    spaced: day(p('2026-09-05 19:30')),
    vague: p('next Saturday'),
    season: p('late August'),
    empty: p(''),
    impossibleDay: p('2026-02-30'),
    impossibleMonth: p('2026-13-05'),
  };
});
check('a padded date is read', dates.padded === '2026-9-5', JSON.stringify(dates));
check('and so is the same day without the padding', dates.loose === '2026-9-5', JSON.stringify(dates));
check('and written with slashes', dates.slashed === '2026-9-5', JSON.stringify(dates));
check('and with a time stamped on the end', dates.stamped === '2026-9-5', JSON.stringify(dates));
check('and with a time after a space', dates.spaced === '2026-9-5', JSON.stringify(dates));
check('"next Saturday" is still refused rather than guessed at', dates.vague === null, JSON.stringify(dates));
check('and so is "late August"', dates.season === null, JSON.stringify(dates));
check('and nothing at all', dates.empty === null, JSON.stringify(dates));
// Date rolls 2026-02-30 forward to March without complaining, which would put
// an event on a day nobody listed it for.
check('the 30th of February is a mistake, not a date in March', dates.impossibleDay === null, JSON.stringify(dates));
check('and neither is a thirteenth month', dates.impossibleMonth === null, JSON.stringify(dates));

// ---------- The search itself ----------

await page.evaluate(() => document.querySelector('[data-view="events"]').click());
await page.waitForTimeout(400);
await openEventForm(page);
await chooseWhen(page, 'week');
await page.waitForTimeout(200);
await page.evaluate(() => localStorage.removeItem('event-cache-v1'));
await page.evaluate(() => document.getElementById('evSearch').click());
await searchDone();

const screen = () => page.evaluate(() => document.getElementById('view').textContent.replace(/\s+/g, ' '));
const names = () => page.evaluate(() =>
  Array.from(document.querySelectorAll('.ev-row .ev-name')).map((e) => e.textContent.trim()));
let found = await names();

// The bug this suite exists for.
check('a venue whose name belongs to another town does not sink the event',
  found.some((n) => /Corn Exchange/.test(n)), JSON.stringify(found));
check('the town it named is what decides where it is', await page.evaluate(() =>
  /Stirling/.test(document.getElementById('view').textContent)));

// Dates written three ways, all three kept.
check('a date without padding is not an undated event', found.some((n) => /Loose Date/.test(n)), JSON.stringify(found));
check('nor is one with a time stamped on it', found.some((n) => /Stamped Date/.test(n)), JSON.stringify(found));
check('nor one written with slashes', found.some((n) => /Slashed Date/.test(n)), JSON.stringify(found));

// Same name, same day, two towns.
check('two markets of the same name in different towns are two events',
  found.filter((n) => /Farmers Market/.test(n)).length === 2, JSON.stringify(found));

// Still refused, because the town itself says elsewhere.
check('a thing in London is still not on near Stirling',
  !found.some((n) => /A Thing In London/.test(n)), JSON.stringify(found));

// ---------- Saying what it left out ----------

const text = await screen();
check('it says out loud that things were left out, without having to fail first',
  /Left out:/.test(text), text.slice(0, 600));
check('and that one had no usable date', /had no usable date/.test(text), text.slice(0, 600));
check('and that one fell outside the dates asked for', /fell outside those dates/.test(text), text.slice(0, 600));
check('and that one looked like somewhere else', /looked like somewhere else/.test(text), text.slice(0, 600));
// Buried under the whole list, it answers "there must be more than this"
// only after you have given up looking.
check('and it says so above the results rather than under them', await page.evaluate(() => {
  const note = document.querySelector('.ev-leftout');
  const firstRow = document.querySelector('.ev-row');
  return !!note && !!firstRow &&
    (note.compareDocumentPosition(firstRow) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}));
// And the form that produced them folds away, so the answers are the screen.
check('the search form folds up once it has answered', await page.evaluate(() =>
  !!document.getElementById('evEdit') && !document.getElementById('evSearch')));
check('with one line saying what was asked', await page.evaluate(() =>
  /Stirling/.test(document.getElementById('evEdit').textContent)),
  await page.evaluate(() => document.getElementById('evEdit')?.textContent));
await page.evaluate(() => document.getElementById('evEdit').click());
await page.waitForTimeout(300);
check('and a tap opens it again', await page.evaluate(() => !!document.getElementById('evSearch')));
check('with the results still underneath it', await page.evaluate(() =>
  document.querySelectorAll('.ev-row').length > 0));

// The count that never matched the list under it.
const heading = await page.evaluate(() => {
  const h = Array.from(document.querySelectorAll('.list-head')).find((e) => /Found/.test(e.textContent));
  return h ? Number(h.querySelector('.list-head-count').textContent.trim()) : null;
});
const savable = await page.evaluate(() => document.querySelectorAll('[data-save-event]').length);
check('the "Found" count is the number of rows under it', heading === savable, `heading ${heading}, rows ${savable}`);

// ---------- Nothing binned on your behalf ----------

check('the ones it could not confirm are offered rather than binned', await page.evaluate(() =>
  !!document.getElementById('evShowHeld')));
check('and they are not on screen until asked for',
  !found.some((n) => /Nowhere Gathering/.test(n)), JSON.stringify(found));

await page.evaluate(() => { const b = document.getElementById('evShowHeld'); if (b) b.click(); });
await page.waitForTimeout(400);
found = await names();
check('asked for, they appear', found.some((n) => /Nowhere Gathering/.test(n)), JSON.stringify(found));
check('each with the reason it was held back',
  /couldn't be placed on the map|looks like it's somewhere else/.test(await screen()), (await screen()).slice(0, 900));

await page.evaluate(() => { const b = document.querySelector('[data-save-held]'); if (b) b.click(); });
await page.waitForFunction(() =>
  JSON.parse(localStorage.getItem('board:b-r:picks') || '[]').some((p) => p.kind === 'event'),
  null, { timeout: 15000 }).catch(() => {});
const heldSaved = await page.evaluate(() =>
  JSON.parse(localStorage.getItem('board:b-r:picks')).filter((p) => p.kind === 'event'));
check('and one can be saved anyway, which is the whole point of showing them',
  heldSaved.length === 1, JSON.stringify(heldSaved.map((p) => p.name)));
check('marked as unconfirmed when it is saved',
  !!(heldSaved[0] && heldSaved[0].unverified), JSON.stringify(heldSaved.map((p) => [p.name, p.unverified])));

await browser.close();
console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILED`);
process.exit(failures ? 1 : 0);
