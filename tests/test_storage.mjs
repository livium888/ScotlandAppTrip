// Phase 4: the trip lives in one phone's localStorage and the app was casual
// about all three ways of losing it.
//
// 1. Thirty-three calls to setItem, not one guarded. When storage fills,
//    setItem throws, the throw lands in whatever handler was running, and the
//    app says "Something went wrong" - which is not what happened, gives
//    nobody anything to do, and loses the edit.
//
// 2. Two hardcoded lists of what a board is made of - one in the backup, one
//    in deleteBoard - neither updated since the day it was written. Four
//    parts added later were in neither, so a backup silently left them behind
//    and a deleted board left them on the phone for ever.
//
// 3. The recent searches were exported into every backup file and then
//    refused on import: room in the file, thrown away on arrival. And the
//    version written into every backup since the first one was read by
//    nothing, so a file from a newer build would be half-restored in silence.
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
await page.route(/generativelanguage|nominatim|wikidata|wikipedia|overpass|open-meteo|photon|places\.googleapis|upload\.|tile\./, (r) => r.abort());

// A stub Filesystem, so the automatic backup can be watched without a phone.
await page.addInitScript(() => {
  localStorage.setItem('onboarded-v1', '1');
  const written = {};
  let refuse = false;
  window.__fs = {
    get written() { return written; },
    refuse: (v) => { refuse = v; },
  };
  window.Capacitor = {
    Plugins: {
      Filesystem: {
        writeFile: async ({ path, data }) => {
          if (refuse) throw new Error('no permission');
          written[path] = data;
        },
        readdir: async () => ({ files: Object.keys(written).map((name) => ({ name })) }),
        deleteFile: async ({ path }) => { delete written[path]; },
      },
    },
  };
});

await page.goto(BASE, { waitUntil: 'load' });
await page.evaluate(() => {
  localStorage.setItem('boards-v1', JSON.stringify({
    activeId: 'b-1',
    boards: [
      { id: 'b-1', name: 'Scotland', destination: 'Scotland', dated: true, hasGuide: false, createdAt: 1 },
      { id: 'b-2', name: 'Lakes', destination: 'Cumbria', dated: true, hasGuide: false, createdAt: 2 },
    ] }));
  localStorage.setItem('trip-settings-v1', JSON.stringify({ destination: 'Scotland', geminiKey: 'SECRET', geminiModel: '' }));
  // Every part a board can have, on both boards.
  ['b-1', 'b-2'].forEach((id) => {
    localStorage.setItem(`board:${id}:picks`, JSON.stringify([
      { id: 'p1', name: 'Stirling Castle', city: 'Stirling', category: 'Castle', lat: 56.12, lon: -3.94, addedAt: 1, photoChecked: true },
      { id: 'p2', name: 'Wallace Monument', city: 'Stirling', category: 'Monument', lat: 56.13, lon: -3.92, addedAt: 2, photoChecked: true },
      { id: 'p3', name: 'The Birds and Bees', city: 'Stirling', category: 'Pub', lat: 56.14, lon: -3.93, addedAt: 3, photoChecked: true },
    ]));
    localStorage.setItem(`board:${id}:folders`, JSON.stringify(['Stirling']));
    localStorage.setItem(`board:${id}:plan`, JSON.stringify({ days: [], items: {} }));
    localStorage.setItem(`board:${id}:budget`, JSON.stringify([{ id: 'x', label: 'Fuel', amount: 40 }]));
    localStorage.setItem(`board:${id}:packing`, JSON.stringify([{ id: 'k', text: 'Wellies', done: false }]));
    localStorage.setItem(`board:${id}:notes`, JSON.stringify('Ferry books up early'));
    localStorage.setItem(`board:${id}:search-anchor`, JSON.stringify({ name: 'Stirling', lat: 56.12, lon: -3.94, miles: 10 }));
    localStorage.setItem(`board:${id}:budget-est`, JSON.stringify({ at: Date.now(), places: {}, foodPerDay: { low: 20, high: 40 } }));
    localStorage.setItem(`board:${id}:idea`, JSON.stringify({ title: 'A day round Stirling' }));
    localStorage.setItem(`board:${id}:collapsed`, JSON.stringify(['Stirling']));
  });
  localStorage.setItem('recent-searches-v1', JSON.stringify(['cosy pub', 'soft play']));
  localStorage.setItem('people-v1', JSON.stringify([{ name: 'Ally', age: 3 }]));
});
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(600);

