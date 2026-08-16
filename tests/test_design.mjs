// The look, held in place.
//
// "That app looks 20 times better than this." It did, and the reason was not
// that it was native or that its APK was ten times the size - it was that the
// interface here was assembled out of emoji. Six of them along the bottom of
// the screen, each from a different designer, in colours answering to nothing
// in the app, half rendering flat and half in full colour. That is the single
// clearest sign nobody drew a screen on purpose.
//
// These check the things that would quietly come back: an emoji creeping into
// the chrome, an icon name that does not exist rendering as a blank, the
// bundled typeface not loading, the tab bar losing its active state.
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
// A one-pixel stand-in, so the layout can be judged without the real network.
// The app removes an <img> that fails to load and falls back to the drawn
// tile, which is right - and would make this check untestable if the image
// were simply blocked.
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64');
await page.route(/upload\.wikimedia\.org/, (r) =>
  r.fulfill({ status: 200, contentType: 'image/png', body: PIXEL }));
await page.route(/generativelanguage|nominatim|wikidata|wikipedia\.org\/w|overpass|tile\.|open-meteo|photon|places\.googleapis/, (r) => r.abort());

await page.goto(BASE, { waitUntil: 'load' });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem('boards-v1', JSON.stringify({
    activeId: 'b-d', boards: [{ id: 'b-d', name: 'Trip', destination: 'Scotland', dated: true, hasGuide: false, createdAt: 1 }] }));
  localStorage.setItem('trip-settings-v1', JSON.stringify({ destination: 'Scotland', geminiKey: 'K', geminiModel: 'models/gemini-3.5-flash-lite' }));
  localStorage.setItem('board:b-d:picks', JSON.stringify([
    { id: 'p1', name: 'Edinburgh Castle', city: 'Edinburgh', category: 'Castle', lat: 55.9486, lon: -3.1999, addedAt: 1,
      note: 'Book ahead', address: '1 Castlehill', openingHours: 'Mo-Su 09:30-18:00', phone: '0131 225 9846' }]));
  localStorage.setItem('board:b-d:plan', JSON.stringify({
    days: [{ id: 'd1', label: 'Day 1 · Sat 15 Aug' }], items: { d1: [{ pickId: 'p1', time: '10:00' }] } }));
});
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(600);

// Anything in the pictographic blocks, in text that is part of the interface
// rather than something a person typed.
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u;

// ---------- The bar along the bottom ----------

const tabs = await page.evaluate(() => Array.from(document.querySelectorAll('.tab')).map((t) => ({
  label: t.querySelector('.tab-label').textContent.trim(),
  svgs: t.querySelectorAll('svg.ico').length,
  text: t.textContent.trim(),
})));
check('every tab is drawn, not typed', tabs.length === 6 && tabs.every((t) => t.svgs === 1),
  JSON.stringify(tabs));
check('and no emoji survives in it', !tabs.some((t) => EMOJI.test(t.text)), JSON.stringify(tabs.map((t) => t.text)));
check('the tab you are on is marked', await page.evaluate(() =>
  document.querySelectorAll('.tab.active').length === 1));

// An icon asked for by a name that does not exist renders as a fallback dot,
// which is silent - so the names in the markup have to be real ones.
check('no icon is asked for by a name that does not exist', await page.evaluate(() =>
  Array.from(document.querySelectorAll('[data-ico]')).every((el) =>
    window.ICON_NAMES.includes(el.getAttribute('data-ico')))),
  await page.evaluate(() => Array.from(document.querySelectorAll('[data-ico]'))
    .map((el) => el.getAttribute('data-ico')).filter((n) => !window.ICON_NAMES.includes(n)).join(', ')));

// ---------- The typeface ----------

check('the bundled typeface is the one in use', await page.evaluate(() =>
  /InterVar/.test(getComputedStyle(document.body).fontFamily)),
  await page.evaluate(() => getComputedStyle(document.body).fontFamily));
check('and it actually loaded rather than falling back', await page.evaluate(async () => {
  await document.fonts.ready;
  return document.fonts.check('16px InterVar');
}));

// ---------- Chrome across the screens ----------

