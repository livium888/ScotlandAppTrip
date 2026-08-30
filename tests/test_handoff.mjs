// "Is it possible to ask ChatGPT for the information, tell the app to open it,
// paste that query, run it, and then copy-paste the answer back into the app?"
//
// Yes, and it is worth having for three separate reasons: the app's own search
// needs a Gemini key that not everybody has; somebody paying for an assistant
// has a better model available than the free tier; and a key that has run out
// of quota otherwise makes the whole screen useless.
//
// One prompt covering all nine kinds rather than nine separate questions - the
// point of doing it by hand is not doing it nine times. What comes back goes
// through exactly the same machinery as a searched result: extractJson repairs
// it, normaliseEvent refuses anything malformed, and it is placed, dated and
// deduped identically. Pasting is a different way in, not a lower standard -
// but it arrives with no page to click through to, so it says so.
import { chromium } from 'playwright';
import { ANGLE_KEYS } from './lib/angles.mjs';
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
await page.route(/wikidata|wikipedia|tile\.|photon|open-meteo|places\.googleapis/, (r) => r.abort());

let aiCalls = 0;
await page.route(/generativelanguage\.googleapis\.com/, (route) => { aiCalls++; return route.abort(); });
await page.route(/overpass/, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
  elements: [
    { type: 'node', id: 1, lat: 53.215, lon: -1.68, tags: { name: 'Ashford-in-the-Water', place: 'village' } },
    { type: 'node', id: 2, lat: 53.22, lon: -1.69, tags: { name: 'Great Longstone', place: 'village' } },
  ] }) }));
await page.route(/nominatim/, (route) => route.fulfill({ status: 200, contentType: 'application/json',
  body: JSON.stringify([{ lat: '53.2129', lon: '-1.6753', display_name: 'Bakewell', type: 'town',
    namedetails: { name: 'Bakewell' }, address: { town: 'Bakewell' }, extratags: {} }]) }));

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const soon = iso(new Date(Date.now() + 2 * 86400000));
const longAgo = iso(new Date(Date.now() - 200 * 86400000));

await page.goto(BASE, { waitUntil: 'load' });
await page.evaluate(() => {
  localStorage.setItem('boards-v1', JSON.stringify({
    activeId: 'b-h', boards: [{ id: 'b-h', name: 'Trip', destination: 'Peak District', dated: true, hasGuide: false, createdAt: 1 }] }));
  // Deliberately NO Gemini key: this path has to work for somebody who has
  // never set one, which is most of the reason it exists.
  localStorage.setItem('trip-settings-v1', JSON.stringify({ destination: 'Peak District', geminiKey: '' }));
  localStorage.setItem('board:b-h:picks', JSON.stringify([]));
  localStorage.setItem('board:b-h:plan', JSON.stringify({ days: [], items: {} }));
  localStorage.setItem('board:b-h:search-anchor', JSON.stringify({ name: 'Bakewell', lat: 53.2129, lon: -1.6753, miles: 15 }));
  localStorage.removeItem('event-cache-v1');
});
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(500);

// A sheet that does not exist yet makes waitForSelector throw, which kills
// the run and prints no FAIL lines at all - so a suite that is genuinely
// failing looks like one that never ran.
const openHandoff = async () => {
  await page.evaluate(() => { const b = document.getElementById('evHandoff'); if (b) b.click(); });
  try {
    await page.waitForSelector('#handoffPrompt', { timeout: 8000 });
  } catch (e) {
    console.log('  (no hand-off sheet)');
  }
  await page.waitForTimeout(300);
};
const fill = (id, value) => page.evaluate(([i, v]) => {
  const el = document.getElementById(i);
  if (el) el.value = v;
}, [id, value]);
const clickIf = (id) => page.evaluate((i) => { const b = document.getElementById(i); if (b) b.click(); }, id);
const textOf = (id) => page.evaluate((i) => (document.getElementById(i) || {}).textContent || '', id);
const valueOf = (id) => page.evaluate((i) => (document.getElementById(i) || {}).value || '', id);

const screen = () => page.evaluate(() => document.getElementById('view').textContent.replace(/\s+/g, ' '));
const rows = () => page.evaluate(() =>
  Array.from(document.querySelectorAll('.ev-row .ev-name')).map((e) => e.textContent.trim()));

await page.evaluate(() => document.querySelector('[data-view="events"]').click());
await page.waitForTimeout(400);

// ---------- The way in ----------

check('there is a way to ask somewhere else', await page.evaluate(() =>
  !!document.getElementById('evHandoff')));
await openHandoff();

const prompt = await valueOf('handoffPrompt');
// One question, not nine: doing this nine times by hand is the thing being
// avoided.
check('the prompt covers every kind in one go',
  ANGLE_KEYS.every((k) => prompt.length > 0) && /Cover all of these/.test(prompt), prompt.slice(0, 200));
check('naming all nine', (prompt.match(/^- /gm) || []).length === ANGLE_KEYS.length,
  String((prompt.match(/^- /gm) || []).length));
check('it carries the villages, like the app\'s own search does',
  /Ashford-in-the-Water/.test(prompt), prompt.slice(0, 300));
