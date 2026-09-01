// "You need the ability for the event to differentiate between indoors and
// outdoors" — and then, asked what else a parent needs: the timing against
// naps and bedtime, the age it is really pitched at, and whether it has to be
// booked.
//
// The screen could tell you an event existed and nothing else, which is the
// easy half. For a parent the question is never "is this interesting", it is
// "can we pull this off", and it turns on the same four things every time.
//
// Two rules run through all of this. An unknown is said out loud rather than
// guessed at — "we don't know if this is indoors" is a real answer and the
// screen gives it. And the verdict is ONE line: a row wearing six badges is a
// row nobody reads, and only one of the six is ever the reason you don't go.
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
await page.route(/nominatim|wikidata|wikipedia|overpass|tile\.|photon|places\.googleapis/, (r) => r.abort());

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const inDays = (n) => iso(new Date(Date.now() + n * 86400000));

await page.goto(BASE, { waitUntil: 'load' });
await page.evaluate(() => {
  localStorage.setItem('boards-v1', JSON.stringify({
    activeId: 'b-d', boards: [{ id: 'b-d', name: 'Trip', destination: 'Peak District', dated: true, hasGuide: false, createdAt: 1 }] }));
  localStorage.setItem('board:b-d:picks', JSON.stringify([]));
  localStorage.setItem('board:b-d:plan', JSON.stringify({ days: [], items: {} }));
});
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(500);

// A missing export throws inside the page and kills the run, which prints no
// FAIL lines at all - so a suite that is genuinely failing looks like a suite
// that never ran. Catching turns "this does not exist yet" into an ordinary
// failed assertion, which is what it is.
const T = async (fn, ...args) => {
  try {
    return await page.evaluate(fn, ...args);
  } catch (e) {
    console.log(`  (nothing to call: ${String(e.message).split('\n')[0]})`);
    return null;
  }
};
const has = (o, k) => !!(o && o[k] !== undefined && o[k] !== null);

// ---------- The contract refuses rather than coerces ----------

const norm = await T(() => {
  const w = { from: new Date(2026, 8, 1), to: new Date(2026, 8, 30) };
  const n = (extra) => window.__tripTest.normaliseEvent(
    Object.assign({ name: 'A thing', date: '2026-09-12' }, extra), w);
  return {
    indoors: n({ setting: 'Indoors' }),
    outdoor: n({ setting: 'outdoor' }),
    vague: n({ setting: 'probably inside' }),
    missing: n({}),
    band: n({ minAge: 3, maxAge: 7 }),
    backwards: n({ minAge: 11, maxAge: 5 }),
    worded: n({ minAge: 'five' }),
    aimed: n({ childFocus: 'aimed' }),
    adults: n({ childFocus: 'adults' }),
    bookReq: n({ booking: 'required' }),
    bookNone: n({ booking: 'none' }),
  };
});
check('a setting is read whatever the capitalisation', !!norm && norm.indoors.setting === 'indoor', JSON.stringify(norm && norm.indoors.setting));
check('prose is refused rather than interpreted', !!norm && norm.vague.setting === '', JSON.stringify(norm && norm.vague.setting));
// The line that matters most in this file: an unknown must never be able to
// pass for a known answer, or every screen below it is lying.
check('and an unknown setting is not quietly an indoor one',
  !!norm && norm.missing.setting !== 'indoor' && norm.missing.setting !== 'outdoor', JSON.stringify(norm && norm.missing.setting));
check('an age band is kept', !!norm && norm.band.minAge === 3 && norm.band.maxAge === 7, JSON.stringify(norm && [norm.band.minAge, norm.band.maxAge]));
// Date rolls 2026-02-30 into March; a backwards age band has no such rescue,
// and there is no way to tell which half was meant.
check('a backwards age band is a mistake, not a range',
  !!norm && norm.backwards.minAge === null && norm.backwards.maxAge === null, JSON.stringify(norm && [norm.backwards.minAge, norm.backwards.maxAge]));
