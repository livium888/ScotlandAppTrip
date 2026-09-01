// "Whenever you're looking for events, can you make sure you load them as the
// results come by? You don't have to wait until the end because it's a lot of
// loading and nothing is showing up."
//
// Measured, it was worse than it looked. Two hard barriers: a Promise.all over
// all six angles, and then all the geocoding, which could not start until
// every angle had answered. And callGemini does not use fetchWithTimeout - it
// has its own 45-second budget, and askOneAngle makes two attempts - so ONE
// dead angle cost ninety seconds and held the other five for all of it. Five
// angles could have answered in twelve seconds and you would still be looking
// at the same motionless sentence a minute later.
//
// The assertion this file exists for is the third one down: results from the
// fast searches are on screen while the slow one is still thinking. It cannot
// pass by accident, and it could not pass at all before this change.
import { chromium } from 'playwright';
import { ANGLE_MARKERS, angleFromPrompt, ANGLE_KEYS } from './lib/angles.mjs';
import { chooseWhen } from './lib/screens.mjs';
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
await page.route(/wikidata|wikipedia|overpass|tile\.|photon|places\.googleapis|open-meteo/, (r) => r.abort());

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const day = iso(new Date(Date.now() + 3 * 86400000));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The music angle is the slow one, and it is deliberately slower than every
// other angle put together.
const SLOW_MS = 9000;
let musicCalls = 0;
let musicResolvedAt = 0;
let failMusic = false;
const started = Date.now();

const ANGLES = {
  market: [{ name: 'Farmers Market', date: day, time: '09:00', endTime: '13:00',
    venue: 'Market Place', area: 'Bakewell', what: 'Producers.', price: 'free', setting: 'outdoor' }],
  family: [{ name: 'Toddler Storytime', date: day, time: '10:30', endTime: '11:15',
    venue: 'Library', area: 'Bakewell', what: 'Songs.', price: 'free', setting: 'indoor' }],
  arts: [{ name: 'Macbeth', date: day, time: '19:30', venue: 'Old Hall', area: 'Bakewell',
    what: 'Am-dram.', price: '££', setting: 'indoor' }],
  outdoors: [{ name: 'Monsal Ramble', date: day, time: '10:00', endTime: '13:00',
    venue: 'Monsal Head', area: 'Bakewell', what: 'Five miles.', price: 'free', setting: 'outdoor' }],
  // Found by two angles: one row, not two.
  fetes: [{ name: 'Farmers Market', date: day, time: '09:00', venue: 'Market Place',
    area: 'Bakewell', what: 'The same one, found twice.', price: 'free', tickets: 'https://example.com/mkt' }],
  // The three that replaced the old catch-all. Present so that "failed" means
  // the one angle this suite deliberately breaks, and not simply an angle the
  // mock forgot to answer for.
  hall: [{ name: 'Village Hall Coffee Morning', date: day, time: '10:00', endTime: '12:00',
    venue: 'Village Hall', area: 'Bakewell', what: 'Cake and a natter.', price: 'free', setting: 'indoor' }],
  clubs: [{ name: 'Horticultural Society Talk', date: day, time: '19:00', endTime: '20:30',
    venue: 'The Institute', area: 'Bakewell', what: 'Dahlias.', price: '£', setting: 'indoor' }],
  oneoff: [{ name: 'Well Dressing', date: day, time: '', venue: 'The Square',
    area: 'Bakewell', what: 'Once a year.', price: 'free', setting: 'outdoor' }],
  // Lands last, and belongs at 08:00 - above everything already on screen.
  music: [{ name: 'Dawn Chorus Walk', date: day, time: '08:00', endTime: '09:30',
    venue: 'The Woods', area: 'Bakewell', what: 'Early.', price: 'free', setting: 'outdoor' }],
};

await page.route(/generativelanguage\.googleapis\.com/, async (route) => {
  if (/\/models\?/.test(route.request().url())) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      models: [{ name: 'models/gemini-3.5-flash-lite', supportedGenerationMethods: ['generateContent'] }] }) });
  }
  const p = JSON.parse(route.request().postData() || '{}').contents[0].parts[0].text;
  const key = angleFromPrompt(p);

  if (key === 'music') {
    musicCalls++;
    await sleep(SLOW_MS);
    musicResolvedAt = Date.now() - started;
    if (failMusic) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        candidates: [{ content: { parts: [{ text: 'Sorry, I could not find anything.' }] } }] }) });
    }
  }
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    candidates: [{ content: { parts: [{ text: JSON.stringify(ANGLES[key] || []) }] },
      groundingMetadata: { groundingChunks: [{ web: { uri: 'https://example.com/on', title: 'On' } }] } }] }) });
});

