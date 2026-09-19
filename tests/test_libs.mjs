// Four vendored libraries, and what each one earns its place doing.
//
// The app had no build step and one dependency (Leaflet), and every one of
// these replaced something hand-rolled or filled a gap. What matters in a
// test is not that the library loads — it is that the app's own behaviour
// changed in the way that was the point, and that the careful bits of the old
// hand-rolled code were not thrown away with it.
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
await page.route(/generativelanguage|nominatim|wikidata|wikipedia|overpass|open-meteo|photon|places\.googleapis|upload\./, (r) => r.abort());
await page.route(/tile\./, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64') }));

const D = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const today = new Date();
const todayLabel = `Day 1 · ${D[today.getDay()]} ${today.getDate()} ${M[today.getMonth()]}`;

await page.goto(BASE, { waitUntil: 'load' });
await page.evaluate((label) => {
  localStorage.setItem('boards-v1', JSON.stringify({
    activeId: 'b-l', boards: [{ id: 'b-l', name: 'Trip', destination: 'Scotland', dated: true, hasGuide: false, createdAt: 1 }] }));
  localStorage.setItem('trip-settings-v1', JSON.stringify({ destination: 'Scotland', geminiKey: '', geminiModel: '' }));
  localStorage.setItem('board:b-l:folders', JSON.stringify(['Stirling', 'Skye']));
  const picks = [
    { id: 'p1', name: 'Stirling Castle', city: 'Stirling', category: 'Castle', lat: 56.1237, lon: -3.9474,
      addedAt: 1, photoChecked: true, openingHours: 'Apr-Sep: Mo-Su 09:30-18:00; Oct-Mar: Mo-Su 10:00-17:00',
      countryCode: 'gb', state: 'Scotland' },
    { id: 'p2', name: 'The Kilted Kangaroo', city: 'Stirling', category: 'Pub', lat: 56.119, lon: -3.936, addedAt: 2, photoChecked: true },
    { id: 'p3', name: 'Dunvegan Castle', city: 'Skye', category: 'Castle', lat: 57.4437, lon: -6.5906, addedAt: 3, photoChecked: true },
    { id: 'p4', name: 'Cafe Bruar', city: 'Stirling', category: 'Cafe', lat: 56.12, lon: -3.94, addedAt: 4, photoChecked: true, note: 'good bacon roll' },
  ];
  for (let i = 0; i < 8; i++) {
    picks.push({ id: `f${i}`, name: `Filler place ${i}`, city: 'Stirling', category: 'Shop',
      lat: 56.12 + i / 500, lon: -3.94, addedAt: 10 + i, photoChecked: true });
  }
  localStorage.setItem('board:b-l:picks', JSON.stringify(picks));
  localStorage.setItem('board:b-l:plan', JSON.stringify({
    days: [{ id: 'd1', label }],
    items: { d1: [{ pickId: 'p1', time: '10:00' }, { pickId: 'p4', time: '' }] } }));
}, todayLabel);
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(700);

// ---------- All four load, and none of them tramples anything ----------

const globalsOk = await page.evaluate(() => ({
  leaflet: typeof window.L === 'object' && typeof window.L.TileLayer === 'function',
  oh: typeof window.opening_hours === 'function',
  sun: typeof window.SunCalc === 'object',
  idb: typeof window.idb === 'object',
  fuse: typeof window.Fuse === 'function',
  jsonrepair: !!(window.JSONRepair && typeof window.JSONRepair.jsonrepair === 'function'),
  // Fuse ships as an ES module. Turning it into a plain script by deleting its
  // `export` line published all forty of its minified top-level names as
  // globals - one of which overwrote Leaflet's L and took the maps down. It is
  // wrapped in an IIFE now, and this is the check that it stays wrapped.
  leaked: ['e', 't', 'n', 'i', 'a', 'o', 'r', 's', 'c', 'u'].filter((k) => k in window),
}));
check('Leaflet still owns L', globalsOk.leaflet, JSON.stringify(globalsOk));
check('opening_hours is loaded', globalsOk.oh);
check('SunCalc is loaded', globalsOk.sun);
check('idb is loaded', globalsOk.idb);
check('Fuse is loaded', globalsOk.fuse);
check('jsonrepair is loaded', globalsOk.jsonrepair, JSON.stringify(globalsOk));
// It ships as a proper UMD, so unlike Fuse it should publish exactly one name
// and no minified single letters. Worth asserting rather than assuming.
check('and publishes only its own name', await page.evaluate(() =>
  !['jsonrepair', 'm', 'p', 'v', 'y'].some((k) => k in window && typeof window[k] === 'function' && k !== 'JSONRepair')),
  await page.evaluate(() => ['jsonrepair', 'm', 'p', 'v', 'y'].filter((k) => k in window).join(',')));
check('and Fuse leaks nothing into the global namespace',
  globalsOk.leaked.length === 0, JSON.stringify(globalsOk.leaked));

// ---------- opening_hours: what the hand-rolled parser refused ----------

const hours = await page.evaluate(() => {
  const gb = { countryCode: 'gb', state: 'Scotland', lat: 56.1, lon: -3.9 };
  const ask = (openingHours, day) => window.__tripTest.closingMinutesOnDay(openingHours, day, gb);
  return {
    seasonal: ask('Apr-Sep: Mo-Su 09:30-18:00; Oct-Mar: Mo-Su 10:00-17:00', 'Tu'),
    holidays: ask('Mo-Su 10:00-18:00; PH off', 'Mo'),
    sun: ask('sunrise-sunset', 'Tu'),
    // Still silence, and these are the ones that matter most.
    nonsense: ask('by appointment', 'Mo'),
    commented: ask('Mo-Su 09:30-17:00 "ring first"', 'Tu'),
  };
});
check('a seasonal rule is answered, which the old parser refused outright',
  hours.seasonal !== null, JSON.stringify(hours));
check('so is a public-holiday rule', hours.holidays === 18 * 60, JSON.stringify(hours));
check('and "sunrise-sunset", which needs the sun\'s actual position',
  hours.sun !== null, JSON.stringify(hours));
check('a string nobody can parse is still silence', hours.nonsense === null, JSON.stringify(hours));
// The whole reason the old parser was timid: a wrong "closed" sends you away
// from somewhere that is open. The library reports this one as closed unless
// you read getUnknown() as well.
check('and so is one whose hours carry a comment — unknown is not shut',
  hours.commented === null, JSON.stringify(hours));

// A holiday rule with no country cannot be answered, and must not take the
// rest of the string down with it.
const noCountry = await page.evaluate(() =>
  window.__tripTest.closingMinutesOnDay('Mo-Su 10:00-18:00; PH off', 'Mo', {}));
check('a holiday rule with no country still yields the ordinary week',
  noCountry === 18 * 60, String(noCountry));

// ---------- Fuse: finding something you already saved ----------

await page.evaluate(() => document.querySelector('[data-view="picks"]').click());
await page.waitForTimeout(500);

check('a list long enough to scroll offers a way to search it', await page.evaluate(() =>
  !!document.getElementById('pickFind')));

const rowNames = () => page.evaluate(() =>
  Array.from(document.querySelectorAll('.pick-row .pick-row-name')).map((e) => e.textContent.trim()));

const before = (await rowNames()).length;
check('everything is listed to begin with', before >= 12, String(before));

await page.fill('#pickFind', 'kangaroo');
await page.waitForTimeout(500);
const found = await rowNames();
check('typing narrows it to what matches', found.length === 1 && /Kangaroo/.test(found[0]), JSON.stringify(found));
check('and says how many of how many', await page.evaluate(() =>
  /1 of \d+ match/.test(document.getElementById('view').textContent)),
  await page.evaluate(() => document.getElementById('view').textContent.slice(0, 200)));

// The reason for a library rather than `includes()`.
await page.fill('#pickFind', 'kangroo');
await page.waitForTimeout(500);
check('a typo still finds it, which a substring match never would',
  (await rowNames()).some((n) => /Kangaroo/.test(n)), JSON.stringify(await rowNames()));

await page.fill('#pickFind', 'bacon roll');
await page.waitForTimeout(500);
check('and it searches your notes, not just the name',
  (await rowNames()).some((n) => /Bruar/.test(n)), JSON.stringify(await rowNames()));

await page.fill('#pickFind', 'zzzzquux');
await page.waitForTimeout(500);
check('nothing matching says so rather than showing an empty screen',
  await page.evaluate(() => /Nothing saved matches/.test(document.getElementById('view').textContent)));

await page.evaluate(() => { document.getElementById('pickFindClear').click(); });
await page.waitForTimeout(400);
check('clearing it brings the list back', (await rowNames()).length === before, String((await rowNames()).length));

// ---------- SunCalc: how much daylight is left ----------

const sun = await page.evaluate(() => {
  const at = { lat: 56.12, lon: -3.94 };
  const june = window.__tripTest.sunTimes(new Date(2026, 5, 21), at);
  const dec = window.__tripTest.sunTimes(new Date(2026, 11, 21), at);
  const hours = (t) => (t.sunset - t.sunrise) / 3600000;
  return { june: hours(june), dec: hours(dec) };
});
check('midsummer in Scotland is a long day', sun.june > 16, JSON.stringify(sun));
check('midwinter is a short one', sun.dec < 8, JSON.stringify(sun));
check('which is a seven-hour difference nobody works out in their head',
  sun.june - sun.dec > 8, JSON.stringify(sun));

await page.evaluate(() => document.querySelector('[data-view="today"]').click());
await page.waitForTimeout(600);
check('and the day says so', await page.evaluate(() =>
  /daylight left|Light from|doesn't (set|rise)/.test(document.getElementById('view').textContent)),
  await page.evaluate(() => document.getElementById('view').textContent.slice(0, 250)));

// ---------- The calendar file ----------

const ics = await page.evaluate(() => window.__tripTest.buildTripIcs());
check('a calendar file is produced from the plan', ics.count === 2, JSON.stringify(ics.count));
check('it is a calendar', /^BEGIN:VCALENDAR/.test(ics.text), ics.text.slice(0, 60));
check('with CRLF line endings, which is not optional in the format',
  ics.text.includes('\r\n') && !/[^\r]\n/.test(ics.text), JSON.stringify(ics.text.slice(0, 80)));
check('a timed stop is an appointment', /DTSTART:\d{8}T1000/.test(ics.text), (ics.text.match(/DTSTART[^\r]*/g) || []).join(' | '));
check('an untimed one is all day rather than invented',
  /DTSTART;VALUE=DATE:\d{8}/.test(ics.text), (ics.text.match(/DTSTART[^\r]*/g) || []).join(' | '));
check('the places are named', /SUMMARY:Stirling Castle/.test(ics.text));
check('and located, so the calendar can map them', /GEO:56\.1237;-3\.9474/.test(ics.text));
check('every event is closed', (ics.text.match(/BEGIN:VEVENT/g) || []).length === (ics.text.match(/END:VEVENT/g) || []).length);
check('and no line runs past the 75-octet limit',
  ics.text.split('\r\n').every((l) => l.length <= 75),
  (ics.text.split('\r\n').find((l) => l.length > 75) || '').slice(0, 90));

await browser.close();
console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILED`);
process.exit(failures ? 1 : 0);