check('"five" is not five', !!norm && norm.worded.minAge === null, JSON.stringify(norm && norm.worded.minAge));
check('aimed-at-children is kept', !!norm && norm.aimed.childFocus === 'aimed');
check('and adults-only is a different answer from not saying',
  !!norm && norm.adults.childFocus === 'adults' && norm.missing.childFocus === '', JSON.stringify(norm && [norm.adults.childFocus, norm.missing.childFocus]));
// A boolean would have collapsed these two, and the false would have been
// printed on a row as "not for children".
check('"nobody said" is not "not for children"',
  !!norm && norm.missing.childFocus !== 'adults' && norm.missing.childFocus !== 'allowed', JSON.stringify(norm && norm.missing.childFocus));
check('booking required is carried both ways',
  !!norm && norm.bookReq.bookingLevel === 'required' && norm.bookReq.booking === true, JSON.stringify(norm && [norm.bookReq.bookingLevel, norm.bookReq.booking]));
check('turn-up-on-the-day does not count as needing booking',
  !!norm && norm.bookNone.booking === false, JSON.stringify(norm && norm.bookNone.booking));
check('and nor does an unknown, which must not cry wolf',
  !!norm && norm.missing.booking === false, JSON.stringify(norm && norm.missing.booking));

// ---------- A stated setting beats a guess from the name ----------

const outdoor = await T(() => {
  const f = window.__tripTest.looksOutdoor;
  return {
    saidOutdoor: f({ setting: 'outdoor', name: 'Ceilidh in the hall' }),
    // "Park" matches the regex. The listing says indoors. The listing wins.
    saidIndoor: f({ setting: 'indoor', name: 'Kelvingrove Park Bandstand Hall Ceilidh' }),
    partly: f({ setting: 'both', name: 'Village fete' }),
    guessed: f({ name: 'Riverside Walk' }),
    place: f({ category: 'Museum', name: 'The Whitworth' }),
  };
});
check('an event that says outdoors is outdoors, whatever it is called', !!outdoor && outdoor.saidOutdoor === true);
check('and one that says indoors is not, even with "Park" in its name', !!outdoor && outdoor.saidIndoor === false);
check('a partly-outdoor thing counts, because rain still spoils it', !!outdoor && outdoor.partly === true);
check('with nothing said, the old guess still runs', !!outdoor && outdoor.guessed === true);
check('and a saved place is judged exactly as it was', !!outdoor && outdoor.place === false);

// ---------- Naps, and the event you could simply go to earlier ----------

await T(() => localStorage.setItem('people-v1', JSON.stringify([
  { name: 'Ally', age: 3, naps: true, napFrom: '', napTo: '', bedtime: '' },
  { name: 'Sam', age: 38 },
])));

const naps = await T(() => {
  const f = window.__tripTest.napIsUnavoidable;
  return {
    startsInIt: f({ time: '13:30', endTime: '' }),
    spansIt: f({ time: '10:00', endTime: '16:00' }),
    whollyInside: f({ time: '13:15', endTime: '14:30' }),
    before: f({ time: '11:00', endTime: '12:30' }),
    after: f({ time: '15:00', endTime: '17:00' }),
    allDay: f({ time: '', endTime: '' }),
  };
});
// The distinction the old check could not draw, and the reason it matters:
// a warning on something perfectly doable teaches you to ignore warnings.
check('a 13:30 workshop lands in the nap', !!naps && naps.startsInIt === true, JSON.stringify(naps));
check('but a market open 10:00–16:00 does not — you go in the morning and leave',
  !!naps && naps.spansIt === false, JSON.stringify(naps));
check('something that runs only inside the nap does', !!naps && naps.whollyInside === true, JSON.stringify(naps));
check('a morning thing does not', !!naps && naps.before === false, JSON.stringify(naps));
check('nor one starting as the nap ends', !!naps && naps.after === false, JSON.stringify(naps));
check('and an all-day thing with no times is never called a clash', !!naps && naps.allDay === false, JSON.stringify(naps));

const oldCheck = await T(() => ({
  inNap: window.__tripTest.clashesWithNap('13:30'),
  outOfNap: window.__tripTest.clashesWithNap('11:00'),
  none: window.__tripTest.clashesWithNap(''),
}));
check('and the check a planned stop uses is untouched',
  !!oldCheck && oldCheck.inNap === true && oldCheck.outOfNap === false && oldCheck.none === false, JSON.stringify(oldCheck));

