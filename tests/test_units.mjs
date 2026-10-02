// The pure helpers, tested directly in Node with no browser.
//
// app.js is one 21,000-line closure, so nothing in it could be tested without
// launching Chromium and driving a page. These functions have no business
// with the page - they take text and return text or data - and they were
// moved out into www/js/lib/ so they can be. Behaviour is unchanged; the
// browser suites still cover the app using them.
import { esc, safeUrl, cityColor } from '../www/js/lib/text.js';
import { haversineKm, toMiles, formatDistance, formatDuration, legLabel } from '../www/js/lib/geo.js';
import { timeToMinutes, formatTime, labelForDate, dayCodeFromLabel, clockOf, shortDayLabel, isoDate } from '../www/js/lib/time.js';
import { icsEscape, icsFold, icsStamp, icsDay } from '../www/js/lib/ics.js';
import { describeGeminiError, scoreGeminiModel, chooseGeminiModel, scoreSearchModel, rateForModel, money4, openAiCitations, isQuotaError, readGeminiStream } from '../www/js/lib/ai.js';
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

// ---------- geo ----------
check('Edinburgh to Glasgow is about 67 km as the crow flies', Math.abs(haversineKm(55.9533, -3.1883, 55.8642, -4.2518) - 67) < 2);
check('the same point is zero apart, and distance is symmetric', haversineKm(53, -1, 53, -1) === 0 &&
  Math.abs(haversineKm(53, -1, 54, -2) - haversineKm(54, -2, 53, -1)) < 1e-9);
check('kilometres become miles', Math.abs(toMiles(10) - 6.21371) < 1e-6);
check('short distances are in yards, middling in tenths of a mile, long in whole miles',
  formatDistance(0.2) === '220 yd' && formatDistance(1.6) === '1.0 mi' && formatDistance(32) === '20 mi', `${formatDistance(0.2)}|${formatDistance(1.6)}|${formatDistance(32)}`);
check('durations read as minutes, hours, or both', formatDuration(45) === '45 min' && formatDuration(120) === '2 h' && formatDuration(95) === '1 h 35 min');
check('a leg says how, how long and how far', legLabel({ icon: 'W', mins: 12, km: 1.6 }) === 'W 12 min · 1.0 mi');

// ---------- time ----------
check('times are understood the ways people write them', timeToMinutes('9') === 540 && timeToMinutes('09:30') === 570 && timeToMinutes('9.30') === 570 &&
  timeToMinutes('2pm') === 840 && timeToMinutes('12am') === 0 && timeToMinutes('12pm') === 720 && timeToMinutes('7h15') === 435);
check('nonsense times are null, not a wrong number', timeToMinutes('') === null && timeToMinutes('25:00') === null && timeToMinutes('10:75') === null && timeToMinutes('soon') === null);
check('times are shown as HH:MM, and left alone when unreadable', formatTime('2pm') === '14:00' && formatTime('9') === '09:00' && formatTime('late') === 'late');
const sat = new Date(2026, 9, 3, 7, 5);
check('a date has a weekday, day and month', labelForDate(sat) === 'Sat 3 Oct');
check('a day label gives its two-letter code', dayCodeFromLabel('Day 2 · Sat 3 Oct') === 'Sa' && dayCodeFromLabel('Day 2') === null);
check('a day label is shortened for a chip', shortDayLabel('Day 2 · Sat 3 Oct') === 'Sat 3' && shortDayLabel('Day 1 · Arrival') === 'Arrival');
check('a clock and an ISO date are zero-padded', clockOf(sat) === '07:05' && isoDate(sat) === '2026-10-03');

// ---------- calendar files ----------
check('calendar text escapes backslash, semicolon, comma and newline', icsEscape('a\\b;c,d\ne') === 'a\\\\b\\;c\\,d\\ne', icsEscape('a\\b;c,d\ne'));
check('long calendar lines fold at 75 characters, continuing with a space', (() => {
  const folded = icsFold('X'.repeat(200)).split('\r\n');
  return folded[0].length === 75 && folded.slice(1).every((l) => l.startsWith(' ') && l.length <= 75) && folded.join('').replace(/ /g, '') === 'X'.repeat(200);
})() && icsFold('short') === 'short');
check('calendar stamps are UTC and dates are local', icsStamp(new Date(Date.UTC(2026, 9, 3, 7, 5, 9))) === '20261003T070509Z' && icsDay(sat) === '20261003');

// ---------- Gemini errors say what to do ----------
const err = (status, message, extra = {}) => describeGeminiError(status, { error: { message, ...extra } }, '');
check('a rejected key says to check it is a Gemini key', /API_KEY_INVALID/.test(err(400, 'API key not valid. Please pass a valid API key.')) &&
  /aistudio\.google\.com/.test(err(400, 'API key not valid')));
