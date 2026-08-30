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
check('and a way to open an assistant', await page.evaluate(() =>
  document.querySelectorAll('[data-assistant]').length >= 1));
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

// ---------- Two assistants, and the app rather than a web page ----------
//
// "ChatGPT returns a lot of results, so let's add a ChatGPT button as well.
// Also if the user has one of these installed on the phone as an app, can we
// open the app instead?"

await openHandoff();
const assistants = await page.evaluate(() =>
  Array.from(document.querySelectorAll('[data-assistant]')).map((b) => b.getAttribute('data-assistant')));
check('both assistants are offered', assistants.includes('chatgpt') && assistants.includes('gemini'),
  JSON.stringify(assistants));
check('and the sheet says the app opens when you have it',
  /open the app if you have it installed/.test(await page.evaluate(() =>
    document.getElementById('placeModal').textContent)));
// A Custom Tab is Chrome, and Chrome never passes a link to another app - so
// the hand-off has to navigate rather than use the in-app browser.
check('they are plain https links, which is what the apps claim on Android',
  await page.evaluate(() => window.__tripTest.ASSISTANTS.every((a) => /^https:\/\//.test(a.url))),
  await page.evaluate(() => JSON.stringify(window.__tripTest.ASSISTANTS)));
check('and none of them smuggles the prompt into the URL, which would truncate it',
  await page.evaluate(() => window.__tripTest.ASSISTANTS.every((a) => !/[?&]q=/.test(a.url))));

// ---------- A link on an imported card ----------
//
// "Why can't we have cards and links for these cards once imported?"

const withLink = JSON.stringify([
  { name: 'Linked Coffee Morning', date: soon, time: '09:30', venue: 'Village Hall', area: 'Bakewell',
    what: 'With a page behind it.', price: 'free',
    link: 'https://example.com/parish-news/august' },
]);
await fill('handoffAnswer', withLink);
await clickIf('handoffAdd');
await page.waitForTimeout(2500);
await page.evaluate(() => { const b = document.querySelector('#placeModal .modal-close'); if (b) b.click(); });
await page.waitForTimeout(400);

const linked = await page.evaluate(() => {
  const row = Array.from(document.querySelectorAll('.ev-row')).find((r) => /Linked Coffee/.test(r.textContent));
  if (!row) return null;
  return {
    source: Array.from(row.querySelectorAll('[data-open-maps]'))
      .map((b) => b.getAttribute('data-open-maps'))
      .find((h) => /parish-news/.test(h)) || '',
    saysNoLink: /no link/.test(row.textContent),
  };
});
// An imported event was the one kind of row with nothing at all to click
// through to; the contract now asks where it was listed.
check('an imported event can carry the page it was listed on',
  !!linked && /parish-news/.test(linked.source), JSON.stringify(linked));
check('and stops being marked as having no link', !!linked && !linked.saysNoLink, JSON.stringify(linked));
// The ones that genuinely have none must still say so.
check('while one with no link still says it has none',
  await page.evaluate(() => {
    const row = Array.from(document.querySelectorAll('.ev-row')).find((r) => /Duck Race/.test(r.textContent));
    return !!row && /no link/.test(row.textContent);
  }));

// ---------- Throwing out what you don't want ----------

const before = (await rows()).length;
const dropped = await page.evaluate(() => {
  const row = Array.from(document.querySelectorAll('.ev-row')).find((r) => /Linked Coffee/.test(r.textContent));
  const btn = row && row.querySelector('[data-drop-result]');
  if (!btn) return null;
  btn.click();
  return true;
});
await page.waitForTimeout(400);
check('a result can be thrown off the list', dropped === true);
const after = await rows();
check('and it goes', !after.some((n) => /Linked Coffee/.test(n)), JSON.stringify(after));
check('taking only itself with it', after.length === before - 1, `${before} -> ${after.length}`);
// A mis-tap on a small button beside a row you wanted would otherwise cost
// you the whole search.
check('with a way back', await page.evaluate(() =>
  !!document.querySelector('[data-toast-action]') ||
  /Undo/.test(document.body.textContent)));

// ---------- Pasted entries survive, like searched ones ----------
//
// "I need the entries saved as cache please, similar to the other caches."
//
// Work done by hand was the only kind that did not survive closing the app -
// which is backwards, since it is the more effortful way of getting it.

const cached = await page.evaluate(() => JSON.parse(localStorage.getItem('event-cache-v1') || '{}'));
const keys = Object.keys(cached);
check('pasted entries are written to the same cache a search uses',
  keys.length >= 1, JSON.stringify(keys));
check('with the events in them', keys.some((k) => (cached[k].results || []).length > 0));
// So the row can say where it came from rather than implying nine requests.
check('and marked as having been pasted rather than found',
  keys.some((k) => cached[k].meta && cached[k].meta.pasted === true),
  JSON.stringify(keys.map((k) => cached[k].meta && cached[k].meta.pasted)));

await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(500);
await page.evaluate(() => document.querySelector('[data-view="events"]').click());
await page.waitForTimeout(500);
const recentRows = await page.evaluate(() =>
  Array.from(document.querySelectorAll('[data-recent]')).map((b) => b.textContent.replace(/\s+/g, ' ').trim()));
// The assertion this half exists for.
check('after closing and reopening the app, the pasted list is still offered',
  recentRows.length >= 1, JSON.stringify(recentRows));
check('and says it was pasted in, not found',
  /pasted in/.test(recentRows.join(' ')), JSON.stringify(recentRows));

await page.evaluate(() => { const b = document.querySelector('[data-recent]'); if (b) b.click(); });
await page.waitForTimeout(600);
const restored = await rows();
check('opening it puts the pasted events back', restored.length >= 1, JSON.stringify(restored));
check('and asked the AI for nothing to do it', aiCalls === 0, `${aiCalls} calls`);

// ---------- Reading the JSON a model actually produces ----------
//
// The hand-rolled repair only ever closed brackets on a truncated answer.
// Everything else that comes out of a chat window it could not read at all,
// and the screen said "that didn't contain a list this could read" about text
// that plainly did.

const messy = await page.evaluate(() => {
  const e = window.__tripTest && window.__tripTest.extractJson;
  if (!e) return { missing: true };
  const ok = (v) => Array.isArray(v) && v.length > 0;
  return {
    trailingComma: ok(e('[{"name":"A","date":"2026-09-01"},]')),
    singleQuotes: ok(e("[{'name':'A','date':'2026-09-01'}]")),
    unquotedKeys: ok(e('[{name:"A",date:"2026-09-01"}]')),
    smartQuotes: ok(e('[{\u201cname\u201d:\u201cA\u201d}]')),
    pythonNone: ok(e('[{"name":"A","minAge":None}]')),
    comments: ok(e('[{"name":"A"} /* from the newsletter */]')),
    // The ones that already worked, which must keep working.
    clean: ok(e('[{"name":"A","date":"2026-09-01"}]')),
    fenced: ok(e('Here:\n```json\n[{"name":"A"}]\n```\nhope that helps')),
    truncated: ok(e('[{"name":"A","date":"2026-09-01"},{"name":"B","da')),
    // And the ones that must still be refused.
    prose: e('I could not find anything, sorry.'),
    empty: e(''),
  };
});
check('a trailing comma is read', messy.trailingComma, JSON.stringify(messy));
check('so are single quotes', messy.singleQuotes, JSON.stringify(messy));
check('and unquoted keys', messy.unquotedKeys, JSON.stringify(messy));
check('and the smart quotes a phone keyboard inserts', messy.smartQuotes, JSON.stringify(messy));
check('and None where null was asked for', messy.pythonNone, JSON.stringify(messy));
check('and a comment somebody left in', messy.comments, JSON.stringify(messy));
check('clean JSON still works', messy.clean, JSON.stringify(messy));
check('so does a fenced block inside prose', messy.fenced, JSON.stringify(messy));
check('and one cut off mid-object', messy.truncated, JSON.stringify(messy));
// Being more forgiving must not mean inventing a list out of a refusal.
check('but prose with no list in it is still refused', messy.prose === null, JSON.stringify(messy.prose));
check('and so is nothing at all', messy.empty === null, JSON.stringify(messy.empty));

await browser.close();
console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILED`);
process.exit(failures ? 1 : 0);