await page.route(/nominatim/, (route) => route.fulfill({ status: 200, contentType: 'application/json',
  body: JSON.stringify([{ lat: '53.2129', lon: '-1.6753', display_name: 'Bakewell', type: 'town',
    namedetails: { name: 'Bakewell' }, address: { town: 'Bakewell' }, extratags: {} }]) }));

await page.goto(BASE, { waitUntil: 'load' });
await page.evaluate(() => {
  localStorage.setItem('boards-v1', JSON.stringify({
    activeId: 'b-s', boards: [{ id: 'b-s', name: 'Trip', destination: 'Peak District', dated: true, hasGuide: false, createdAt: 1 }] }));
  localStorage.setItem('trip-settings-v1', JSON.stringify({
    destination: 'Peak District', geminiKey: 'KEY', geminiModel: 'models/gemini-3.5-flash-lite' }));
  localStorage.setItem('board:b-s:picks', JSON.stringify([]));
  localStorage.setItem('board:b-s:plan', JSON.stringify({ days: [], items: {} }));
  localStorage.setItem('board:b-s:search-anchor', JSON.stringify({ name: 'Bakewell', lat: 53.2129, lon: -1.6753, miles: 15 }));
});
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(500);

const names = () => page.evaluate(() =>
  Array.from(document.querySelectorAll('.ev-row .ev-name')).map((e) => e.textContent.trim()));
const screen = () => page.evaluate(() => document.getElementById('view').textContent.replace(/\s+/g, ' '));
// Tolerant of the export not existing: a missing function throws inside the
// page and kills the run, which prints no FAIL lines at all - so a suite that
// is genuinely failing looks like one that never ran.
const busy = () => page.evaluate(() => {
  if (window.__tripTest && window.__tripTest.eventsBusy) return window.__tripTest.eventsBusy();
  return /Asking six different ways|Looking\./.test(document.getElementById('view').textContent);
});
const settle = async (ms) => {
  try {
    await page.waitForFunction(() => {
      if (window.__tripTest && window.__tripTest.eventsBusy) return !window.__tripTest.eventsBusy();
      return !/Asking six different ways|Looking\./.test(document.getElementById('view').textContent);
    }, null, { timeout: ms });
  } catch (e) {
    console.log('  (never settled)');
  }
};
const startSearch = async () => {
  await page.evaluate(() => document.querySelector('[data-view="events"]').click());
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const edit = document.getElementById('evEdit');
    if (edit) edit.click();
  });
  await page.waitForTimeout(150);
  await chooseWhen(page, 'week');
  await page.waitForTimeout(150);
  await page.evaluate(() => localStorage.removeItem('event-cache-v1'));
  await page.evaluate(() => document.getElementById('evSearch').click());
};

// ---------- The whole point ----------

await startSearch();
// Comfortably inside the slow angle's 9 seconds, and comfortably after the
// five fast ones have answered and been placed.
await page.waitForTimeout(4000);

const early = await names();
const stillGoing = await busy();
check('the search is still running at this point', stillGoing === true);
check('and the slow one has not answered yet', musicResolvedAt === 0, String(musicResolvedAt));
// This is the assertion the file exists for.
check('results from the searches that finished are already on screen',
  early.length >= 3, `${early.length}: ${JSON.stringify(early)}`);
check('including one that has been placed on the map, not just listed',
  early.includes('Toddler Storytime'), JSON.stringify(early));