const custom = await T(() => {
  localStorage.setItem('people-v1', JSON.stringify([
    { name: 'Ally', age: 3, naps: true, napFrom: '12:30', napTo: '14:00' }]));
  return { early: window.__tripTest.clashesWithNap('12:45'), late: window.__tripTest.clashesWithNap('14:30') };
});
check('a nap window you set is the one that is used',
  !!custom && custom.early === true && custom.late === false, JSON.stringify(custom));

// ---------- Bedtime, which has to work before anybody sets it ----------

const bed = await T(() => {
  const f = window.__tripTest.bedtimeOf;
  return {
    toddler: f({ age: 3, bedtime: '' }),
    typed: f({ age: 3, bedtime: '18:45' }),
    older: f({ age: 11, bedtime: '' }),
    adult: f({ age: 38, bedtime: '' }),
  };
});
// A feature that only works once you have configured it does not work.
check('a three-year-old has a bedtime before anyone types one', has(bed, 'toddler'), JSON.stringify(bed));
check('and typing one overrides it', !!bed && bed.typed === 18 * 60 + 45, JSON.stringify(bed));
check('an eleven-year-old has one too — a 21:00 gig is a real problem at eleven',
  has(bed, 'older') && bed.older > bed.toddler, JSON.stringify(bed));
check('an adult does not', !!bed && bed.adult === null, JSON.stringify(bed));

// ---------- One line, and the right one ----------

await T(() => localStorage.setItem('people-v1', JSON.stringify([
  { name: 'Ally', age: 3, naps: true, bedtime: '19:00' }, { name: 'Sam', age: 38 }])));

const ladder = await T(() => {
  const v = window.__tripTest.eventVerdict;
  const base = { name: 'A thing', time: '21:00', setting: 'outdoor', childFocus: 'adults',
    bookingLevel: 'required', minAge: null, maxAge: null, endTime: '' };
  const wet = { rainChance: 80 };
  const out = {};
  out.everything = v(base, wet);
  out.notAdults = v(Object.assign({}, base, { childFocus: '' }), wet);
  out.earlier = v(Object.assign({}, base, { childFocus: '', time: '13:30' }), wet);
  out.noNap = v(Object.assign({}, base, { childFocus: '', time: '10:00', endTime: '12:00' }), wet);
  out.dry = v(Object.assign({}, base, { childFocus: '', time: '10:00', endTime: '12:00' }), { rainChance: 5 });
  out.nothing = v({ name: 'x', time: '10:00', endTime: '12:00', setting: 'indoor', childFocus: '', bookingLevel: 'none' }, { rainChance: 5 });
  return out;
});
// Irreversibility first, then fixability, then certainty: a door that won't
// let you in beats a clock you could bend, which beats a booking you can make
// from the sofa, which beats a forecast four days out.
check('adults-only outranks everything else', !!ladder && !!ladder.everything && ladder.everything.key === 'adults-only', JSON.stringify(ladder && ladder.everything));
check('then bedtime', !!ladder && !!ladder.notAdults && ladder.notAdults.key === 'bedtime', JSON.stringify(ladder && ladder.notAdults));
check('then the nap', !!ladder && !!ladder.earlier && ladder.earlier.key === 'nap', JSON.stringify(ladder && ladder.earlier));
check('then booking, which is a job rather than a blocker',
  !!ladder && !!ladder.noNap && ladder.noNap.key === 'book', JSON.stringify(ladder && ladder.noNap));
check('rain only when it is actually forecast',
  !!ladder && !!ladder.dry && ladder.dry.key === 'book', JSON.stringify(ladder && ladder.dry));
check('and most of the time there is nothing worth saying', !!ladder && ladder.nothing === null, JSON.stringify(ladder && ladder.nothing));

