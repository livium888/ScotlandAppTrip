// A pass against the usability checklist, kept as tests so the findings can't
// quietly come back.
//
// Four things were wrong. A diagnostic alert() shipped to real users. Deleting
// a place was instant and unrecoverable while deleting a whole board asked
// first - the small destructive action was the dangerous one. Naming a folder
// and the share fallback used native prompt(), which in a WebView is a system
// dialog in the wrong font labelled with the page's origin. And the tab bar
// carried eight destinations, three of which were one collection shown three
// ways.
import { chromium } from 'playwright';
import fs from 'node:fs';
const SANDBOX_CHROMIUM = '/opt/pw-browsers/chromium';
const LAUNCH_OPTS = fs.existsSync(SANDBOX_CHROMIUM) ? { executablePath: SANDBOX_CHROMIUM } : {};

const BASE = 'http://localhost:8946';
let failures = 0;
const check = (l, c, extra) => { if (c) console.log(`PASS: ${l}`); else { console.log(`FAIL: ${l}${extra ? ' :: ' + extra : ''}`); failures++; } };

const browser = await chromium.launch(LAUNCH_OPTS);
const page = await browser.newPage();
await page.setViewportSize({ width: 390, height: 820 });
page.on('pageerror', (e) => { console.log('PAGEERROR:', e.message); failures++; });

// Any native dialog is a failure, so they are trapped rather than answered:
// a real one would block the run, which is exactly what it does to a user.
const nativeDialogs = [];
page.on('dialog', async (d) => {
  nativeDialogs.push({ type: d.type(), message: d.message() });
  await d.dismiss();
});

await page.route(/nominatim|wikidata|wikipedia|overpass|googleapis|open-meteo|photon|tile\./, (r) => r.abort());

await page.goto(BASE, { waitUntil: 'load' });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem('boards-v1', JSON.stringify({
    // Two boards, because the delete control only appears when there is
    // somewhere to land afterwards - and deleting is the path under test.
    activeId: 'b-h', boards: [
      { id: 'b-h', name: 'Checklist', destination: 'Edinburgh', dated: false, hasGuide: false, createdAt: 1 },
      { id: 'b-other', name: 'Somewhere else', destination: 'York', dated: false, hasGuide: false, createdAt: 2 },
    ],
  }));
  localStorage.setItem('board:b-h:folders', JSON.stringify(['Edinburgh']));
  localStorage.setItem('board:b-h:picks', JSON.stringify([
    { id: 'custom:Castle', name: 'Edinburgh Castle', city: 'Edinburgh', category: 'Castle', lat: 55.9486, lon: -3.1999, addedAt: 100 },
    { id: 'custom:Cafe', name: 'Milkman', city: 'Edinburgh', category: 'Cafe', lat: 55.9506, lon: -3.1899, addedAt: 200 },
    { id: 'custom:Zoo', name: 'Edinburgh Zoo', city: 'Edinburgh', category: 'Zoo', lat: 55.9426, lon: -3.2686, addedAt: 300 },
  ]));
});
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(400);

const readPicks = () => page.evaluate(() => JSON.parse(localStorage.getItem('board:b-h:picks') || '[]'));
const openPicks = async () => {
  await page.evaluate(() => document.querySelector('[data-view="picks"]').click());
  await page.waitForTimeout(350);
};

// ---------- One destination for one collection ----------

// This used to assert `tabs.length <= 6`, and adding a seventh tab failed it.
// Bumping the number to 7 would have been the easy fix and a worthless one -
// the guard exists so the bar cannot creep, and a guard you raise whenever you
// touch it is not a guard.
//
// So it measures the thing the number was standing in for: every tab has to be
// wide enough to hit and its label has to fit without being cut off. Checked at
// 320px as well as at the usual width, because that is the phone where a bar
// with too much in it actually breaks.
const tabs = await page.evaluate(() =>
  Array.from(document.querySelectorAll('.tab')).map((t) => t.getAttribute('data-view')));

const barAt = async (width) => {
  await page.setViewportSize({ width, height: 780 });
  await page.waitForTimeout(200);
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('.tab'))
      .filter((t) => !t.hidden)
      .map((t) => {
        const label = t.querySelector('.tab-label');
        return {
          view: t.getAttribute('data-view'),
          width: Math.round(t.getBoundingClientRect().width),
          // Truncated by the ellipsis, or wrapped onto a second line.
          clipped: label.scrollWidth > label.clientWidth + 1,
          lines: Math.round(label.getBoundingClientRect().height / 14),
        };
      }));
};

const wide = await barAt(390);
const narrow = await barAt(320);
await page.setViewportSize({ width: 390, height: 780 });

check('every tab is big enough to hit with a thumb',
  narrow.every((t) => t.width >= 44), JSON.stringify(narrow.map((t) => [t.view, t.width])));
check('and no label is cut off, on the narrowest phone worth supporting',
  narrow.every((t) => !t.clipped), JSON.stringify(narrow.filter((t) => t.clipped)));
check('nor wrapped onto a second line, which knocks its icon out of line',
  wide.every((t) => t.lines <= 1) && narrow.every((t) => t.lines <= 1),
  JSON.stringify(narrow.map((t) => [t.view, t.lines])));
// A hard ceiling still: past this the bar is a menu. It got there - seven -
// and the answer was not to raise the number but to move the three screens
// that were only worth opening once a day behind one that is.
check('and the bar is still a bar rather than a menu', tabs.length <= 5, JSON.stringify(tabs));
check('with one place holding everything that is not a tab',
  tabs.includes('more'), JSON.stringify(tabs));
