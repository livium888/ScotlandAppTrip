// The storage keeper, tested in Node against a pretend phone.
//
// Every part of the app used to reach into localStorage on its own. The
// guarded write and the forgiving JSON read existed, but nine places went
// around them, so the rules (what to do when the phone is full, what to do
// when a saved value is damaged) lived in several places and held in some.
// createStorage is the one keeper; the backend is passed in so a full phone
// and a blocked one can be pretended here, which a real browser can't do on
// demand.
import fs from 'node:fs';
import { createStorage } from '../www/js/lib/storage.js';

let failures = 0;
const check = (l, c, extra) => { if (c) console.log(`PASS: ${l}`); else { console.log(`FAIL: ${l}${extra ? ' :: ' + extra : ''}`); failures++; } };

// A pretend localStorage with a size limit and switches for the ways it breaks.
const phone = ({ limit = Infinity, blocked = false } = {}) => {
  const data = new Map();
  const api = {
    data,
    limit,
    blocked,
    getItem: (k) => { if (api.blocked) throw new Error('storage blocked'); return data.has(k) ? data.get(k) : null; },
    setItem: (k, v) => {
      if (api.blocked) throw new Error('storage blocked');
      const used = [...data].reduce((n, [kk, vv]) => n + (kk === k ? 0 : kk.length + vv.length), 0);
      if (used + k.length + String(v).length > api.limit) { const e = new Error('full'); e.name = 'QuotaExceededError'; throw e; }
      data.set(k, String(v));
    },
    removeItem: (k) => data.delete(k),
  };
  return api;
};

// ---------- the ordinary case ----------
{
  const b = phone(); const s = createStorage({ backend: b });
  check('a write is kept, reported as kept, and can be read back', s.write('a', '1') === true && s.read('a') === '1' && b.data.get('a') === '1');
  check('a key that was never written reads as null', s.read('nope') === null);
  s.remove('a');
  check('removing forgets it', s.read('a') === null);
  s.write('x', '1'); s.write('y', '2'); s.removeMany(['x', 'y', 'never-there']);
  check('several can be removed at once, including ones that were never there', s.read('x') === null && s.read('y') === null);
}

// ---------- reading JSON ----------
{
  const b = phone(); const s = createStorage({ backend: b });
  s.write('ok', JSON.stringify({ a: [1, 2] }));
  check('saved JSON comes back as data', JSON.stringify(s.readJson('ok', null)) === '{"a":[1,2]}');
  check('a missing key gives the fallback', s.readJson('missing', 'fb') === 'fb');
  s.write('bad', '{"a": [1,');
  check('damaged JSON gives the fallback instead of throwing', s.readJson('bad', 'fb') === 'fb');
  s.write('null', 'null');
  check('a stored null gives the fallback', s.readJson('null', 'fb') === 'fb');
  s.write('zero', '0');
  check('a stored zero is a value, not a missing one', s.readJson('zero', 'fb') === 0);
}

// ---------- the phone is blocked outright ----------
{
  const b = phone({ blocked: true }); const s = createStorage({ backend: b });
  check('reads on a blocked phone give null and the fallback', s.read('a') === null && s.readJson('a', 'fb') === 'fb');
  let threw = null;
  try { s.write('a', '1'); } catch (e) { threw = e; }
  check('a write that fails for a reason other than space is not hidden', threw && /blocked/.test(threw.message));
}

// ---------- a full phone ----------
{
  const b = phone({ limit: 60 });
  let told = 0;
  const s = createStorage({ backend: b, onFull: () => told++, expendable: ['weather-cache', 'recent'] });
  b.setItem('weather-cache', 'W'.repeat(30));
  b.setItem('recent', 'R'.repeat(10));
  check('with only expendable things in the way, a write makes room and succeeds', s.write('trip', 'T'.repeat(30)) === true &&
    s.read('weather-cache') === null && s.read('recent') === null && s.read('trip') === 'T'.repeat(30));
  check('and nobody is bothered about it', told === 0);

  check('with nothing left to clear, the write fails and says so', s.write('big', 'B'.repeat(200)) === false && told === 1);
  check('what was already saved is untouched by the failed write', s.read('trip') === 'T'.repeat(30) && s.read('big') === null);
  s.write('big2', 'B'.repeat(200));
  check('it only says so once, not on every failed edit', told === 1);
}

// ---------- the render cache is told ----------
{
  const b = phone(); let n = 0;
  const s = createStorage({ backend: b, onWrite: () => n++ });
  s.write('a', '1'); s.write('b', '2');
  check('every write tells the caller, so anything cached from storage can be dropped', n === 2);
}

// ---------- the default list of expendables ----------
{
  const b = phone({ limit: 70 });
  const s = createStorage({ backend: b });
  b.setItem('weather-cache-v1', 'W'.repeat(40));
  check('by default the forecast cache is what gets cleared to make room', s.write('trip', 'T'.repeat(40)) === true && s.read('weather-cache-v1') === null);
}

// ---------- and nothing goes around it ----------
{
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  const app = strip(fs.readFileSync(new URL('../www/js/app.js', import.meta.url), 'utf8'));
  const stray = app.split('\n').filter((l) => /\blocalStorage\b/.test(l.replace(/\/\/.*$/, '')));
  check('app.js never touches localStorage itself - every read and write goes through the keeper', stray.length === 0, stray.join(' | ').slice(0, 200));
}

console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