const ages = await T(() => {
  const v = window.__tripTest.eventVerdict;
  const e = (extra) => v(Object.assign({ name: 'x', time: '10:00', setting: 'indoor', bookingLevel: 'none', childFocus: '' }, extra), {});
  return {
    tooYoung: e({ minAge: 8 }),
    fits: e({ minAge: 2, maxAge: 5, childFocus: 'aimed' }),
    tooOld: e({ maxAge: 2 }),
  };
});
check('an 8+ event is refused for a three-year-old', !!ages && !!ages.tooYoung && ages.tooYoung.key === 'too-young', JSON.stringify(ages && ages.tooYoung));
check('a band that fits is said as a good thing, not a warning',
  !!ages && !!ages.fits && ages.fits.key === 'aimed' && ages.fits.tone === 'yes', JSON.stringify(ages && ages.fits));
check('and being too old for it is its own answer', !!ages && !!ages.tooOld && ages.tooOld.key === 'too-old', JSON.stringify(ages && ages.tooOld));

// The guarantee that makes this safe to ship: with nobody on the list, the
// screen looks exactly as it did before any of this existed.
const noPeople = await T(() => {
  localStorage.removeItem('people-v1');
  const v = window.__tripTest.eventVerdict;
  return [
    v({ name: 'x', time: '21:00', childFocus: 'adults', minAge: 18, setting: 'indoor', bookingLevel: 'none' }, {}),
    v({ name: 'y', time: '13:30', setting: 'indoor', bookingLevel: 'none', childFocus: '' }, {}),
  ];
});
check('with nobody added, none of it fires', !!noPeople && noPeople.every((x) => x === null), JSON.stringify(noPeople));

// ---------- What a saved event keeps ----------

const kept = await T(() => {
  const from = { startsAt: '2026-09-12T00:00:00.000Z', endsAt: '2026-09-15T00:00:00.000Z',
    time: '10:00', endTime: '16:00', venue: 'The Square', approximate: true,
    setting: 'outdoor', minAge: 2, maxAge: 8, childFocus: 'aimed', bookingLevel: 'advised',
    booking: true, price: '£', ticketUrl: '', recurring: false };
  const to = {};
  window.__tripTest.copyEventFields(from, to);
  return { to, fields: window.__tripTest.EVENT_FIELDS };
});
// Both of these were dropped on the way in, by two hand-written lists neither
// of which had everything. A festival became a one-day thing, and the
// "approx. location" caveat vanished exactly when the pin became a marker
// you would navigate to.
check('a saved event keeps how long it runs', !!kept && kept.to.endsAt === '2026-09-15T00:00:00.000Z', JSON.stringify(kept && kept.to.endsAt));
check('and keeps the warning that its position is approximate', !!kept && kept.to.approximate === true, JSON.stringify(kept && kept.to.approximate));
check('and its finish time', !!kept && kept.to.endTime === '16:00', JSON.stringify(kept && kept.to.endTime));
check('all four new answers survive the save',
  !!kept && kept.to.setting === 'outdoor' && kept.to.childFocus === 'aimed' &&
  kept.to.minAge === 2 && kept.to.bookingLevel === 'advised', JSON.stringify(kept && kept.to));
check('and there is one list of these rather than two',
  !!kept && ['endsAt', 'approximate', 'endTime', 'setting', 'childFocus', 'booking'].every((f) => kept.fields.includes(f)),
  JSON.stringify(kept && kept.fields));

// ---------- The nudge that arrives while you can still book ----------

const notes = await T((day) => {
  localStorage.setItem('notify-v1', JSON.stringify({ enabled: true, morning: '07:30' }));
  localStorage.setItem('board:b-d:picks', JSON.stringify([
    { id: 'e1', name: 'Puppet Show', kind: 'event', startsAt: `${day}T00:00:00.000Z`,
      time: '11:00', booking: true, bookingLevel: 'required', city: 'Bakewell', addedAt: 1 },
    { id: 'e2', name: 'Already Booked Thing', kind: 'event', startsAt: `${day}T00:00:00.000Z`,
      booking: true, booked: true, city: 'Bakewell', addedAt: 2 },
    // A place can carry booking too, and has no date to count back from.
    { id: 'p1', name: 'Ben Ledi Hill Walk', booking: true, city: 'Bakewell', addedAt: 3 },
  ]));
  return window.__tripTest.plannedNotifications(new Date()).map((n) => ({
    id: n.id, title: n.title, at: n.at.toISOString(), tab: n.tab }));
}, inDays(5));
const nudges = (notes || []).filter((n) => n.id >= 5000 && n.id < 5900);
check('an event that needs booking gets exactly one nudge', nudges.length === 1, JSON.stringify(notes));
check('naming the thing to book', nudges.length === 1 && /Puppet Show/.test(nudges[0].title), JSON.stringify(nudges));
check('and it lands while you can still book, not the morning of',
  nudges.length === 1 && nudges[0].at.slice(0, 10) === inDaysOutside(2), JSON.stringify(nudges));
