// Naming the cinemas and theatres in an area, tested in Node.
//
// A trace from a phone showed what happens without names: theatre and music
// searches, which were handed venues to check, searched the web and found
// listings; the films search, which had no cinema names because the map
// server timed out, did not search at all and answered from memory - all of
// it set aside. Names make the model look things up, so there are now three
// sources, tried together: the map servers, a second OpenStreetMap lookup
// that goes through the place-search server, and - failing both - the towns
// themselves and the cinema chains.
import { viewboxFor, parseNominatimVenues, venuesLine, firstNonEmpty } from '../www/js/lib/venues.js';

let failures = 0;
const check = (l, c, extra) => { if (c) console.log(`PASS: ${l}`); else { console.log(`FAIL: ${l}${extra ? ' :: ' + extra : ''}`); failures++; } };

// ---------- the box to search in ----------
const vb = viewboxFor(50.86, -1.23, 25 * 1609).split(',').map(Number);
check('a box is left,top,right,bottom around the point, about 25 miles each way', vb.length === 4 && vb[0] < -1.23 && vb[2] > -1.23 && vb[1] > 50.86 && vb[3] < 50.86 &&
  Math.abs((vb[1] - vb[3]) / 2 * 111.32 - 40.2) < 1, vb.join());
check('and wider in longitude than latitude, because longitude lines close in toward the poles', (vb[2] - vb[0]) > (vb[1] - vb[3]));

// ---------- reading the place-search answer ----------
const hit = (name, type, lat, lon, town, cls = 'amenity') => ({ class: cls, type, lat: String(lat), lon: String(lon), display_name: `${name}, ${town}`, namedetails: { name }, address: { town } });
const results = [
  hit('Vue Portsmouth', 'cinema', 50.80, -1.10, 'Portsmouth'),
  hit('Reel Cinema', 'cinema', 50.85, -1.18, 'Fareham'),
  hit('Cinema Road', 'residential', 50.86, -1.23, 'Fareham', 'highway'),
  hit('Vue Portsmouth', 'cinema', 50.80, -1.10, 'Portsmouth'),
  { class: 'amenity', type: 'cinema', lat: '50.9', lon: '-1.4', display_name: 'Harbour Lights, Ocean Way, Southampton', address: { city: 'Southampton' } },
];
const names = parseNominatimVenues(results, { lat: 50.86, lon: -1.23, types: ['cinema'] });
check('only places of the right kind are kept - a road with "cinema" in its name is not a cinema', !names.some((n) => /Cinema Road/.test(n)));
check('nearest first, with the town where the name does not already say it', names[0] === 'Reel Cinema (Fareham)' && names.includes('Vue Portsmouth'), JSON.stringify(names));
check('the same place twice is listed once', names.filter((n) => /Vue Portsmouth/.test(n)).length === 1);
check('a missing name falls back to the first part of the address', names.some((n) => /^Harbour Lights/.test(n)));
check('theatres include arts centres', parseNominatimVenues([hit('The Point', 'arts_centre', 50.97, -1.35, 'Eastleigh'), hit('Mayflower', 'theatre', 50.9, -1.4, 'Southampton')], { lat: 50.86, lon: -1.23, types: ['theatre', 'arts_centre'] }).length === 2);
check('nothing, or nonsense, gives an empty list', parseNominatimVenues(null, { lat: 0, lon: 0, types: ['cinema'] }).length === 0 && parseNominatimVenues([{}, null], { lat: 0, lon: 0, types: ['cinema'] }).length === 0);
check('no more than twelve', parseNominatimVenues(Array.from({ length: 30 }, (_, i) => hit(`Cinema ${i}`, 'cinema', 50.86 + i / 1000, -1.23, 'Town')), { lat: 50.86, lon: -1.23, types: ['cinema'] }).length === 12);

// ---------- the sentence that makes the model look ----------
const named = venuesLine({ film: true, named: ['Reel Cinema (Fareham)', 'Vue Portsmouth'], towns: ['Fareham'] });
check('with names, they are listed and each one\'s own listings are to be checked', /Cinemas in this area include: Reel Cinema \(Fareham\), Vue Portsmouth\. Check each one's own listings\./.test(named));
const byTown = venuesLine({ film: true, named: [], towns: ['Fareham', 'Portsmouth', 'Southampton'] });
check('with no names but towns, the towns are named and the model is told to look up the cinemas in each', /in or near: Fareham, Portsmouth, Southampton/.test(byTown) && /each cinema's own listings/.test(byTown));
check('and the chains are named, since a chain has a page per cinema', /Vue/.test(byTown) && /Odeon/.test(byTown) && /Cineworld/.test(byTown) && /Reel/.test(byTown) && /Picturehouse/.test(byTown));
check('with neither names nor towns, it still tells the model to check the chains and independents', /Vue/.test(venuesLine({ film: true, named: [], towns: [] })) && venuesLine({ film: true, named: [], towns: [] }).length > 40);
const th = venuesLine({ film: false, named: [], towns: ['Eastleigh', 'Fareham'] });
check('theatres are worded for theatres and arts centres, and name no chains', /Theatres and arts centres/.test(th) && /Eastleigh, Fareham/.test(th) && !/Vue|Odeon/.test(th));
check('no more than twelve towns are listed, so the question stays short', (venuesLine({ film: true, named: [], towns: Array.from({ length: 30 }, (_, i) => `T${i}`) }).match(/T\d+/g) || []).length === 12);

// ---------- the first source to have an answer wins ----------
const later = (v, ms) => new Promise((r) => setTimeout(() => r(v), ms));
check('the first non-empty answer wins, even if an earlier one is slower', JSON.stringify(await firstNonEmpty([later(['slow'], 60), later(['fast'], 5)])) === '["fast"]');
check('an empty answer does not win while another is still coming', JSON.stringify(await firstNonEmpty([later([], 5), later(['x'], 40)])) === '["x"]');
check('if every source is empty, or fails, the answer is empty', (await firstNonEmpty([later([], 5), Promise.reject(new Error('x')), later(null, 5)])).length === 0);

console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
