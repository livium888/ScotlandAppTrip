// How old an answer is, and what has been hidden for good - tested in Node.
//
// Three gaps found by reading what the app did: a fresh search showed no age
// at all (so an app left in the background looked current for hours); a result
// hidden as wrong came back on the very next search; and a saved event never
// recorded when it was found, so a listing that had since changed looked as
// fresh as the day it was saved. These are the rules; the screens are tested
// in the browser.
import { agoWords, searchAge, foundNote, STALE_AFTER_MS } from '../www/js/lib/freshness.js';
import { addHidden, removeHidden, isHidden, pruneHidden, HIDDEN_MAX } from '../www/js/lib/hidden.js';

let failures = 0;
const check = (l, c, extra) => { if (c) console.log(`PASS: ${l}`); else { console.log(`FAIL: ${l}${extra ? ' :: ' + extra : ''}`); failures++; } };
const MIN = 60000, HOUR = 3600000, DAY = 86400000;
const now = Date.UTC(2026, 9, 3, 12, 0, 0);

// ---------- saying how long ago ----------
check('under a minute is "just now"', agoWords(now - 20000, now) === 'just now' && agoWords(now, now) === 'just now');
check('minutes, hours, yesterday, days', agoWords(now - 14 * MIN, now) === '14 min ago' && agoWords(now - 3 * HOUR, now) === '3 h ago' && agoWords(now - 30 * HOUR, now) === 'yesterday' && agoWords(now - 5 * DAY, now) === '5 days ago');
check('a time in the future is treated as now rather than "-3 min ago"', agoWords(now + 5 * MIN, now) === 'just now');

// ---------- how old a search is ----------
check('a fresh search is dated, and not stale', (() => { const a = searchAge({ at: now - 10 * MIN, now }); return a.text === 'Searched 10 min ago' && a.stale === false; })());
check('after six hours it is stale, and says so', (() => { const a = searchAge({ at: now - 7 * HOUR, now }); return a.stale === true && /7 h ago/.test(a.text); })() && STALE_AFTER_MS === 6 * HOUR);
check('a search with no time is not dated at all, rather than "Searched NaN"', searchAge({ at: 0, now }) === null && searchAge({ at: undefined, now }) === null);

// ---------- how old a saved event is ----------
check('an event with no record of when it was found says nothing', foundNote({ foundAt: undefined, startsAt: now + DAY, now }) === null);
const recent = foundNote({ foundAt: now - 2 * HOUR, startsAt: now + 2 * DAY, now });
check('a recently found event says when, without a warning', recent.text === 'Found 2 h ago' && recent.check === false);
const old = foundNote({ foundAt: now - 5 * DAY, startsAt: now + 2 * DAY, now });
check('one found days ago, and still ahead, warns that listings change', old.check === true && /Found 5 days ago/.test(old.text) && /check it's still on/i.test(old.text));
check('once it has happened, there is nothing to check', foundNote({ foundAt: now - 5 * DAY, startsAt: now - DAY, now }).check === false);
check('a start time can be a date string as well as a number', foundNote({ foundAt: now - 5 * DAY, startsAt: new Date(now + 2 * DAY).toISOString(), now }).check === true);
check('exactly three days is the line', foundNote({ foundAt: now - 3 * DAY, startsAt: now + DAY, now }).check === true && foundNote({ foundAt: now - 3 * DAY + MIN, startsAt: now + DAY, now }).check === false);

// ---------- hiding for good ----------
let list = [];
list = addHidden(list, 'folknight|2026-10-04', '2026-10-04', now);
check('hiding something remembers it', isHidden(list, 'folknight|2026-10-04') && !isHidden(list, 'other|2026-10-04'));
check('hiding it twice keeps one entry', addHidden(list, 'folknight|2026-10-04', '2026-10-04', now).length === 1);
check('un-hiding forgets it', !isHidden(removeHidden(list, 'folknight|2026-10-04'), 'folknight|2026-10-04') && removeHidden(list, 'nope').length === 1);
check('the list it was given is never changed', list.length === 1 && addHidden(list, 'x|y', '', now).length === 2 && list.length === 1);
check('newest first, and capped so it cannot grow for ever', (() => { let l = []; for (let i = 0; i < HIDDEN_MAX + 25; i++) l = addHidden(l, `e${i}|2026-10-04`, '2026-10-04', now + i); return l.length === HIDDEN_MAX && l[0].k === `e${HIDDEN_MAX + 24}|2026-10-04` && !isHidden(l, 'e0|2026-10-04'); })());

// ---------- and letting go once it is over ----------
const mixed = [
  { k: 'past|2026-09-20', d: '2026-09-20', at: now - 13 * DAY },
  { k: 'today|2026-10-03', d: '2026-10-03', at: now - DAY },
  { k: 'future|2026-10-10', d: '2026-10-10', at: now - DAY },
  { k: 'undated-old', d: '', at: now - 90 * DAY },
  { k: 'undated-new', d: '', at: now - 5 * DAY },
];
const kept = pruneHidden(mixed, now).map((e) => e.k);
check('an event that has been is forgotten, so the list does not keep what no longer matters', !kept.includes('past|2026-09-20') && kept.includes('today|2026-10-03') && kept.includes('future|2026-10-10'));
check('with no date it is kept for sixty days', kept.includes('undated-new') && !kept.includes('undated-old'));
check('pruning an empty or damaged list is safe', pruneHidden([], now).length === 0 && pruneHidden(null, now).length === 0 && pruneHidden([null, {}, 'x'], now).length === 0);

console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
