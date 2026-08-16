// What the app feels like under a thumb.
//
// Everything was a tap on a target. A sheet could only be dismissed by
// finding a small close button in its corner - which is a dialog on a web
// page, not a sheet - and getting a saved place onto a day meant opening it,
// finding the row of days and closing it again.
//
// These drive real touch events rather than element.click(), because the
// whole point of a gesture is the part a click cannot express: which way it
// went, how far, and whether it beat the list's own scrolling to it.
import { chromium } from 'playwright';
import fs from 'node:fs';
const SANDBOX_CHROMIUM = '/opt/pw-browsers/chromium';
const LAUNCH_OPTS = fs.existsSync(SANDBOX_CHROMIUM) ? { executablePath: SANDBOX_CHROMIUM } : {};

const BASE = 'http://localhost:8946';
let failures = 0;
const check = (l, c, extra) => { if (c) console.log(`PASS: ${l}`); else { console.log(`FAIL: ${l}${extra ? ' :: ' + extra : ''}`); failures++; } };

const browser = await chromium.launch(LAUNCH_OPTS);
const context = await browser.newContext({ hasTouch: true, viewport: { width: 390, height: 844 } });
const page = await context.newPage();
page.on('pageerror', (e) => { console.log('PAGEERROR:', e.message); failures++; });
await page.route(/generativelanguage|nominatim|wikidata|wikipedia|overpass|tile\.|open-meteo|photon|places\.googleapis|upload\./, (r) => r.abort());

// A drag, in steps, the way a finger makes one - a single jump from start to
// end never crosses the threshold that decides which axis you meant.
async function drag(from, to, steps = 12) {
  await page.evaluate(async ([a, b, n]) => {
    const el = document.elementFromPoint(a.x, a.y);
    const touch = (x, y) => new Touch({ identifier: 1, target: el, clientX: x, clientY: y });
    const fire = (type, x, y) => {
      const t = touch(x, y);
      el.dispatchEvent(new TouchEvent(type, {
        bubbles: true, cancelable: true,
        touches: type === 'touchend' ? [] : [t],
        targetTouches: type === 'touchend' ? [] : [t],
        changedTouches: [t],
      }));
    };
    fire('touchstart', a.x, a.y);
    for (let i = 1; i <= n; i++) {
      fire('touchmove', a.x + ((b.x - a.x) * i) / n, a.y + ((b.y - a.y) * i) / n);
      await new Promise((r) => setTimeout(r, 12));
    }
    fire('touchend', b.x, b.y);
  }, [from, to, steps]);
  await page.waitForTimeout(450);
}

await page.goto(BASE, { waitUntil: 'load' });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem('boards-v1', JSON.stringify({
    activeId: 'b-g', boards: [{ id: 'b-g', name: 'Trip', destination: 'Scotland', dated: true, hasGuide: false, createdAt: 1 }] }));
  localStorage.setItem('trip-settings-v1', JSON.stringify({ destination: 'Scotland', geminiKey: '', geminiModel: '' }));
  localStorage.setItem('board:b-g:folders', JSON.stringify(['Edinburgh']));
  localStorage.setItem('board:b-g:picks', JSON.stringify([
    { id: 'p1', name: 'Edinburgh Castle', city: 'Edinburgh', category: 'Castle', lat: 55.9486, lon: -3.1999, addedAt: 1, photoChecked: true },
    { id: 'p2', name: 'Arthur Seat', city: 'Edinburgh', category: 'Hill', lat: 55.9444, lon: -3.1617, addedAt: 2, photoChecked: true },
    { id: 'p3', name: 'Camera Obscura', city: 'Edinburgh', category: 'Attraction', lat: 55.9489, lon: -3.1953, addedAt: 3, photoChecked: true },
  ]));
  localStorage.setItem('board:b-g:plan', JSON.stringify({
    days: [{ id: 'd1', label: 'Day 1 · Sat 15 Aug' }], items: { d1: [] } }));
});
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(500);
await page.evaluate(() => document.querySelector('[data-view="picks"]').click());
await page.waitForTimeout(400);

const rowBox = async (name) => page.evaluate((n) => {
  const rows = Array.from(document.querySelectorAll('.swipeable'));
  const row = rows.find((r) => r.textContent.includes(n));
  if (!row) return null;
  const b = row.getBoundingClientRect();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, left: b.x, width: b.width };
}, name);

// ---------- Swiping a row ----------

const castle = await rowBox('Edinburgh Castle');
check('the list is there to swipe', !!castle, JSON.stringify(castle));

