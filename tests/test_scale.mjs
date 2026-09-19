// Type and spacing have to come off a scale, not off a feeling.
//
// The stylesheet had grown 23 distinct font sizes, seven of them on half
// pixels - 9.5, 10.5, 11.5, 12.5, 13.5, 14.5, 15.5. A half-pixel size is the
// fingerprint of nudging one thing until it looked right next to the thing
// beside it, and doing that ninety-odd times is how an app ends up feeling
// "all over the place" without any single screen being wrong. Nothing shares
// a rhythm, so nothing looks related.
//
// This walks what actually renders rather than reading the stylesheet, so it
// also catches a size set inline or from JavaScript, and it reads every
// screen because the offenders were spread across all of them.
import { chromium } from 'playwright';
import { goTo } from './lib/screens.mjs';
import fs from 'node:fs';
const SANDBOX_CHROMIUM = '/opt/pw-browsers/chromium';
const LAUNCH_OPTS = fs.existsSync(SANDBOX_CHROMIUM) ? { executablePath: SANDBOX_CHROMIUM } : {};

const BASE = 'http://localhost:8946';
let failures = 0;
const check = (l, c, extra) => { if (c) console.log(`PASS: ${l}`); else { console.log(`FAIL: ${l}${extra ? ' :: ' + extra : ''}`); failures++; } };

// Nine steps, each far enough from its neighbour to read as a deliberate
// difference. Everything that was on a half pixel rounds onto one of these.
const TYPE_SCALE = [11, 12, 13, 15, 17, 20, 24, 28, 34];

const browser = await chromium.launch(LAUNCH_OPTS);
const page = await browser.newPage();
await page.setViewportSize({ width: 390, height: 844 });
page.on('pageerror', (e) => { console.log('PAGEERROR:', e.message); failures++; });
await page.route(/nominatim|wikidata|wikipedia|overpass|googleapis|tile\.|generativelanguage/, (r) => r.abort());

await page.goto(BASE, { waitUntil: 'load' });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem('boards-v1', JSON.stringify({
    activeId: 'b-own',
    boards: [{ id: 'b-own', name: 'Lake District', destination: 'Keswick, Cumbria', dated: true, hasGuide: false, createdAt: 1 }],
  }));
  localStorage.setItem('board:b-own:picks', JSON.stringify([
    { id: 'c:1', name: 'Castlerigg Stone Circle', city: 'Keswick', category: 'Attraction', lat: 54.6027, lon: -3.0983, folder: 'Keswick' },
    { id: 'c:2', name: 'The Dog and Gun', city: 'Keswick', category: 'Pub', lat: 54.6013, lon: -3.1367, folder: 'Keswick' },
    { id: 'c:3', name: 'Whinlatter Forest', city: 'Braithwaite', category: 'Attraction', lat: 54.6055, lon: -3.2258, folder: 'Days out' },
  ]));
  localStorage.setItem('board:b-own:folders', JSON.stringify(['Keswick', 'Days out']));
  const iso = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
  const lab = (n) => {
    const dt = new Date(Date.now() + n * 864e5);
    return `Day ${n + 1} · ${dt.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}`;
  };
  localStorage.setItem('board:b-own:plan', JSON.stringify({
    days: [{ id: 'd1', label: lab(0), date: iso(0) }, { id: 'd2', label: lab(1), date: iso(1) }],
    items: { d1: [{ pickId: 'c:1', time: '10:00' }, { pickId: 'c:2', time: '13:00' }], d2: [{ pickId: 'c:3', time: '09:30' }] },
  }));
  localStorage.setItem('people-v1', JSON.stringify([{ name: 'Ella', dob: '2021-04-02' }, { name: 'Sam', dob: '2016-09-11' }]));
});
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(600);

// Every element carrying its own text, and the size it actually renders at.
const offendersOn = () => page.evaluate((scale) => {
  const out = [];
  const seen = new Set();
  document.querySelectorAll('body *').forEach((el) => {
    if (el.offsetParent === null && el.tagName !== 'BODY') return;
    // Only elements with their own text node - a wrapper inherits its size
    // and reporting it would name the same offence a dozen times.
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!own) return;
    const px = parseFloat(getComputedStyle(el).fontSize);
    if (scale.includes(Math.round(px * 10) / 10)) return;
    const where = el.className && typeof el.className === 'string'
      ? '.' + el.className.trim().split(/\s+/).join('.')
      : el.tagName.toLowerCase();
    const key = where + '@' + px;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(`${px}px ${where}`);
  });
  return out;
}, TYPE_SCALE);

const SCREENS = ['today', 'itinerary', 'picks', 'events', 'more', 'kids', 'budget', 'tips', 'usage'];
const all = new Map();
for (const s of SCREENS) {
  await goTo(page, s, 0);
  await page.waitForTimeout(350);
  for (const o of await offendersOn()) all.set(o, (all.get(o) || 0) + 1);
}

const list = [...all.keys()].sort();
check(`every rendered size is on the type scale (${TYPE_SCALE.join('/')})`,
  list.length === 0, `${list.length} off-scale: ${list.slice(0, 14).join(', ')}`);

// The half-pixel sizes specifically: these are the ones that came from
// eyeballing rather than choosing, so they get called out by name.
const halves = list.filter((o) => /^\d+\.\d/.test(o));
check('nothing renders on a fractional pixel size', halves.length === 0,
  `${halves.length}: ${halves.slice(0, 10).join(', ')}`);

// The stylesheet itself should name the scale rather than repeating numbers,
// so the next person adding a rule has something to reach for.
const css = fs.readFileSync(new URL('../www/css/style.css', import.meta.url), 'utf8');
const tokens = (css.match(/--type-[a-z0-9]+:/g) || []).length;
check('the scale exists as tokens in the stylesheet', tokens >= 9, `found ${tokens}`);

const rawSizes = (css.match(/font-size:\s*[0-9.]+px/g) || []);
check('rules reach for a token rather than a raw pixel size', rawSizes.length === 0,
  `${rawSizes.length} raw font-size values remain`);

await browser.close();
console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