// ---------- A backup contains all of it ----------

const backup = await page.evaluate(() => JSON.parse(window.__tripTest.buildBackup()));
const parts = await page.evaluate(() => window.__tripTest.BOARD_PARTS);
check('a board is described in one place, not two', Array.isArray(parts) && parts.length >= 10, JSON.stringify(parts));

const missing = parts.filter((part) => !(`board:b-1:${part}` in backup.data));
check('every part of a board is in the backup', missing.length === 0, `missing: ${JSON.stringify(missing)}`);
check('for every board, not just the open one',
  parts.every((part) => `board:b-2:${part}` in backup.data), 'b-2 incomplete');
check('and the searches you have run', 'recent-searches-v1' in backup.data, JSON.stringify(Object.keys(backup.data)));
check('and who is travelling', 'people-v1' in backup.data, JSON.stringify(Object.keys(backup.data)));

// The one thing that must never travel.
check('but not the API key, which is the one thing a shared file must not carry',
  !/SECRET/.test(JSON.stringify(backup)), 'key leaked');

// ---------- And all of it comes back ----------

await page.evaluate((text) => {
  // Wipe everything the backup should restore, then put the file back.
  Object.keys(localStorage)
    .filter((k) => /^board:|^recent-searches|^people-/.test(k))
    .forEach((k) => localStorage.removeItem(k));
  window.__tripTest.importBackup(text);
}, JSON.stringify(backup));
await page.waitForTimeout(300);

const restored = await page.evaluate((p) =>
  p.filter((part) => localStorage.getItem(`board:b-1:${part}`) === null), parts);
check('a restore puts every part back', restored.length === 0, `still missing: ${JSON.stringify(restored)}`);
check('including the searches, which used to be exported and then refused',
  await page.evaluate(() => /cosy pub/.test(localStorage.getItem('recent-searches-v1') || '')),
  await page.evaluate(() => localStorage.getItem('recent-searches-v1')));
check('and the key already on this phone is not blanked by a file that has none',
  await page.evaluate(() => JSON.parse(localStorage.getItem('trip-settings-v1')).geminiKey === 'SECRET'));

// ---------- A file from a newer build is refused, not half-read ----------

const future = await page.evaluate(() => {
  const b = JSON.parse(window.__tripTest.buildBackup());
  b.version = 99;
  b.data['board:b-1:picks'] = JSON.stringify([]);
  return window.__tripTest.importBackup(JSON.stringify(b));
});
check('a backup from a newer version is refused', future.ok === false, JSON.stringify(future));
check('and says what to do about it', /update the app/i.test(future.message), future.message);
check('and nothing was restored from it in the meantime',
  await page.evaluate(() => JSON.parse(localStorage.getItem('board:b-1:picks')).length) === 3);

// ---------- Deleting a board takes all of it ----------

await page.evaluate(() => window.__tripTest.deleteBoard('b-2'));
const leaked = await page.evaluate(() =>
  Object.keys(localStorage).filter((k) => k.indexOf('board:b-2:') === 0));
check('deleting a board leaves nothing of it behind', leaked.length === 0, JSON.stringify(leaked));
check('and does not touch the other one',
  await page.evaluate(() => Object.keys(localStorage).filter((k) => k.indexOf('board:b-1:') === 0).length) >= 10);

// ---------- A full phone says so, and does not lose the app ----------

// setItem throws for everything from here on, the way a full phone does.
await page.evaluate(() => {
  window.__realSetItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k, v) {
    const e = new Error('quota');
    e.name = 'QuotaExceededError';
    throw e;
  };
});

const wrote = await page.evaluate(() => window.__tripTest.store('some-key', 'x'));
check('a write that cannot happen answers that it did not', wrote === false, String(wrote));
check('rather than throwing out of whatever was running',
  await page.evaluate(() => { try { window.__tripTest.store('k', 'v'); return 'returned'; } catch (e) { return 'threw'; } }) === 'returned');
