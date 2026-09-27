// "I also need a search for movies, and give the user a choice of ratings,
// like U, PG etc."
//
// Films are a kind of thing on, like a market or a gig, so they are searched
// the same way - where, when, the map, saving - with two things only films
// have: a BBFC rating you choose, and more than one showing a day. They are
// searched only when picked: a week of a city's cinema listings would bury
// everything else and double what a search costs.
import { chromium } from 'playwright';
import { goTo, openEventForm, openWhatSheet, closeAskSheet } from './lib/screens.mjs';
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
const later = new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10);
let prompts = [];
await page.route(/generativelanguage\.googleapis\.com/, (route) => {
  if (/\/models\?/.test(route.request().url())) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      models: [{ name: 'models/gemini-3.5-flash-lite', supportedGenerationMethods: ['generateContent'] }] }) });
  }
  const p = JSON.parse(route.request().postData() || '{}').contents[0].parts[0].text;
  prompts.push(p);
  const film = (name, rating, venue, times, extra) => Object.assign({
    name, date: day, endDate: later, time: times[0], times, venue, area: 'Edinburgh',
    what: 'A film.', price: '£', rating }, extra || {});
  const show = (name, venue, times, extra) => Object.assign({
    name, date: day, endDate: later, time: times[0], times, venue, area: 'Edinburgh', what: 'A show.', price: '££' }, extra || {});
  if (angleFromPrompt(p) === 'theatre') {
    const shows = [
      show('The Gruffalo', 'Church Hill Theatre', ['11:00', '14:00'], { childFocus: 'aimed', minAge: 3 }),
      show('Matilda the Musical', 'Festival Theatre', ['14:30', '19:30'], { childFocus: 'aimed', minAge: 8 }),
      show('Macbeth', 'Royal Lyceum', ['19:30'], { childFocus: 'allowed', minAge: 12 }),
      show('Late-Night Comedy', 'The Stand', ['22:00'], { childFocus: 'adults', minAge: 18 }),
      show('Twelfth Night', 'Royal Botanic Garden', ['18:00'], { childFocus: 'allowed', setting: 'outdoor' }),
    ];
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify(shows) }] },
        groundingMetadata: { groundingChunks: [{ web: { uri: 'https://theatres.example/edinburgh', title: 'Listings' } }] } }] }) });
  }
  const list = angleFromPrompt(p) === 'films'
    ? [
        film('Paddington in Peru', 'PG', 'Vue Omni', ['10:30', '13:15', '16:00'], { childFocus: 'aimed' }),
        film('Paddington in Peru', 'PG', 'Cineworld Fountainpark', ['11:00', '14:00']),
        film('The Wild Robot', 'U', 'Odeon Lothian Road', ['10:00', '12:20']),
        film('Conclave', '12A', 'Filmhouse', ['18:10', '20:40']),
        film('Alien: Romulus', '15', 'Vue Omni', ['21:00']),
        film('The Substance', '18', 'Cameo', ['21:30']),
        film('Mystery Screening', '', 'Cameo', ['19:00']),
      ]
    : [];
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    candidates: [{ content: { parts: [{ text: JSON.stringify(list) }] },
      groundingMetadata: { groundingChunks: [{ web: { uri: 'https://cinemas.example/edinburgh', title: 'Listings' } }] } }] }) });
});
await page.route(/nominatim/, (route) => route.fulfill({ status: 200, contentType: 'application/json',
  body: JSON.stringify([{ lat: '55.9533', lon: '-3.1883', display_name: 'Edinburgh', type: 'city',
    namedetails: { name: 'Edinburgh' }, address: { city: 'Edinburgh' }, extratags: {} }]) }));
await page.route(/overpass/, (route) => route.fulfill({ status: 200, contentType: 'application/json',
  body: JSON.stringify({ elements: [] }) }));
await page.route(/wikidata|wikipedia|googleapis\.com\/maps|tile\.|photon|open-meteo/, (r) => r.abort());

