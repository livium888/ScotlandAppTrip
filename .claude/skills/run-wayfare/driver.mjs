// Drives the Wayfare web app in headless Chromium: serves www/, seeds a
// board, goes to a screen, prints what is on it, and takes a screenshot.
//
//   node .claude/skills/run-wayfare/driver.mjs <screen> [out.png] [--eval "js"] [--click "css"]
//
// Screens: today, plan, events, picks, more, settings (Settings is a sheet).
// Network is faked: the map, Gemini and everything else answer nothing, so
// what you see is the app's own behaviour, not the internet's.
import http from 'node:http';
import fs from 'node:fs';
import { join, extname } from 'node:path';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i < 0 ? null : args.splice(i, 2)[1]; };
const evalJs = flag('--eval');
const clickSel = flag('--click');
const [screen = 'today', out = `wayfare-${screen}.png`] = args;

const SCREENS = ['today', 'plan', 'events', 'picks', 'more', 'settings'];
if (!SCREENS.includes(screen)) {
  console.error(`no way to reach "${screen}" - try one of: ${SCREENS.join(', ')}`);
  process.exit(2);
}

const www = new URL('../../../www/', import.meta.url).pathname.replace(/\/$/, '');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]);
  fs.readFile(join(www, rel === '/' ? 'index.html' : rel), (e, buf) => {
    if (e) return res.writeHead(404).end('not found');
    res.writeHead(200, { 'Content-Type': MIME[extname(rel === '/' ? 'x.html' : rel)] || 'application/octet-stream' });
    res.end(buf);
  });
});
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;

const exe = '/opt/pw-browsers/chromium';
const browser = await chromium.launch(fs.existsSync(exe) ? { executablePath: exe } : {});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
await page.route((u) => !u.href.startsWith(base), (r) => r.abort());

await page.goto(base, { waitUntil: 'load' });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem('onboarded-v1', '1');
  localStorage.setItem('boards-v1', JSON.stringify({ activeId: 'b', boards: [
    { id: 'b', name: 'Peak District', destination: 'Bakewell', dated: true, createdAt: 1 }] }));
  localStorage.setItem('board:b:picks', JSON.stringify([
    { id: 'a:1', name: 'Bakewell', city: 'Bakewell', category: 'Town', lat: 53.2129, lon: -1.6753, major: true }]));
  localStorage.setItem('board:b:folders', JSON.stringify(['Bakewell']));
  localStorage.setItem('trip-settings-v1', JSON.stringify({ destination: 'Peak District' }));
});
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(500);

if (screen === 'settings') {
  await page.click('#settingsBtn');
} else {
  await page.evaluate((n) => {
    const t = document.querySelector(`.tabbar [data-view="${n}"], [data-trip-half="${n}"]`);
    if (t && !t.hidden) return t.click();
    if (window.__tripTest && window.__tripTest.showView) return window.__tripTest.showView(n);
    throw new Error(`no way to reach "${n}"`);
  }, screen);
}
await page.waitForTimeout(500);
if (clickSel) { await page.click(clickSel); await page.waitForTimeout(500); }
if (evalJs) console.log('eval ->', JSON.stringify(await page.evaluate(evalJs)));

console.log('title:', await page.title());
console.log('text :', (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 400));
await page.screenshot({ path: out });
console.log('screenshot:', out);
await browser.close();
server.close();
