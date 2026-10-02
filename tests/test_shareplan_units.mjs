// The text of a shared plan, tested in Node.
//
// It is shared as a message, to a partner or grandparent who has no app: it
// has to be enough on its own. Where, when, what to bring (the note, which is
// where a booking reference goes) and a tap to the map. The old text sent only
// a time and a name.
import { planShareText } from '../www/js/lib/shareplan.js';

let failures = 0;
const check = (l, c, extra) => { if (c) console.log(`PASS: ${l}`); else { console.log(`FAIL: ${l}${extra ? ' :: ' + extra : ''}`); failures++; } };

const board = { name: 'Peak District', destination: 'Bakewell' };
const plan = {
  days: [{ id: 'd1', label: 'Day 1 · Sat 3 Oct' }, { id: 'd2', label: 'Day 2 · Sun 4 Oct' }, { id: 'd3', label: 'Day 3 · Mon 5 Oct' }],
  items: {
    d1: [{ pickId: 'p2' }, { pickId: 'p1', time: '10:00' }, { pickId: 'p3', time: '09:00' }],
    d2: [{ pickId: 'p4' }],
    d3: [],
  },
};
const picks = [
  { id: 'p1', name: 'Toddler Rhyme Time', kind: 'event', venue: 'Central Library', area: 'Fareham', booked: true, note: 'ref 48213' },
  { id: 'p2', name: 'Chatsworth', address: '1 Park Rd, Bakewell, DE45 1PP', note: '' },
  { id: 'p3', name: 'Cafe X', area: 'Bakewell', note: 'Ask for the\n  window   table' },
  { id: 'p4', name: 'Castle Walk', note: 'x'.repeat(300) },
  { id: 'p5', name: 'Unplanned Museum', area: 'Matlock', note: 'closed Mondays' },
  { id: 'm1', name: 'Bakewell', major: true },
];
const mapUrl = (p) => `https://maps.example/${encodeURIComponent(p.name)}`;
const where = (p) => [p.venue, p.area || (p.address ? p.address.split(',')[1].trim() : '')].filter((x, i, a) => x && a.indexOf(x) === i).join(', ');
const text = planShareText({ board, plan, picks, mapUrl, where });
const lines = text.split('\n');
const at = (s) => lines.findIndex((l) => l.includes(s));

check('it starts with the trip and where it is', lines[0] === 'Peak District' && lines[1] === 'Bakewell');
check('the destination is left out when there is none, or it repeats the name', !planShareText({ board: { name: 'Trip' }, plan, picks, mapUrl, where }).split('\n')[1].trim() &&
  planShareText({ board: { name: 'Bakewell', destination: 'Bakewell' }, plan, picks, mapUrl, where }).split('\n').filter((l) => l === 'Bakewell').length === 1);
check('each day with something on it has a heading, and an empty day has none', at('— Day 1 · Sat 3 Oct —') >= 0 && at('— Day 2 · Sun 4 Oct —') >= 0 && at('Day 3') < 0);
check('stops come in the order you will do them: timed by time, untimed last', at('Cafe X') < at('Toddler Rhyme Time') && at('Toddler Rhyme Time') < at('Chatsworth'), lines.join('|'));
check('a stop shows its time before its name', lines.some((l) => /^ {2}10:00 Toddler Rhyme Time/.test(l)) && lines.some((l) => /^ {2}Chatsworth/.test(l)));
check('a booked stop says so', lines.some((l) => /Toddler Rhyme Time \(booked\)$/.test(l)) && !lines.some((l) => /Cafe X.*booked/.test(l)));
check('the venue and town follow, indented', lines.some((l) => l === '    Central Library, Fareham') && lines.some((l) => l === '    Bakewell'));
check('the note follows, labelled, on one line', lines.some((l) => l === '    Note: ref 48213') && lines.some((l) => l === '    Note: Ask for the window table'));
check('a very long note is cut short', lines.some((l) => /^ {4}Note: x{150,}…$/.test(l)) && !lines.some((l) => /x{250}/.test(l)));
check('a note that is empty is not shown', !lines.some((l) => /^ {4}Note: *$/.test(l)));
check('each planned stop ends with a map link to tap', lines.some((l) => l === '    https://maps.example/Toddler%20Rhyme%20Time') && lines.some((l) => l === '    https://maps.example/Cafe%20X'));
check('a link that is not an ordinary web link is left out', !planShareText({ board, plan, picks, mapUrl: () => 'javascript:alert(1)', where }).includes('javascript:'));
check('a stop with nothing to add is just its name', (() => { const t = planShareText({ board, plan: { days: [{ id: 'd', label: 'D' }], items: { d: [{ pickId: 'q' }] } }, picks: [{ id: 'q', name: 'Bare' }], mapUrl: () => '', where: () => '' }).split('\n'); return t.includes('  Bare') && t[t.length - 1] === '  Bare'; })());

check('what is saved but not on a day comes last, under its own heading', at('— Not scheduled —') > at('Castle Walk') && at('Unplanned Museum') > at('— Not scheduled —'));
check('with where and note, but no map link, to keep it short', lines.some((l) => l === '    Matlock') && lines.some((l) => l === '    Note: closed Mondays') && !lines.some((l) => /maps\.example\/Unplanned/.test(l)));
check('a town heading is not a place to go, so it is not listed as a stop', !lines.some((l) => /^ {2}Bakewell$/.test(l)));
check('with everything planned there is no "not scheduled" section', !planShareText({ board, plan, picks: picks.filter((p) => p.id !== 'p5'), mapUrl, where }).includes('Not scheduled'));
check('with nothing saved it says so, rather than sending only a title', /Nothing saved yet/.test(planShareText({ board, plan: { days: [], items: {} }, picks: [], mapUrl, where })));
check('a stop whose place has been deleted is skipped, not printed as undefined', !/undefined/.test(planShareText({ board, plan: { days: [{ id: 'd', label: 'D' }], items: { d: [{ pickId: 'gone' }, { pickId: 'p1', time: '10:00' }] } }, picks, mapUrl, where })));
check('it never ends or starts with blank space', text === text.trim());

console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