check('and says what is actually wrong, in words with something to do in them',
  await page.evaluate(() => /storage/i.test(document.body.textContent) && /backup/i.test(document.body.textContent)),
  await page.evaluate(() => (document.querySelector('.toast') || {}).textContent || document.body.textContent.slice(-200)));

// Opening a screen with a full phone must not take the app down with it.
// The seeded board has its one section folded, so the rows are legitimately
// hidden - the heading and its count are what prove the list was built.
await page.evaluate(() => document.querySelector('[data-view="picks"]').click());
await page.waitForTimeout(500);
check('and the app is still standing', await page.evaluate(() => {
  const head = document.querySelector('[data-fold]');
  return !!head && /Stirling/.test(head.textContent) && /3/.test(head.textContent);
}), await page.evaluate(() => document.getElementById('view').textContent.replace(/\s+/g, ' ').slice(0, 200)));

// And still saves what it can once there is room again.
await page.evaluate(() => { Storage.prototype.setItem = window.__realSetItem; });

// The expendable caches are given up first, so a phone that is merely full
// rather than hopeless keeps working.
await page.evaluate(() => {
  Storage.prototype.setItem = window.__realSetItem;
  localStorage.setItem('weather-cache-v1', JSON.stringify({ x: 1 }));
  localStorage.setItem('destination-coords-v1', JSON.stringify({ x: 1 }));
  let full = true;
  const real = window.__realSetItem;
  Storage.prototype.setItem = function (k, v) {
    // Full once, then room again - which is what dropping a cache achieves.
    if (full && k === 'squeeze-test') { full = false; const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; }
    return real.call(this, k, v);
  };
});
const squeezed = await page.evaluate(() => window.__tripTest.store('squeeze-test', 'y'));
check('a write that fails once succeeds after clearing what is only cached', squeezed === true, String(squeezed));
check('and the forecast is what got given up, not anything you typed',
  await page.evaluate(() => localStorage.getItem('weather-cache-v1') === null &&
    localStorage.getItem('board:b-1:picks') !== null));
await page.evaluate(() => { Storage.prototype.setItem = window.__realSetItem; });

// ---------- The backup nobody has to remember ----------

await page.evaluate(() => {
  localStorage.removeItem('auto-backup-at-v1');
  localStorage.removeItem('last-backup-at-v1');
});
const auto = await page.evaluate(() => window.__tripTest.autoBackup());
check('the app writes a backup by itself', auto.ok === true, JSON.stringify(auto));
check('as a dated file somebody could find', /^trip-backup-\d{4}-\d{2}-\d{2}\.json$/.test(auto.name || ''), auto.name);
check('with the trip actually in it',
  await page.evaluate(() => /Stirling Castle/.test(Object.values(window.__fs.written)[0] || '')));
check('and the banner stops asking, because it has been backed up',
  await page.evaluate(() => !!JSON.parse(localStorage.getItem('last-backup-at-v1') || 'null')));

const again = await page.evaluate(() => window.__tripTest.autoBackup());
check('and it does not do it again every time the app opens', again.ok === false, JSON.stringify(again));

// Old ones are cleared out, or a year of them sits on a phone nobody looks at.
await page.evaluate(async () => {
  ['trip-backup-2020-01-01.json', 'trip-backup-2020-01-02.json', 'trip-backup-2020-01-03.json']
    .forEach((n) => { window.__fs.written[n] = '{}'; });
  localStorage.removeItem('auto-backup-at-v1');
  await window.__tripTest.autoBackup();
});
check('and only the last few are kept',
  await page.evaluate(() => Object.keys(window.__fs.written).length) <= 3,
  await page.evaluate(() => JSON.stringify(Object.keys(window.__fs.written))));

// A phone that refuses to let the app write is not a broken app.
await page.evaluate(() => {
  window.__fs.refuse(true);
  localStorage.removeItem('auto-backup-at-v1');
});
const refused = await page.evaluate(() => window.__tripTest.autoBackup());
check('a phone that will not be written to is handled quietly',
  refused.ok === false && refused.reason === 'write refused', JSON.stringify(refused));

await browser.close();
console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILED`);
process.exit(failures ? 1 : 0);