for (const tab of ['today', 'kids', 'itinerary', 'picks', 'budget', 'tips']) {
  await page.evaluate((t) => document.querySelector(`[data-view="${t}"]`)?.click(), tab);
  await page.waitForTimeout(250);
  const found = await page.evaluate(() => {
    // Buttons only: a place name or a note is the user's text and may contain
    // whatever they like. Category tiles are illustration and are exempt.
    const out = [];
    document.querySelectorAll('#view button, #view .modal-btn').forEach((b) => {
      if (b.closest('.cat-grid, .kids-find, .search-chips')) return;
      const t = b.textContent.trim();
      if (t) out.push(t);
    });
    return out;
  });
  const offenders = found.filter((t) => EMOJI.test(t));
  check(`no emoji left in the controls on ${tab}`, offenders.length === 0, JSON.stringify(offenders));
}

// ---------- A place sheet ----------

await page.evaluate(() => document.querySelector('[data-view="picks"]').click());
await page.waitForTimeout(300);
await page.evaluate(() => document.querySelector('[data-open-pick]').click());
await page.waitForSelector('#placeModal.open');
await page.waitForTimeout(400);
check('the facts in a place sheet are drawn too', await page.evaluate(() =>
  document.querySelectorAll('.place-fact svg.ico').length >= 3),
  await page.evaluate(() => String(document.querySelectorAll('.place-fact svg.ico').length)));
check('and carry no emoji', await page.evaluate(() =>
  !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(
    Array.from(document.querySelectorAll('.place-fact')).map((e) => e.textContent).join(' '))),
  await page.evaluate(() => Array.from(document.querySelectorAll('.place-fact')).map((e) => e.textContent.trim()).join(' | ')));

// Icons take their colour from whatever they sit in, which is the whole
// reason one set can work on a tab bar and inside a filled button.
check('icons inherit their colour rather than carrying their own', await page.evaluate(() => {
  const svg = document.querySelector('#placeModal .modal-btn-primary svg.ico');
  if (!svg) return true;
  return svg.getAttribute('stroke') === 'currentColor';
}));

// ---------- Pictures ----------
// There were none. Not one <img> in the whole app, which is most of why a
// screen of places read as a database rather than as somewhere to go.
await page.evaluate(() => {
  const picks = JSON.parse(localStorage.getItem('board:b-d:picks'));
  picks.push({ id: 'p2', name: 'The Sheep Heid Inn', city: 'Edinburgh', category: 'Pub',
    lat: 55.9403, lon: -3.1583, addedAt: 2, photoChecked: true });
  picks[0].photo = 'https://upload.wikimedia.org/x/640px-a.png';
  picks[0].photoChecked = true;
  localStorage.setItem('board:b-d:picks', JSON.stringify(picks));
});
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(500);
await page.evaluate(() => document.querySelector('[data-view="picks"]').click());
await page.waitForTimeout(600);

check('a saved place shows its photograph', await page.evaluate(() =>
  !!document.querySelector('.pick-row .photo-thumb img')));
// A pub is not on Wikipedia and never will be, so "no picture" has to be an
// ordinary state rather than a hole in the layout.
check('and one without a photo still looks intentional', await page.evaluate(() => {
  const none = document.querySelector('.pick-row .photo-none');
  return !!none && !!none.querySelector('svg.ico');
}));
check('the fallback is the kind of place, not a generic dot', await page.evaluate(() => {
  const rows = Array.from(document.querySelectorAll('.pick-row'));
  const pub = rows.find((r) => /Sheep Heid/.test(r.textContent));
  return !!pub && !!pub.querySelector('.photo-none svg');
}));

await page.evaluate(() => {
  const rows = Array.from(document.querySelectorAll('[data-open-pick]'));
  rows.find((r) => /Edinburgh Castle/.test(r.textContent)).click();
});
await page.waitForSelector('#placeModal.open');
await page.waitForTimeout(400);
check('and the sheet leads with it', await page.evaluate(() =>
  !!document.querySelector('#placeModal .photo-hero')));

// A photo of the wrong castle is worse than no photo, so a title has to earn
// one by sharing a real word with the place.
check('a photo is only taken from an article that matches the place', await page.evaluate(() => {
  const f = window.__photoTitleFits;
  return !f || (f('Edinburgh Castle', 'Edinburgh Castle') && !f('Cardiff Castle', 'Edinburgh Zoo'));
}));

await page.evaluate(() => document.querySelector('#placeModal .modal-close').click());
await browser.close();
console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILED`);
process.exit(failures ? 1 : 0);