check('and where to go looking for small things',
  /parish magazines and community newsletters/.test(prompt));
check('and the same JSON contract the app itself asks for',
  /ONLY a JSON array/.test(prompt) && /childFocus/.test(prompt) && /bookingLevel|"booking"/.test(prompt));
check('there is a way to copy it', await page.evaluate(() => !!document.getElementById('handoffCopy')));
check('and a way to open an assistant', await page.evaluate(() => !!document.getElementById('handoffOpen')));
// The whole point: this must not spend anything of yours.
check('and none of that asked the AI for anything', aiCalls === 0, `${aiCalls} calls`);

// ---------- Pasting the answer back ----------

const reply = 'Here you go!\n\n```json\n' + JSON.stringify([
  { name: 'Village Hall Coffee Morning', date: soon, time: '10:00', endTime: '12:00',
    venue: 'Village Hall', area: 'Bakewell', what: 'Cake and a natter.', price: 'free',
    setting: 'indoor', childFocus: 'allowed', booking: 'none' },
  { name: 'Horticultural Society Talk', date: soon, time: '19:00', venue: 'The Institute',
    area: 'Bakewell', what: 'Dahlias.', price: '£', setting: 'indoor' },
  // Refused: no usable date. The standard does not drop for being pasted.
  { name: 'Sometime Fair', date: 'next Saturday', venue: 'A field', area: 'Bakewell' },
  // Refused: months outside the window asked about.
  { name: 'Ancient History Fair', date: longAgo, venue: 'The Square', area: 'Bakewell' },
], null, 1) + '\n```\n\nHope that helps.';

await fill('handoffAnswer', reply);
await clickIf('handoffAdd');
await page.waitForTimeout(2500);

const result = await textOf('handoffResult');
check('the answer is read out of a reply with prose and fences around it',
  /Added 2 events/.test(result), result);
// The two that should not have survived, and it says why.
check('and it says what did not survive', /didn't survive/.test(result), result);
check('and none of that asked the AI either', aiCalls === 0, `${aiCalls} calls`);

await page.evaluate(() => { const b = document.querySelector('#placeModal .modal-close'); if (b) b.click(); else document.getElementById('placeModal').classList.remove('open'); });
await page.waitForTimeout(400);
const listed = await rows();
check('the pasted events are on the screen', listed.length === 2, JSON.stringify(listed));
check('with the undated one refused', !listed.some((n) => /Sometime Fair/.test(n)), JSON.stringify(listed));
check('and the one outside the dates asked about refused too',
  !listed.some((n) => /Ancient History/.test(n)), JSON.stringify(listed));
// Sorted by time like anything else - a pasted diary is still a diary.
check('and in clock order like any other result',
  listed[0] === 'Village Hall Coffee Morning', JSON.stringify(listed));

// ---------- Said out loud that it cannot be checked ----------

const text = await screen();
check('a pasted event says it was pasted', /pasted in/.test(text), text.slice(0, 900));
check('and offers no source link, because there is not one', await page.evaluate(() =>
  !Array.from(document.querySelectorAll('.ev-row button')).some((b) => /came from/.test(b.textContent))));

// ---------- Pasting a second answer merges rather than duplicating ----------

// It lived only inside the open form, so the moment a search returned
// anything the form folded and took the way back to it with it - which is
// exactly when somebody out of quota needs it.
check('the way to it survives the form folding away after results',
  await page.evaluate(() => !!document.getElementById('evHandoff')));
await openHandoff();
const second = JSON.stringify([
  // The same one again, from a second attempt.
  { name: 'Village Hall Coffee Morning', date: soon, time: '10:00', venue: 'Village Hall', area: 'Bakewell' },
  { name: 'Duck Race', date: soon, time: '14:00', venue: 'The Bridge', area: 'Bakewell',
    what: 'Plastic ducks.', price: 'free', setting: 'outdoor' },
]);
await fill('handoffAnswer', second);
await clickIf('handoffAdd');
await page.waitForTimeout(2500);
await page.evaluate(() => { const b = document.querySelector('#placeModal .modal-close'); if (b) b.click(); else document.getElementById('placeModal').classList.remove('open'); });
await page.waitForTimeout(400);
const merged = await rows();
check('a second paste adds what is new', merged.includes('Duck Race'), JSON.stringify(merged));
check('and does not duplicate what was already there',
  merged.filter((n) => /Coffee Morning/.test(n)).length === 1, JSON.stringify(merged));

// ---------- Rubbish in ----------

await page.evaluate(() => { const b = document.getElementById('evHandoff'); if (b) b.click(); });
await page.waitForSelector('#handoffPrompt', { timeout: 8000 });
await page.evaluate(() => {
  document.getElementById('handoffAnswer').value = 'I could not find anything, sorry.';
  document.getElementById('handoffAdd').click();
});
await page.waitForTimeout(900);
const junk = await page.evaluate(() => document.getElementById('handoffResult').textContent);
check('a reply with no list in it says so plainly, rather than failing silently',
  /didn't contain a list/.test(junk), junk);
check('and tells you what would work', /whole reply/.test(junk), junk);

await browser.close();
console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILED`);
process.exit(failures ? 1 : 0);
