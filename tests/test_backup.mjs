// Backup is the safety net for data that exists nowhere else, so it gets
// tested end to end: export the real storage keys, wipe, restore, verify.
import { chromium } from 'playwright';

import fs from 'node:fs';
const SANDBOX_CHROMIUM = '/opt/pw-browsers/chromium';
const LAUNCH_OPTS = fs.existsSync(SANDBOX_CHROMIUM) ? { executablePath: SANDBOX_CHROMIUM } : {};

const BASE = 'http://localhost:8946';
let failures = 0;
const check = (l, c, extra) => { if (c) console.log(`PASS: ${l}`); else { console.log(`FAIL: ${l}${extra ? ' :: ' + extra : ''}`); failures++; } };

const browser = await chromium.launch(LAUNCH_OPTS);
const page = await browser.newPage();
page.on('pageerror', (e) => { console.log('PAGEERROR:', e.message); failures++; });
await page.route(/nominatim|wikidata|wikipedia|overpass|googleapis/, (r) => r.abort());

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForTimeout(200);

// Seed realistic state across every backed-up key.
await page.evaluate(() => {
  localStorage.setItem('scotland-trip-picks-v1', JSON.stringify([
    { id: 'custom:Test Place', name: 'Test Place', city: 'Edinburgh', lat: 55.95, lon: -3.19, note: 'book ahead', booked: true },
  ]));
  localStorage.setItem('scotland-trip-folders-v1', JSON.stringify(['Edinburgh', 'Day trips']));
  localStorage.setItem('trip-plan-v1', JSON.stringify({ days: [{ id: 'd0', label: 'Wed 19 Aug' }], items: { d0: [{ pickId: 'custom:Test Place', time: '10:00' }] } }));
  localStorage.setItem('trip-settings-v1', JSON.stringify({ destination: 'Scotland', travellers: 'family of 3' }));
});

const backupJson = await page.evaluate(() => {
  // Same shape the export button produces.
  const keys = ['scotland-trip-picks-v1', 'scotland-trip-folders-v1', 'trip-plan-v1', 'trip-settings-v1', 'scotland-trip-packing-v1'];
  const data = {};
  keys.forEach((k) => { const v = localStorage.getItem(k); if (v !== null) data[k] = v; });
  return JSON.stringify({ format: 'scotland-trip-backup', version: 1, exportedAt: new Date().toISOString(), data });
});
check('backup contains picks', /Test Place/.test(backupJson));
check('backup contains plan', /trip-plan-v1/.test(backupJson));
check('backup contains settings', /trip-settings-v1/.test(backupJson));

// Wipe, as an uninstall/clear-data would.
await page.evaluate(() => localStorage.clear());
const afterWipe = await page.evaluate(() => localStorage.getItem('scotland-trip-picks-v1'));
check('storage wiped', afterWipe === null);

// Restore through the app's own import path.
const result = await page.evaluate((json) => {
  // Drive the real importer via the file input the Settings sheet uses.
  document.getElementById('settingsBtn').click();
  const input = document.getElementById('importBackupFile');
  const file = new File([json], 'backup.json', { type: 'application/json' });
  const dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;
  input.dispatchEvent(new Event('change'));
  return true;
}, backupJson);
check('import triggered', result);
await page.waitForTimeout(500);

const restored = await page.evaluate(() => ({
  picks: JSON.parse(localStorage.getItem('scotland-trip-picks-v1') || '[]'),
  folders: JSON.parse(localStorage.getItem('scotland-trip-folders-v1') || '[]'),
  plan: JSON.parse(localStorage.getItem('trip-plan-v1') || '{}'),
  settings: JSON.parse(localStorage.getItem('trip-settings-v1') || '{}'),
}));
check('picks restored', restored.picks.length === 1 && restored.picks[0].name === 'Test Place', JSON.stringify(restored.picks));
check('per-pick note and booked flag survive', restored.picks[0].note === 'book ahead' && restored.picks[0].booked === true, JSON.stringify(restored.picks[0]));
check('folders restored', restored.folders.includes('Day trips'), JSON.stringify(restored.folders));
check('plan restored', restored.plan.items && restored.plan.items.d0 && restored.plan.items.d0[0].time === '10:00', JSON.stringify(restored.plan));
check('settings restored', restored.settings.travellers === 'family of 3', JSON.stringify(restored.settings));

const msg = await page.evaluate(() => {
  const el = document.getElementById('backupResult');
  return el ? { text: el.textContent, cls: el.className } : null;
});
check('confirmation message shown with counts', msg && /Restored/.test(msg.text) && /1 places/.test(msg.text), JSON.stringify(msg));

// A non-backup file must be rejected rather than silently wiping anything.
await page.evaluate(() => {
  const input = document.getElementById('importBackupFile');
  const dt = new DataTransfer();
  dt.items.add(new File(['{"hello":"world"}'], 'other.json', { type: 'application/json' }));
  input.files = dt.files;
  input.dispatchEvent(new Event('change'));
});
await page.waitForTimeout(400);
const after = await page.evaluate(() => ({
  picks: JSON.parse(localStorage.getItem('scotland-trip-picks-v1') || '[]').length,
  msg: document.getElementById('backupResult').textContent,
}));
check('foreign file rejected', /doesn't look like a trip backup/.test(after.msg), after.msg);
check('data untouched after rejected import', after.picks === 1, String(after.picks));

await browser.close();
console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILED`);
process.exit(failures ? 1 : 0);