check('a disabled API says to enable it', /isn't enabled/.test(err(403, 'Generative Language API has not been used in project 1 before or it is disabled')));
check('an application-restricted key says to set restrictions to None', /Application restrictions to "None"/.test(err(403, 'Requests from referer <empty> are blocked.')));
check('other refusals, missing models and quota each get their own words', /API restrictions/.test(err(403, 'nope')) &&
  /Model not found/.test(err(404, 'x')) && /Rate limit or quota/.test(err(429, 'x')) && /^Gemini returned 500/.test(err(500, 'x')));
check('Google\'s own message is always kept', err(429, 'Quota exceeded for metric X').includes('Quota exceeded for metric X'));
check('with no body at all it still says something', /no detail/.test(describeGeminiError(502, null, '')));

// ---------- choosing a model ----------
const models = ['models/gemini-2.5-flash', 'models/gemini-3.5-flash-lite', 'models/gemini-3.5-flash', 'models/gemini-3.5-pro-preview', 'models/gemini-2.0-flash-001'];
check('the default is the newest generation, preferring the cheapest capable tier', chooseGeminiModel(models.map((name) => ({ name }))) === 'models/gemini-3.5-flash-lite');
check('previews and dated builds rank below the same model without', scoreGeminiModel('models/gemini-3.5-flash-preview') < scoreGeminiModel('models/gemini-3.5-flash') &&
  scoreGeminiModel('models/gemini-2.0-flash-001') < scoreGeminiModel('models/gemini-2.0-flash'));
check('with nothing available, nothing is chosen', chooseGeminiModel([]) === '');
check('for searching, a full flash beats pro beats lite - tier before version', scoreSearchModel('models/gemini-2.5-flash') > scoreSearchModel('models/gemini-3.5-pro') &&
  scoreSearchModel('models/gemini-3.5-pro') > scoreSearchModel('models/gemini-3.5-flash-lite'));
check('image, speech, embedding and open models are never used for searching', ['gemini-3-pro-image', 'gemini-2.5-flash-preview-tts', 'text-embedding-004', 'gemma-3-27b', 'gemini-2.0-flash-live']
  .every((n) => scoreSearchModel(n) === -Infinity));

// ---------- the usage meter ----------
check('cost rates match the cheapest tier first', rateForModel('models/gemini-3.5-flash-lite').label === 'Flash-Lite' &&
  rateForModel('gemini-3.5-flash').label === 'Flash' && rateForModel('gemini-3.5-pro').label === 'Pro' && rateForModel('mystery').label === 'unknown model');
check('money reads as pounds, or "less than 1p"', money4(0) === '£0' && money4(0.004) === 'less than 1p' && money4(1.234) === '£1.23');

// ---------- citations from other hosts ----------
check('citations are read from annotations, a flat list and search results, without duplicates', same(openAiCitations(
  { citations: ['https://a.example', { url: 'https://b.example', title: 'B' }], search_results: [{ url: 'https://c.example', title: 'C' }, { url: 'https://a.example' }] },
  { message: { annotations: [{ type: 'url_citation', url_citation: { url: 'https://a.example', title: 'A' } }] } }),
  [{ title: 'A', uri: 'https://a.example' }, { title: 'B', uri: 'https://b.example' }, { title: 'C', uri: 'https://c.example' }]));
check('no citations is an empty list, not an error', same(openAiCitations(null, null), []));

// ---------- a full phone ----------
check('a full phone is recognised however the browser names it', isQuotaError({ name: 'QuotaExceededError' }) && isQuotaError({ code: 22 }) &&
  isQuotaError({ name: 'NS_ERROR_DOM_QUOTA_REACHED' }) && !isQuotaError(new Error('other')) && !isQuotaError(null));

// ---------- the answer arriving in pieces ----------
const sse = (chunks) => new Response(new ReadableStream({ start(c) { chunks.forEach((x) => c.enqueue(new TextEncoder().encode(x))); c.close(); } }));
const seen = [];
const body = (o) => `data: ${JSON.stringify(o)}\n\n`;
const merged = await readGeminiStream(sse([
  body({ candidates: [{ content: { parts: [{ text: '- name: A' }] } }] }),
  // One event split across two network reads.
  body({ candidates: [{ content: { parts: [{ text: '; date: 1' }] }, groundingMetadata: { webSearchQueries: ['q1'], groundingChunks: [{ web: { uri: 'u1' } }] } }], usageMetadata: { promptTokenCount: 5 } }).slice(0, 40),
  body({ candidates: [{ content: { parts: [{ text: '; date: 1' }] }, groundingMetadata: { webSearchQueries: ['q1'], groundingChunks: [{ web: { uri: 'u1' } }] } }], usageMetadata: { promptTokenCount: 5 } }).slice(40),
]), (t) => seen.push(t));
check('the text is announced as it grows', seen.length >= 1 && seen[seen.length - 1] === '- name: A; date: 1', JSON.stringify(seen));
check('what was searched and the token counts survive the merge', same(merged.candidates[0].groundingMetadata.webSearchQueries, ['q1']) &&
  merged.usageMetadata.promptTokenCount === 5 && merged.candidates[0].content.parts.map((p) => p.text).join('') === '- name: A; date: 1', JSON.stringify(merged));
check('a display callback that throws does not fail the search', await readGeminiStream(sse([body({ candidates: [{ content: { parts: [{ text: 'x' }] } }] })]),
  () => { throw new Error('ui'); }).then(() => true, () => false));

console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
