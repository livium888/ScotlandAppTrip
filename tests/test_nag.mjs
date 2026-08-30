// A warning you cannot dismiss is not a warning, it is furniture.
//
// The backup nudge occupied roughly 60px at the top of every screen, on every
// screen, permanently, with no way to answer it except to take a backup. It
// is telling the truth - everything really is only on this phone - but a
// message that cannot be acknowledged stops being read within a day, which
// means the one moment it matters is the moment it gets ignored.
//
// So: acknowledgeable, and when acknowledged it goes quiet for a week and
// leaves a mark on the way to Settings instead. The offline banner is
// deliberately NOT dismissible - it is a fact about right now that clears
// itself the moment it stops being true, and hiding it would only send you
// hunting for why search is broken.
import { chromium } from 'playwright';
import { goTo } from './lib/screens.mjs';
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
await page.route(/nominatim|wikidata|wikipedia|overpass|googleapis|tile\.|generativelanguage/, (r) => r.abort());

// Enough saved to be worth losing, and never backed up - which is exactly
// when the nudge is supposed to appear.
await page.goto(BASE, { waitUntil: 'load' });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem('boards-v1', JSON.stringify({
    activeId: 'b', boards: [{ id: 'b', name: 'Lake District', destination: 'Keswick', dated: true, createdAt: 1 }],
  }));
  localStorage.setItem('board:b:picks', JSON.stringify([
    { id: 'c:1', name: 'Castlerigg Stone Circle', city: 'Keswick', category: 'Attraction', lat: 54.6027, lon: -3.0983 },
    { id: 'c:2', name: 'The Dog and Gun', city: 'Keswick', category: 'Pub', lat: 54.6013, lon: -3.1367 },
    { id: 'c:3', name: 'Whinlatter Forest', city: 'Braithwaite', category: 'Attraction', lat: 54.6055, lon: -3.2258 },
    { id: 'c:4', name: 'Booths', city: 'Keswick', category: 'Supermarket', lat: 54.6005, lon: -3.1345 },
  ]));
  localStorage.setItem('board:b:folders', JSON.stringify(['Keswick']));
});
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(600);

const bannerShown = () => page.evaluate(() => {
  const b = document.getElementById('appBanner');
  return !!b && !b.hidden && /only on this phone/i.test(b.textContent);
});

// Tolerant on purpose so a run against the unfixed code fails the checks
// that name the missing control rather than throwing and reporting nothing.
const tap = async (sel) => {
  const hit = await page.evaluate((x) => { const el = document.querySelector(x); if (!el) return false; el.click(); return true; }, sel);
  await page.waitForTimeout(300);
  return hit;
};

check('the nudge appears when there is something to lose and no backup', await bannerShown());
check('and it can be answered, not only obeyed', await page.evaluate(() =>
  !!document.getElementById('bannerDismiss')));

await tap('#bannerDismiss');
check('dismissing it puts it away', !(await bannerShown()));

// The important half: it must not come back on the next screen, or the next
// launch, or dismissing meant nothing.
await goTo(page, 'picks', 300);
check('and it stays away on another screen', !(await bannerShown()));
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(600);
check('and after closing and reopening the app', !(await bannerShown()));

// But it is not gone for ever - the data really is only on this phone.
await page.evaluate(() => {
  const k = 'backup-nudge-snoozed-v1';
  localStorage.setItem(k, JSON.stringify(Date.now() - 8 * 24 * 60 * 60 * 1000));
});
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(600);
check('it comes back after a week, because the risk did not go away', await bannerShown());

// Meanwhile the way to Settings carries the mark, so a dismissed warning is
// still findable rather than forgotten.
await tap('#bannerDismiss');
await goTo(page, 'more', 300);
check('a dismissed warning still shows on the way to Settings', await page.evaluate(() => {
  const row = document.querySelector('[data-more="settings"]');
  return !!row && !!row.querySelector('.more-row-dot');
}));

// ---------- Offline is a different kind of message ----------
await page.evaluate(() => localStorage.removeItem('backup-nudge-snoozed-v1'));
await page.context().setOffline(true);
await page.evaluate(() => window.dispatchEvent(new Event('offline')));
await page.waitForTimeout(300);
const offlineText = await page.evaluate(() => {
  const b = document.getElementById('appBanner');
  return b && !b.hidden ? b.textContent : '';
});
check('being offline still says so', /no connection/i.test(offlineText), offlineText.slice(0, 80));
check('and that one cannot be dismissed, because it clears itself',
  await page.evaluate(() => !document.getElementById('bannerDismiss')));

await page.context().setOffline(false);
await browser.close();
console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