await drag({ x: castle.x + 90, y: castle.y }, { x: castle.x - 60, y: castle.y });
check('a row slides aside when you push it', await page.evaluate(() =>
  !!document.querySelector('.swipeable.swiped')));
check('and what it uncovers is what you would have opened it for', await page.evaluate(() => {
  const open = document.querySelector('.swipeable.swiped');
  return !!open.querySelector('[data-row-day]') && !!open.querySelector('[data-row-remove]');
}));

// Touching anywhere off the row puts it back - clicking the row itself would
// open the place, which is the tap this gesture exists to save.
const tapAway = () => page.evaluate(() => {
  const head = document.querySelector('#view .section-label') || document.getElementById('view');
  const t = new Touch({ identifier: 9, target: head, clientX: 10, clientY: 10 });
  head.dispatchEvent(new TouchEvent('touchstart', {
    bubbles: true, cancelable: true, touches: [t], targetTouches: [t], changedTouches: [t] }));
});
await tapAway();
await page.waitForTimeout(300);
check('touching away from it puts the row back', await page.evaluate(() =>
  !document.querySelector('.swipeable.swiped')));
const seat = await rowBox('Arthur Seat');
await drag({ x: seat.x + 90, y: seat.y }, { x: seat.x + 60, y: seat.y });
check('a nudge is not a swipe', await page.evaluate(() =>
  !document.querySelector('.swipeable.swiped')));

// The one that matters: a mostly-vertical drag beginning on a row is a scroll
// and must leave the row alone. Getting this wrong makes a whole screen feel
// broken in a way that is hard to put a name to. (Synthetic touches do not
// move a real scroller, so what is checked here is that the app did not claim
// the gesture - which is the half the app is responsible for.)
await drag({ x: seat.x, y: seat.y + 40 }, { x: seat.x - 12, y: seat.y - 220 });
check('a scroll that starts on a row is left alone', await page.evaluate(() =>
  !document.querySelector('.swipeable.swiped') &&
  !document.querySelector('.swipeable .pick-row[style*="translateX"]')));

// ---------- What the actions do ----------

await tapAway();
await page.waitForTimeout(200);
const cam = await rowBox('Camera Obscura');
await drag({ x: cam.x + 90, y: cam.y }, { x: cam.x - 60, y: cam.y });
await page.evaluate(() => document.querySelector('.swipeable.swiped [data-row-remove]').click());
await page.waitForTimeout(500);
check('removing from the row removes the place', await page.evaluate(() =>
  !JSON.parse(localStorage.getItem('board:b-g:picks')).some((p) => p.name === 'Camera Obscura')));
check('and offers it back, since a swipe is easy to do by accident', await page.evaluate(() =>
  !!document.querySelector('.toast-action')));
await page.evaluate(() => document.querySelector('.toast-action').click());
await page.waitForTimeout(500);
check('undo puts it back', await page.evaluate(() =>
  JSON.parse(localStorage.getItem('board:b-g:picks')).some((p) => p.name === 'Camera Obscura')));

// ---------- Pushing a sheet back down ----------

await page.evaluate(() => document.querySelector('[data-open-pick]').click());
await page.waitForSelector('#placeModal.open');
await page.waitForTimeout(400);
const handle = await page.evaluate(() => {
  const h = document.querySelector('#placeModal .modal-handle');
  const b = h.getBoundingClientRect();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
});
await drag({ x: handle.x, y: handle.y }, { x: handle.x, y: handle.y + 260 });
check('a sheet can be pushed back down instead of hunted for a close button',
  await page.evaluate(() => !document.getElementById('placeModal').classList.contains('open')));

// Half a push is a change of mind, and the sheet has to come back rather than
// sitting where it was let go.
await page.evaluate(() => document.querySelector('[data-open-pick]').click());
await page.waitForSelector('#placeModal.open');
await page.waitForTimeout(400);
await drag({ x: handle.x, y: handle.y }, { x: handle.x, y: handle.y + 40 }, 20);
check('half a push springs back', await page.evaluate(() =>
  document.getElementById('placeModal').classList.contains('open')));
check('and leaves the sheet where it belongs', await page.evaluate(() => {
  const s = document.querySelector('#placeModal .modal-sheet');
  return !s.style.transform || s.style.transform === '';
}), await page.evaluate(() => document.querySelector('#placeModal .modal-sheet').style.transform));

await browser.close();
console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILED`);
process.exit(failures ? 1 : 0);