check('nothing for one already booked', !notes.some((n) => /Already Booked/.test(n.title)), JSON.stringify(notes));
// A place with booking:true must not qualify — it has no date to count from.
check('and nothing for a place, which has no date to count back from',
  !notes.some((n) => /Ben Ledi/.test(n.title) && n.id >= 5000), JSON.stringify(notes));
check('it opens the events screen when tapped', nudges.length === 1 && nudges[0].tab === 'events', JSON.stringify(nudges));

function inDaysOutside(n) { return iso(new Date(Date.now() + n * 86400000)); }

const off = await T(() => {
  localStorage.setItem('notify-v1', JSON.stringify({ enabled: true, morning: '07:30', booking: false }));
  return window.__tripTest.plannedNotifications(new Date()).filter((n) => n.id >= 5000 && n.id < 5900).length;
});
check('and it can be turned off like the other three', off === 0, String(off));

// ---------- On the screen, with a forecast ----------
//
// The filter is offered only when rain is actually forecast, and offering it
// changes nothing until it is tapped.

const evDay = inDays(3);
await page.route(/generativelanguage\.googleapis\.com/, (route) => {
  if (/\/models\?/.test(route.request().url())) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      models: [{ name: 'models/gemini-3.5-flash-lite', supportedGenerationMethods: ['generateContent'] }] }) });
  }
  const p = JSON.parse(route.request().postData() || '{}').contents[0].parts[0].text;
  // Matched on each angle's own wording. A looser marker like /children/ now
  // hits every prompt, because the contract itself asks whether a thing is
  // aimed at children - so the market angle would be answered with the
  // storytime and the outdoor event would never exist.
  const angle = angleFromPrompt(p);
  let list = [];
  if (angle === 'market') list = [{ name: 'Farmers Market', date: evDay, time: '09:00', endTime: '16:00',
    venue: 'Market Place', area: 'Bakewell', what: 'Producers.', price: 'free', setting: 'outdoor' }];
  else if (angle === 'family') list = [{ name: 'Toddler Storytime', date: evDay, time: '10:30', endTime: '11:15',
    venue: 'Library', area: 'Bakewell', what: 'Songs.', price: 'free', setting: 'indoor',
    minAge: 1, maxAge: 4, childFocus: 'aimed' }];
  else if (angle === 'fetes') list = [{ name: 'Village Fete', date: evDay, time: '11:00', endTime: '17:00',
    venue: 'The Green', area: 'Bakewell', what: 'Cakes.', price: 'free' }];
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    candidates: [{ content: { parts: [{ text: JSON.stringify(list) }] },
      groundingMetadata: { groundingChunks: [{ web: { uri: 'https://example.com/on', title: 'On' } }] } }] }) });
});
await page.route(/nominatim/, (route) => route.fulfill({ status: 200, contentType: 'application/json',
  body: JSON.stringify([{ lat: '53.2129', lon: '-1.6753', display_name: 'Bakewell', type: 'town',
    namedetails: { name: 'Bakewell' }, address: { town: 'Bakewell' }, extratags: {} }]) }));

let rainPct = 80;
await page.route(/open-meteo/, (route) => {
  const days = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(Date.now() + i * 86400000);
    days.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
  }
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ daily: {
    time: days, weather_code: days.map(() => 61), temperature_2m_max: days.map(() => 15),
    temperature_2m_min: days.map(() => 9), precipitation_probability_max: days.map(() => rainPct),
    precipitation_sum: days.map(() => 4), wind_speed_10m_max: days.map(() => 12) } }) });
});

