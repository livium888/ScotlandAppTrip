// Reading what a searching model writes back, for the three searches that
// used to ask for JSON.
//
// On the Gemini 3 models, asking for JSON - even only in the wording of the
// question - silently switches Google Search off: the request succeeds, there
// is no error, and the answer comes from memory. Events were fixed by asking
// for labelled lines instead. Describe-a-place, Places nearby and the event
// backfill have the same fix here: ask for lines when search is on, read the
// lines, and still accept JSON if a model sends it anyway.
import {
  PLACE_LINE_FIELDS, NEARBY_LINE_FIELDS, BACKFILL_LINE_FIELDS, lineFormat,
  readPlaceAnswer, readNearbyAnswer, readBackfillAnswer,
} from '../www/js/lib/listings.js';

let failures = 0;
const check = (l, c, extra) => { if (c) console.log(`PASS: ${l}`); else { console.log(`FAIL: ${l}${extra ? ' :: ' + extra : ''}`); failures++; } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---------- the question must not mention JSON ----------
for (const [what, fields] of [['a described place', PLACE_LINE_FIELDS], ['a place nearby', NEARBY_LINE_FIELDS], ['a backfilled event', BACKFILL_LINE_FIELDS]]) {
  const f = lineFormat(fields);
  check(`asking for ${what} says plain lines, and never "JSON"`, /one listing per line/.test(f) && !/json/i.test(f) && !/[{}\[\]]/.test(fields), fields);
}

// ---------- described places ----------
const p1 = readPlaceAnswer('- name: The Bakehouse; area: Newport; postcode: NP20 1AA; why: Fresh bread and a big window.');
check('a place line is read into its fields', same(p1, [{ name: 'The Bakehouse', area: 'Newport', postcode: 'NP20 1AA', why: 'Fresh bread and a big window.' }]), JSON.stringify(p1));
check('town, village and reason are the same as area and why', same(readPlaceAnswer('- name: Cafe X; town: Leith; reason: quiet'), [{ name: 'Cafe X', area: 'Leith', why: 'quiet' }]));
check('"why" may hold a semicolon of its own', readPlaceAnswer('- name: A; area: B; why: warm; and cheap')[0].why === 'warm; and cheap');
check('a model that writes label and value as alternate parts is read', readPlaceAnswer('- name; Cafe X; area; Leith')[0].area === 'Leith');
check('a bare name and area with no labels are read in that order', same(readPlaceAnswer('- Cafe X; Leith'), [{ name: 'Cafe X', area: 'Leith' }]));
check('chat around the list is ignored', readPlaceAnswer('Sure! Here are some:\n- name: A; area: B\nHope that helps').length === 1);
check('a model that sends JSON anyway is still read', same(readPlaceAnswer('```json\n[{"name":"A","area":"B","postcode":"","why":"w"}]\n```').map((x) => x.name + x.area + x.why), ['ABw']));
check('nothing readable is an empty list, not an error', readPlaceAnswer('I could not find anything.').length === 0 && readPlaceAnswer('').length === 0);

// ---------- places nearby ----------
const n = readNearbyAnswer('- name: Cafe X; area: Leith Walk; why: great flat whites; rating: 4.5/5; reviews: about 1,200; price: ££; booking: no\n- name: Pub Y; area: Docks; why: roast; rating: unknown; price: free; booking: required');
check('a nearby line carries rating, review count, price and booking', n[0].rating === 4.5 && n[0].ratingCount === 1200 && n[0].price === '££' && n[0].booking === false, JSON.stringify(n[0]));
check('a rating that is not confirmed stays null rather than being invented', n[1].rating === null && n[1].ratingCount === null);
check('a price that is not £, ££ or £££ is null, and "required" means booking', n[1].price === null && n[1].booking === true);
check('JSON is still accepted for nearby', readNearbyAnswer('[{"name":"A","area":"B","why":"w","rating":4,"ratingCount":10,"price":"£","booking":true}]')[0].rating === 4);

// ---------- backfilling saved events ----------
const b = readBackfillAnswer('- n: 1; setting: indoor; ages: 3-5; for children: aimed; booking: required\n- n: 2; setting: ; booking: none');
check('a backfill line is matched by its number and carries the fields', b[0].n === 1 && b[0].setting === 'indoor' && b[0].minAge === 3 && b[0].maxAge === 5 && b[0].childFocus === 'aimed' && b[0].booking === 'required', JSON.stringify(b[0]));
check('a field the listing does not state is left out, not guessed', b[1].n === 2 && b[1].setting === undefined && b[1].minAge === undefined && b[1].booking === 'none', JSON.stringify(b[1]));
check('open-ended ages are read', readBackfillAnswer('- n: 1; ages: 8+')[0].minAge === 8);
check('JSON is still accepted for the backfill', readBackfillAnswer('[{"n":1,"setting":"both","minAge":null,"maxAge":null,"childFocus":"","booking":""}]')[0].setting === 'both');

console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
