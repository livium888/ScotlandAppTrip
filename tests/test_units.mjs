// The pure helpers, tested directly in Node with no browser.
//
// app.js is one 21,000-line closure, so nothing in it could be tested without
// launching Chromium and driving a page. These functions have no business
// with the page - they take text and return text or data - and they were
// moved out into www/js/lib/ so they can be. Behaviour is unchanged; the
// browser suites still cover the app using them.
import { esc, safeUrl, cityColor } from '../www/js/lib/text.js';
import { extractJson, partialListings, lineFormat, parseListingLines } from '../www/js/lib/listings.js';

let failures = 0;
const check = (l, c, extra) => { if (c) console.log(`PASS: ${l}`); else { console.log(`FAIL: ${l}${extra ? ' :: ' + extra : ''}`); failures++; } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---------- text ----------
check('esc covers both text and attribute values', esc(`Bar" onmouseover="x' <b>&\``) ===
  'Bar&quot; onmouseover=&quot;x&#39; &lt;b&gt;&amp;&#96;');
check('esc turns nothing into an empty string', esc(null) === '' && esc(undefined) === '' && esc(0) === '0');
check('safeUrl refuses script and data links', safeUrl('javascript:alert(1)') === '' && safeUrl('data:text/html,x') === '');
check('safeUrl lets ordinary links, phone numbers and email through',
  safeUrl('https://a.example/x') === 'https://a.example/x' && safeUrl('tel:+441234') === 'tel:+441234' && safeUrl('mailto:a@b.co') === 'mailto:a@b.co');
check('safeUrl treats bare and protocol-relative domains as https',
  safeUrl('www.example.com') === 'https://www.example.com' && safeUrl('//cdn.example.com/a') === 'https://cdn.example.com/a');
check('a town gets the same colour every time, and different towns differ', cityColor('Bakewell') === cityColor('Bakewell') &&
  cityColor('Bakewell') !== cityColor('Matlock') && /^hsl\(/.test(cityColor('')));

// ---------- extractJson ----------
check('JSON inside a code fence is found', same(extractJson('Here:\n```json\n[{"a":1}]\n```\nDone'), [{ a: 1 }]));
check('JSON in the middle of prose is found', same(extractJson('Sure! [{"a":1},{"a":2}] hope that helps'), [{ a: 1 }, { a: 2 }]));
const cut = extractJson('[{"name":"A","date":"2026-10-03"},{"name":"B","da');
check('an answer cut off mid-object keeps what had finished, and drops the half-written field',
  Array.isArray(cut) && same(cut[0], { name: 'A', date: '2026-10-03' }) && cut.length === 2 && same(cut[1], { name: 'B' }), JSON.stringify(cut));
check('no JSON at all is null', extractJson('nothing here') === null && extractJson('') === null);

// ---------- partialListings ----------
check('finished objects in an unfinished array are read, half-written ones are left',
  same(partialListings('[{"n":1},{"n":2},{"n":'), [{ n: 1 }, { n: 2 }]));
check('braces inside strings do not confuse it', same(partialListings('[{"n":"a } b"}, {"n":2}]'), [{ n: 'a } b' }, { n: 2 }]));

// ---------- lineFormat ----------
check('the line format asks for one listing per line, labelled', /one listing per line/.test(lineFormat('name; venue')) &&
  /"label: value"/.test(lineFormat('name; venue')) && lineFormat('name; venue').includes('name; venue'));

// ---------- parseListingLines ----------
const one = (t) => parseListingLines(t)[0];
check('"label: value; label: value" lines are read',
  same(one('- name: Folk Evening; venue: Town Hall; town: Bakewell; date: 2026-10-03; time: 19:30; price: ££'),
    { name: 'Folk Evening', venue: 'Town Hall', area: 'Bakewell', date: '2026-10-03', time: '19:30', price: '££' }));
check('label and value as alternate parts are read', same(one('- name; PAW Patrol; venue; Vue Portsmouth; date; 2026-10-02'),
  { name: 'PAW Patrol', venue: 'Vue Portsmouth', date: '2026-10-02' }));
check('a value in brackets is read', one('- name (Storytime); date (2026-10-04)').date === '2026-10-04');
check('unlabelled name, venue and town are read in that order', same(one('- Gruffalo; Odeon; Fareham'),
  { name: 'Gruffalo', venue: 'Odeon', area: 'Fareham' }));
check('times become a list and ages become a range', same(one('- name: Swim; times: 10:00, 14:00; ages: 2-4').times, ['10:00', '14:00']) &&
  one('- name: Swim; ages: 2-4').minAge === 2 && one('- name: Swim; ages: 2-4').maxAge === 4 && one('- name: Swim; ages: 8+').minAge === 8);
check('"what" keeps a semicolon of its own', one('- name: A; what: lovely; really').what === 'lovely; really');
check('"none found" is not a listing', parseListingLines('- name: No qualifying screenings found').length === 0);
check('lines that are not list items are ignored', parseListingLines('Here you go:\nThanks!').length === 0);
check('with wholeOnly, a line still being written is left for later',
  parseListingLines('- name: A; date: 2026-10-03\n- name: B; da', true).length === 1 &&
  parseListingLines('- name: A; date: 2026-10-03\n- name: B; date: 2026-10-04\n', true).length === 2);

console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