const runSearch = async () => {
  await page.evaluate(() => {
    document.querySelector('[data-view="events"]').click();
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const edit = document.getElementById('evEdit');
    if (edit) edit.click();
  });
  await page.waitForTimeout(200);
  await chooseWhen(page, 'week');
  await page.waitForTimeout(200);
  await page.evaluate(() => localStorage.removeItem('event-cache-v1'));
  await page.evaluate(() => document.getElementById('evSearch').click());
  await page.waitForFunction(() => !window.__tripTest.eventsBusy(), null, { timeout: 40000 });
  // The forecast lands after the first paint and redraws the screen.
  await page.waitForTimeout(1500);
};
const rowNames = () => page.evaluate(() =>
  Array.from(document.querySelectorAll('.ev-row .ev-name')).map((e) => e.textContent.trim()));

await T(() => {
  localStorage.setItem('people-v1', JSON.stringify([
    { name: 'Ally', age: 3, naps: true, napFrom: '13:00', napTo: '15:00', bedtime: '19:00' },
    { name: 'Sam', age: 38 }]));
  localStorage.setItem('trip-settings-v1', JSON.stringify({
    destination: 'Peak District', geminiKey: 'KEY', geminiModel: 'models/gemini-3.5-flash-lite' }));
  localStorage.setItem('board:b-d:picks', JSON.stringify([]));
  localStorage.setItem('board:b-d:search-anchor', JSON.stringify({ name: 'Bakewell', lat: 53.2129, lon: -1.6753, miles: 15 }));
  localStorage.removeItem('weather-cache-v1');
});
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(500);
await runSearch();

const wetNames = await rowNames();
check('the search returns the three kinds of setting', wetNames.length === 3, JSON.stringify(wetNames));
const screenText = () => page.evaluate(() => document.getElementById('view').textContent.replace(/\s+/g, ' '));
// The forecast arriving has to repaint the screen. weatherFor keeps only the
// callback from the call that starts the fetch, so if anything asks without
// one first, every later asker registers nothing and the forecast lands with
// nobody listening - no chip, no warning, no clue anything was missing.
check('a wet forecast reaches the rows once it lands',
  /% rain that day/.test(await screenText()), (await screenText()).slice(0, 700));
check('and the filter is offered', await page.evaluate(() => !!document.getElementById('evIndoorOnly')));
// Offering is not doing.
check('but nothing has been hidden or moved by offering it',
  JSON.stringify(wetNames) === JSON.stringify(['Toddler Storytime', 'Farmers Market', 'Village Fete']) ||
  wetNames.length === 3, JSON.stringify(wetNames));
check('the thing nobody described says so rather than being guessed at',
  /indoors or out, not sure/.test(await screenText()), (await screenText()).slice(0, 700));

await page.evaluate(() => document.getElementById('evIndoorOnly').click());
await page.waitForTimeout(400);
const filtered = await rowNames();
check('tapping it drops what is definitely outdoors',
  !filtered.includes('Farmers Market'), JSON.stringify(filtered));
check('keeps what is indoors', filtered.includes('Toddler Storytime'), JSON.stringify(filtered));
// An event nobody described is not an event we get to throw away.
check('and keeps what nobody described either way', filtered.includes('Village Fete'), JSON.stringify(filtered));
check('the "Found" count still matches the rows under it', await page.evaluate(() => {
  const h = Array.from(document.querySelectorAll('.list-head')).find((e) => /Found/.test(e.textContent));
  return h && Number(h.querySelector('.list-head-count').textContent.trim()) ===
    document.querySelectorAll('[data-save-event]').length;
}));

await page.evaluate(() => document.getElementById('evIndoorOnly').click());
await page.waitForTimeout(400);
check('and turning it off puts back exactly what was there',
  JSON.stringify(await rowNames()) === JSON.stringify(wetNames), JSON.stringify(await rowNames()));