const seed = async (mode, people) => {
  await page.goto(BASE, { waitUntil: 'load' });
  await page.evaluate(([m, ppl]) => {
    localStorage.clear();
    localStorage.setItem('onboarded-v1', '1');
    localStorage.setItem('boards-v1', JSON.stringify({
      activeId: 'b', boards: [{ id: 'b', name: 'Edinburgh', destination: 'Edinburgh', dated: true, createdAt: 1 }] }));
    localStorage.setItem('board:b:picks', JSON.stringify([
      { id: 'a:1', name: 'Edinburgh', city: 'Edinburgh', category: 'City', lat: 55.9533, lon: -3.1883, major: true }]));
    localStorage.setItem('board:b:folders', JSON.stringify(['Edinburgh']));
    if (ppl) localStorage.setItem('people-v1', JSON.stringify(ppl));
    const s = { geminiKey: 'k' };
    if (m) s.mode = m;
    localStorage.setItem('trip-settings-v1', JSON.stringify(s));
  }, [mode, people || null]);
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(600);
};
const ratingChips = () => page.evaluate(() => [...document.querySelectorAll('[data-film-rating]')]
  .map((b) => b.getAttribute('data-film-rating') + (b.classList.contains('on') ? '*' : '')).join(' '));
const runSearch = async () => {
  prompts = [];
  await openEventForm(page);
  await page.evaluate(() => document.getElementById('evSearch').click());
  await page.waitForFunction(() => (window.__tripTest.eventResults || []).length > 0, { timeout: 30000 }).catch(() => {});
  await page.waitForFunction(() => !window.__tripTest.eventsBusy || !window.__tripTest.eventsBusy(),
    { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(800);
  return page.evaluate(() => (window.__tripTest.eventResults || []).map((e) => `${e.name} @ ${e.venue}`).sort());
};
const view = () => page.evaluate(() => document.getElementById('view').textContent.replace(/\s+/g, ' '));

// ---------- Not part of "everything" ----------
await seed('adults');
check('films are not searched unless picked', await page.evaluate(() =>
  !window.__tripTest.defaultAngles().some((a) => a.key === 'films') &&
  !window.__tripTest.anglesForSearch().some((a) => a.key === 'films')));
await openWhatSheet(page);
check('but they are there to pick', await page.evaluate(() => !!document.querySelector('[data-ev-kind="films"]')));
check('and the ratings only appear once films are picked', (await ratingChips()) === '');
await closeAskSheet(page);

// ---------- One tap in from Find ----------
await goTo(page, 'events', 400);
check('Find has a way to the cinema', await page.evaluate(() => !!document.querySelector('[data-find="films"]')));
await page.click('[data-find="films"]');
await page.waitForTimeout(400);
check('and the summary behind the sheet already says films', await page.evaluate(() =>
  /Films/.test(document.getElementById('view').textContent)));
check('which opens on films, with the ratings to choose', await page.evaluate(() =>
  document.querySelector('[data-ev-kind="films"]')?.classList.contains('on')) && (await ratingChips()).length > 0,
  await ratingChips());
check('adults mode offers every rating, all chosen', (await ratingChips()) === 'U* PG* 12A* 15* 18*', await ratingChips());

// Choose 12A and 15 only, the way a person would.
for (const r of ['U', 'PG', '18']) await page.click(`[data-film-rating="${r}"]`);
await page.waitForTimeout(200);
check('tapping a rating turns it off', (await ratingChips()) === 'U PG 12A* 15* 18', await ratingChips());
await page.click('[data-film-rating="12A"]');
await page.click('[data-film-rating="15"]');
await page.waitForTimeout(200);
check('and the last one cannot be turned off - a search for no ratings is a search for nothing',
  (await ratingChips()).includes('15*'), await ratingChips());
await page.click('[data-film-rating="12A"]');
await page.waitForTimeout(200);
await closeAskSheet(page);

let found = await runSearch();
const filmPrompt = prompts.find((p) => angleFromPrompt(p) === 'films') || '';
check('only the films request is made', prompts.length === 1 && !!filmPrompt, `${prompts.length} prompts`);
check('and it asks for the chosen ratings', /Only films rated 12A or 15 by the BBFC/.test(filmPrompt), filmPrompt.slice(0, 300));
check('with every showing time, one row per film per cinema', /"times"/.test(filmPrompt) && /once per cinema/.test(filmPrompt));
check('and never R18', /Nothing rated R18/.test(filmPrompt));
// A question about cinema times is about cinema times: none of the
// four-thousand-character small-events brief, which cost tokens and pulled
// the answers off the subject.
check('and it is short, about films only', filmPrompt.length < 1600 &&
  !/coffee morning|parish|toddler group|church|noticeboard|beetle/i.test(filmPrompt), `${filmPrompt.length} chars`);
check('what comes back is only the ratings chosen',
  JSON.stringify(found) === JSON.stringify(['Alien: Romulus @ Vue Omni', 'Conclave @ Filmhouse', 'Mystery Screening @ Cameo']),
  JSON.stringify(found));
check('the ones left out are said, with why', /2 films were rated outside your choice|films were rated outside your choice/.test(await view()),
  (await view()).slice(-300));
check('each row shows its rating the way a poster does', await page.evaluate(() =>
  [...document.querySelectorAll('.rating-badge')].map((b) => b.textContent.trim()).sort().join(',') === '12A,15'));
check('a film with no rating says so rather than guessing', /rating not given/.test(await view()));
check('and a film with several showings lists them all', await page.evaluate(() =>
  /18:10.*20:40/.test([...document.querySelectorAll('.ev-showtimes')].map((x) => x.textContent).join('|'))));
check('saying the times are for the first day', /times for .* check other days/.test(await view()));
check('a cinema is not "indoors or out, not sure"', !/indoors or out, not sure/.test(await view()));
check('and the note under the results is about cinemas, not parish newsletters',
  /cinema listings/.test(await view()) && !/parish newsletters/.test(await view()));

// The choice is kept.
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(500);
check('the ratings chosen are remembered', JSON.stringify(await page.evaluate(() =>
  window.__tripTest.chosenFilmRatings())) === JSON.stringify(['12A', '15']));

// ---------- Kids ----------
await seed('kids', [{ name: 'Liviu', age: 38 }, { name: 'Ella', age: 5 }]);
await goTo(page, 'events', 400);
await page.click('[data-find="films"]');
await page.waitForTimeout(400);
check('kids mode starts on U and PG, and 18 is not on offer', (await ratingChips()) === 'U* PG* 12A 15', await ratingChips());
await closeAskSheet(page);
found = await runSearch();
check('the family films come back, both cinemas showing Paddington as two rows',
  JSON.stringify(found) === JSON.stringify([
    'Paddington in Peru @ Cineworld Fountainpark', 'Paddington in Peru @ Vue Omni', 'The Wild Robot @ Odeon Lothian Road']),
  JSON.stringify(found));
check('a film with no rating is not shown to a family', !found.some((f) => /Mystery/.test(f)));
check('the kids-mode film request asks for family films', /films for children and families/.test(
  prompts.find((p) => angleFromPrompt(p) === 'films') || ''));

// An older child opens up more by default.
await seed('kids', [{ name: 'Liviu', age: 38 }, { name: 'Sam', age: 13 }]);
check('with a thirteen-year-old, 12A is on by default', JSON.stringify(await page.evaluate(() =>
  window.__tripTest.chosenFilmRatings())) === JSON.stringify(['U', 'PG', '12A']));

// ---------- Adults: a children's film is out, whatever its rating ----------
await seed('adults');
await goTo(page, 'events', 400);
await page.click('[data-find="films"]');
await page.waitForTimeout(300);
await closeAskSheet(page);
found = await runSearch();
check('adults mode drops the film made for children, keeps the rest',
  !found.includes('Paddington in Peru @ Vue Omni') && found.includes('The Substance @ Cameo') &&
  found.includes('Paddington in Peru @ Cineworld Fountainpark'), JSON.stringify(found));

// ---------- Theatre ----------
// "Don't forget plays, theatres etc." Same shape as films: picked, not part
// of everything; one row per show per venue with its performance times; and
// in kids mode, the venue's age guidance against the youngest child.
await seed('kids', [{ name: 'Liviu', age: 38 }, { name: 'Ella', age: 5 }]);
check('theatre is not searched unless picked', await page.evaluate(() =>
  !window.__tripTest.defaultAngles().some((a) => a.key === 'theatre')));
await goTo(page, 'events', 400);
check('Find has a way to the theatre', await page.evaluate(() => !!document.querySelector('[data-find="theatre"]')));
await page.click('[data-find="theatre"]');
await page.waitForTimeout(400);
check('which opens on theatre, picked', await page.evaluate(() =>
  document.querySelector('[data-ev-kind="theatre"]')?.classList.contains('on')));
check('with no film ratings, which are for films', (await ratingChips()) === '');
await closeAskSheet(page);
found = await runSearch();
let theatrePrompt = prompts.find((p) => angleFromPrompt(p) === 'theatre') || '';
check('one request, for theatre', prompts.length === 1 && !!theatrePrompt, `${prompts.length} prompts`);
check('asking for family shows in kids mode', /pantomime, puppet shows, family musicals/.test(theatrePrompt));
check('including children\'s plays, and drama sessions a child can join',
  /children's plays/.test(theatrePrompt) && /drama workshops and youth theatre/.test(theatrePrompt));
check('which the way in says too', /Children's plays/.test(await page.evaluate(() =>
  document.querySelector('[data-find="theatre"]')?.textContent || '')),
  await page.evaluate(() => document.querySelector('[data-find="theatre"]')?.textContent.replace(/\s+/g, ' ') || 'no row'));
check('with performance times and age guidance', /"times"/.test(theatrePrompt) && /"minAge"/.test(theatrePrompt));
check('a five-year-old gets The Gruffalo, not Matilda (8+) or Macbeth',
  JSON.stringify(found) === JSON.stringify(['The Gruffalo @ Church Hill Theatre']), JSON.stringify(found));
check('and the screen says a show was for older children', /for older children/.test(await view()), (await view()).slice(-300));
check('its performances are listed', await page.evaluate(() =>
  /11:00.*14:00/.test([...document.querySelectorAll('.ev-showtimes')].map((x) => x.textContent).join('|'))));
check('and the note is about theatre listings', /theatre and venue listings/.test(await view()));

await seed('adults');
await goTo(page, 'events', 400);
await page.click('[data-find="theatre"]');
await page.waitForTimeout(300);
await closeAskSheet(page);
found = await runSearch();
theatrePrompt = prompts.find((p) => angleFromPrompt(p) === 'theatre') || '';
check('adults mode asks for plays, musicals and comedy', /plays, musicals, comedy/.test(theatrePrompt) && !/pantomime/.test(theatrePrompt));
check('and gets Macbeth, the comedy and the open-air play, without the children\'s shows',
  JSON.stringify(found) === JSON.stringify(['Late-Night Comedy @ The Stand', 'Macbeth @ Royal Lyceum', 'Twelfth Night @ Royal Botanic Garden']),
  JSON.stringify(found));
check('an open-air play is not called indoors', await page.evaluate(() =>
  /outdoors/.test([...document.querySelectorAll('.ev-row')].find((r) => /Twelfth Night/.test(r.textContent))?.textContent || '')));

// ---------- A stale choice from another mode does not break a search ----------
await seed('kids');
// Music is not a kids-mode kind: a restored search that had only Music
// picked used to leave nothing to search, and the button did nothing.
check('kinds picked in another mode fall back to everything, not to nothing', await page.evaluate(() => {
  window.__tripTest.setEventKinds(['music']);
  const keys = window.__tripTest.anglesForSearch().map((a) => a.key);
  return keys.length === window.__tripTest.defaultAngles().length && !keys.includes('music');
}));

await browser.close();
console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