check('and the screens that stopped being tabs are still one tap from it',
  await page.evaluate(() => {
    document.querySelector('[data-view="more"]').click();
    return ['kids', 'budget', 'tips'].every((n) => !!document.querySelector(`[data-more="${n}"]`));
  }));
check('Places and Eats are no longer separate destinations',
  !tabs.includes('places') && !tabs.includes('eats'), JSON.stringify(tabs));
check('the saved list is still one tap away', tabs.includes('picks'), JSON.stringify(tabs));

// Every tab still has to be big enough to hit. 44px is the usual floor.
const smallest = await page.evaluate(() =>
  Math.min(...Array.from(document.querySelectorAll('.tab')).filter((t) => !t.hidden)
    .map((t) => t.getBoundingClientRect().width)));
check('every tab is a real touch target', smallest >= 44, `${Math.round(smallest)}px`);

await openPicks();
check('what was two tabs is a filter on the one list', await page.evaluate(() =>
  document.querySelectorAll('[data-pick-kind-filter]').length === 3));

await page.evaluate(() => document.querySelector('[data-pick-kind-filter="eat"]').click());
await page.waitForTimeout(350);
const eatOnly = await page.evaluate(() =>
  Array.from(document.querySelectorAll('.pick-row-name')).map((e) => e.textContent.trim()));
check('filtering to food shows only food', eatOnly.length === 1 && /Milkman/.test(eatOnly[0]), JSON.stringify(eatOnly));

await page.evaluate(() => document.querySelector('[data-pick-kind-filter="all"]').click());
await page.waitForTimeout(350);
check('and All brings the rest back', await page.evaluate(() =>
  document.querySelectorAll('.pick-row-name').length === 3));

// ---------- Removing a place can be taken back ----------

await page.evaluate(() => {
  const rows = Array.from(document.querySelectorAll('[data-open-pick]'));
  (rows.find((r) => /Edinburgh Zoo/.test(r.textContent)) || rows[0]).click();
});
await page.waitForSelector('#placeModal.open [data-remove-pick]', { timeout: 3000 });
await page.evaluate(() => document.querySelector('[data-remove-pick]').click());
await page.waitForTimeout(500);

check('removing asks nothing and simply removes', (await readPicks()).length === 2, JSON.stringify((await readPicks()).map((p) => p.name)));
check('no system dialog was used to do it', nativeDialogs.length === 0, JSON.stringify(nativeDialogs));
check('but it offers the way back', await page.evaluate(() => {
  const el = document.getElementById('toast');
  return !!el && !!el.querySelector('.toast-action') && /Undo/i.test(el.textContent);
}), await page.evaluate(() => (document.getElementById('toast') || {}).textContent || 'no toast'));

await page.evaluate(() => document.querySelector('.toast-action').click());
await page.waitForTimeout(500);
const restored = await readPicks();
check('Undo puts the place back', restored.length === 3 && restored.some((p) => /Edinburgh Zoo/.test(p.name)), JSON.stringify(restored.map((p) => p.name)));
check('and back where it was, not at the end', restored[2] && /Edinburgh Zoo/.test(restored[2].name), JSON.stringify(restored.map((p) => p.name)));
check('the list on screen agrees', await page.evaluate(() =>
  document.querySelectorAll('.pick-row-name').length === 3));

// ---------- Naming a folder uses the app, not the system ----------

await page.evaluate(() => document.querySelector('[data-open-pick]').click());
await page.waitForSelector('#placeModal.open [data-new-folder-for]', { timeout: 3000 });
await page.evaluate(() => document.querySelector('[data-new-folder-for]').click());
await page.waitForTimeout(400);

check('naming a folder opens the app\'s own sheet', await page.evaluate(() =>
  document.getElementById('placeModal').classList.contains('open') &&
  !!document.getElementById('newFolderInput')));
check('and no system prompt appeared', nativeDialogs.length === 0, JSON.stringify(nativeDialogs));

await page.fill('#newFolderInput', 'Day trips');
await page.evaluate(() => document.getElementById('newFolderForm').requestSubmit());
await page.waitForTimeout(500);
check('the folder is created and used', (await readPicks()).some((p) => p.city === 'Day trips'),
  JSON.stringify((await readPicks()).map((p) => p.city)));

// ---------- Deleting a board still warns, in the app's own voice ----------

await page.evaluate(() => document.querySelector('.topbar-text').click());
await page.waitForTimeout(400);
check('a board can be deleted when there is more than one', await page.evaluate(() =>
  !!document.getElementById('deleteBoardBtn')));
{
  await page.evaluate(() => document.getElementById('deleteBoardBtn').click());
  await page.waitForTimeout(400);
  check('deleting a board asks first', await page.evaluate(() => !!document.getElementById('confirmGo')));
  check('with the app\'s own sheet, not a system confirm', nativeDialogs.length === 0, JSON.stringify(nativeDialogs));
  check('and it says what would be lost', await page.evaluate(() =>
    /saved place/.test(document.getElementById('placeModal').textContent)),
    await page.evaluate(() => document.getElementById('placeModal').textContent.slice(0, 160)));
  check('keeping it is the plainer option', await page.evaluate(() => {
    const keep = document.getElementById('confirmCancel');
    const go = document.getElementById('confirmGo');
    return !!keep && !!go && !go.classList.contains('modal-btn-primary');
  }));

  await page.evaluate(() => document.getElementById('confirmCancel').click());
  await page.waitForTimeout(300);
  check('and backing out keeps the board', (await readPicks()).length === 3, String((await readPicks()).length));
}

// ---------- Nothing native anywhere in that run ----------

check('no alert, confirm or prompt reached the user at any point',
  nativeDialogs.length === 0, JSON.stringify(nativeDialogs));

await browser.close();
console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILED`);
process.exit(failures ? 1 : 0);
