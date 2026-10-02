// Sharing the plan, end to end: the Share button on the trip screen hands the
// text to the phone's share sheet, and the text is enough to read on its own.
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
await page.addInitScript(() => {
  try { localStorage.setItem('onboarded-v1', '1'); } catch { /* nothing */ }
  // The phone's share sheet, recorded rather than shown.
  navigator.share = async (data) => { window.__shared = data; };
});
await page.route(/nominatim|overpass|wikidata|wikipedia|photon|tile\.|open-meteo|generativelanguage|places\.googleapis/, (r) => r.abort());

await page.goto(BASE, { waitUntil: 'load' });
await page.evaluate(() => {
  localStorage.setItem('boards-v1', JSON.stringify({ activeId: 'b', boards: [{ id: 'b', name: 'Fareham weekend', destination: 'Fareham', dated: true, createdAt: 1 }] }));
  localStorage.setItem('board:b:folders', JSON.stringify(['Fareham']));
  localStorage.setItem('board:b:picks', JSON.stringify([
    { id: 'm', name: 'Fareham', city: 'Fareham', category: 'Town', lat: 50.85, lon: -1.18, major: true },
    { id: 'e1', name: 'Toddler Rhyme Time', kind: 'event', city: 'Fareham', venue: 'Central Library', area: 'Fareham', lat: 50.852, lon: -1.185, booked: true, note: 'Booking ref 48213 - bring the pushchair' },
    { id: 'p1', name: 'Fareham Park', city: 'Fareham', category: 'Park', address: 'Park Lane, Fareham, PO16 7AB', lat: 50.84, lon: -1.19 },
  ]));
  localStorage.setItem('board:b:plan', JSON.stringify({
    days: [{ id: 'd1', label: 'Day 1 · Sat 3 Oct' }],
    items: { d1: [{ pickId: 'p1', time: '12:00' }, { pickId: 'e1', time: '10:00' }] } }));
});
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(500);

await page.click('#shareTrip');
await page.waitForFunction(() => !!window.__shared, null, { timeout: 5000 }).catch(() => {});
const shared = await page.evaluate(() => window.__shared || {});
const text = shared.text || '';
const lines = text.split('\n');

check('Share hands a text to the phone\'s share sheet, titled with the trip', shared.title === 'Fareham weekend' && text.length > 0);
check('it is in the order of the day', text.indexOf('Toddler Rhyme Time') > 0 && text.indexOf('Toddler Rhyme Time') < text.indexOf('Fareham Park'), text);
check('the time, the name and that it is booked', lines.some((l) => /^ {2}10:00 Toddler Rhyme Time \(booked\)$/.test(l)));
check('where it is', lines.some((l) => l === '    Central Library, Fareham'));
check('the note, with the booking reference', lines.some((l) => l === '    Note: Booking ref 48213 - bring the pushchair'));
check('a map link to tap, to the place itself', lines.some((l) => /^ {4}https:\/\/www\.google\.com\/maps\/search\/Toddler%20Rhyme%20Time\/@50\.852,-1\.185/.test(l)), lines.filter((l) => /http/.test(l)).join(' | '));
check('a place saved from the map gets its town', lines.some((l) => l === '    Fareham'));
check('the town heading is not listed as somewhere to go', !/Not scheduled/.test(text));

await browser.close();
console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