// Each search named, with where it has got to.
// Specifically in the progress block - the kind-filter chips have always
// carried these names, so testing the screen text would pass without it.
const progress = await page.evaluate(() =>
  Array.from(document.querySelectorAll('.ev-angle')).map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
check('each search is named while it runs, with where it has got to',
  progress.length === ANGLE_KEYS.length && progress.some((t) => /Music & nightlife/.test(t)),
  JSON.stringify(progress));
check('and says how many have been found so far', /so far/.test(await screen()), (await screen()).slice(0, 400));
check('with a way to stop and keep them', await page.evaluate(() => !!document.getElementById('evStop')));
// The form is three rows of chips, a date line, six more chips and a button.
// Left open while the search runs, results stream in below the fold and you
// are back to looking at nothing - which was the complaint.
check('and the form has folded away, so the results are the screen',
  await page.evaluate(() => !document.getElementById('evSearch') && !!document.getElementById('evEdit')));
check('with the fold saying it is still working', await page.evaluate(() =>
  /Looking/.test(document.getElementById('evEdit').textContent)),
  await page.evaluate(() => document.getElementById('evEdit')?.textContent.replace(/\s+/g, ' ')));

// ---------- What lands late still lands in the right place ----------

await settle(40000);
const final = await names();
check('the slow one arrives in the end', final.includes('Dawn Chorus Walk'), JSON.stringify(final));
// It is an 08:00 event arriving after a 09:00 and a 10:30 were already shown.
// A diary is sorted by time, not by which search happened to answer first.
// It is an 08:00 event arriving after a 09:00 and a 10:30 were already shown,
// so it has to end up above both. (An all-day thing with no time at all sits
// above the lot, which is why this compares positions rather than taking the
// first row.)
check('and slots into the diary above what was already there',
  final.indexOf('Dawn Chorus Walk') < final.indexOf('Farmers Market') &&
  final.indexOf('Farmers Market') < final.indexOf('Toddler Storytime'), JSON.stringify(final));
check('a listing found by two searches is still one row',
  final.filter((n) => /Farmers Market/.test(n)).length === 1, JSON.stringify(final));
check('and the row kept what the second search knew about it',
  /Tickets & info/.test(await screen()), (await screen()).slice(0, 600));
check('every search shows as finished', await page.evaluate(() =>
  document.querySelectorAll('.ev-angle-done').length >= 5),
  await page.evaluate(() => document.querySelectorAll('.ev-angle').length));
check('and the stop button is gone once there is nothing to stop',
  await page.evaluate(() => !document.getElementById('evStop')));

// ---------- Stopping keeps what arrived ----------

await startSearch();
await page.waitForTimeout(3500);
const beforeStop = await names();
check('a second search is under way', beforeStop.length >= 1, JSON.stringify(beforeStop));
await page.evaluate(() => document.getElementById('evStop').click());
await page.waitForTimeout(400);
const afterStop = await names();
check('stopping keeps everything already found',
  afterStop.length === beforeStop.length, `${JSON.stringify(beforeStop)} -> ${JSON.stringify(afterStop)}`);
check('and says so', /Stopped/.test(await screen()), (await screen()).slice(0, 400));
check('the search is no longer running', (await busy()) === false);

// Nothing the abandoned angle brings back later may write into the screen.
await page.waitForTimeout(SLOW_MS + 1500);
check('and the search that was still going cannot write to it afterwards',
  JSON.stringify(await names()) === JSON.stringify(afterStop), JSON.stringify(await names()));

// ---------- A search that finds nothing says so, and offers a retry ----------

failMusic = true;
musicResolvedAt = 0;
musicCalls = 0;
await startSearch();
await settle(40000);
check('a search that came back with nothing is marked, not hidden',
  await page.evaluate(() => document.querySelectorAll('.ev-angle-failed').length === 1),
  await page.evaluate(() => document.querySelector('.ev-progress')?.textContent.replace(/\s+/g, ' ')));
check('it says which one, so a dead search does not look like a quiet week',
  /Music & nightlife came back with nothing/.test(await screen()), (await screen()).slice(0, 700));
check('and offers to try that one again', await page.evaluate(() =>
  !!document.querySelector('[data-ev-retry="music"]')));

const callsBefore = musicCalls;
failMusic = false;
await page.evaluate(() => document.querySelector('[data-ev-retry="music"]').click());
await settle(40000);
check('the retry re-runs only that search, not the other five',
  musicCalls === callsBefore + 1, `${callsBefore} -> ${musicCalls}`);
const retried = await names();
check('and merges what it finds into the list already there',
  retried.includes('Dawn Chorus Walk') && retried.includes('Toddler Storytime'), JSON.stringify(retried));

// ---------- Redrawing does not fight you ----------

const typing = await page.evaluate(() => {
  if (!window.__tripTest || !window.__tripTest.renderEvents) return { ok: false, why: 'no renderEvents export' };
  document.getElementById('evEdit')?.click();
  document.querySelector('[data-ev-when="custom"]').click();
  const input = document.getElementById('evFrom');
  if (!input) return { ok: false, why: 'no date field' };
  input.focus();
  const before = document.activeElement === input;
  // A redraw replaces every element on the screen, so without the guard this
  // takes the field out from under whoever is typing into it.
  window.__tripTest.renderEvents();
  return {
    ok: true,
    before,
    sameNode: document.getElementById('evFrom') === input,
    stillFocused: document.activeElement === input,
  };
});
check('a date being typed survives results arriving',
  typing.ok && typing.before && typing.sameNode && typing.stillFocused, JSON.stringify(typing));

// And the redraw it refused still happens once you are done with the field.
const resumed = await page.evaluate(() => {
  const input = document.getElementById('evFrom');
  input.blur();
  return new Promise((r) => setTimeout(() => r(!!document.getElementById('evFrom')), 300));
});
check('and the redraw it held back happens once you leave the field', resumed === true);

await browser.close();
console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILED`);
process.exit(failures ? 1 : 0);