// A dry week has no filter to offer and nothing to warn about.
rainPct = 5;
await T(() => localStorage.removeItem('weather-cache-v1'));
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(500);
await runSearch();
check('a dry week offers no filter', await page.evaluate(() => !document.getElementById('evIndoorOnly')));
check('and says nothing about rain', !/% rain that day/.test(await screenText()), (await screenText()).slice(0, 500));
check('while the rest of the judgements still apply',
  /Aimed at/.test(await screenText()), (await screenText()).slice(0, 700));

// ---------- Backfilling what was saved before any of this ----------
//
// The risk in re-asking a model about something it already told you is that
// it replaces a right answer with a worse one. So the backfill fills blanks
// and only blanks, and is not allowed near what the event actually is.

await page.route(/generativelanguage\.googleapis\.com/, (route) => {
  if (/\/models\?/.test(route.request().url())) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      models: [{ name: 'models/gemini-3.5-flash-lite', supportedGenerationMethods: ['generateContent'] }] }) });
  }
  // Answers both, including a contradiction of the one already answered.
  const body = JSON.stringify([
    { n: 1, setting: 'indoor', minAge: 2, maxAge: 6, childFocus: 'aimed', booking: 'none' },
    { n: 2, setting: 'outdoor', minAge: null, maxAge: null, childFocus: 'allowed', booking: 'required' },
  ]);
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    candidates: [{ content: { parts: [{ text: body }] } }] }) });
});

const soon = inDays(6);
await T((day) => {
  localStorage.setItem('trip-settings-v1', JSON.stringify({
    destination: 'Peak District', geminiKey: 'KEY', geminiModel: 'models/gemini-3.5-flash-lite' }));
  localStorage.setItem('board:b-d:picks', JSON.stringify([
    // Knows nothing — the state of everything saved before this change.
    { id: 'old1', name: 'Old Storytime', kind: 'event', startsAt: `${day}T00:00:00.000Z`,
      time: '10:30', city: 'Bakewell', addedAt: 1 },
    // Already answered, and answered differently from what the model returns.
    { id: 'old2', name: 'Old Fair', kind: 'event', startsAt: `${day}T00:00:00.000Z`,
      time: '12:00', setting: 'indoor', childFocus: 'aimed', city: 'Bakewell', addedAt: 2 },
  ]));
}, soon);

const needs = await T(() => window.__tripTest.eventsNeedingBackfill().map((p) => p.name));
check('an event saved before this is noticed as needing filling in',
  !!needs && needs.includes('Old Storytime'), JSON.stringify(needs));

const result = await T(() => window.__tripTest.backfillEvents());
check('the backfill reports what it did', !!result && result.ok === true, JSON.stringify(result));

const after = await T(() => {
  const by = {};
  JSON.parse(localStorage.getItem('board:b-d:picks')).forEach((p) => { by[p.id] = p; });
  return by;
});
check('a blank is filled in', !!after && after.old1.setting === 'indoor', JSON.stringify(after && after.old1));
check('including the age band', !!after && after.old1.minAge === 2 && after.old1.maxAge === 6, JSON.stringify(after && after.old1));
check('and booking, so the morning brief and the nudge can see it',
  !!after && after.old1.childFocus === 'aimed', JSON.stringify(after && after.old1));
// The rule that makes accepting this safe.
check('an answer already on the pick is never overwritten, even when the model disagrees',
  !!after && after.old2.setting === 'indoor', JSON.stringify(after && after.old2));
check('and the same for the one it was asked about twice', !!after && after.old2.childFocus === 'aimed', JSON.stringify(after && after.old2));
// It answers four questions about an event. It does not get to rewrite one.
check('it never touches what the event actually is',
  !!after && after.old1.name === 'Old Storytime' && after.old1.time === '10:30' &&
  after.old2.name === 'Old Fair' && after.old2.startsAt.slice(0, 10) === soon,
  JSON.stringify(after && [after.old1.name, after.old1.time, after.old2.startsAt]));

const done = await T(() => window.__tripTest.eventsNeedingBackfill().length);
check('and once filled in there is nothing left to ask about', done === 0, String(done));

await browser.close();
console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILED`);
process.exit(failures ? 1 : 0);
