// test/coach.test.mjs - koc notlari testi
import { parsePgn, buildPositions, sampleGames } from '../js/pgn.js';
import { GameAnalyzer } from '../js/analysis.js';
import { generateCoachNotes } from '../js/coach.js';
import { searchPosition } from '../js/engine-core.js';

let pass = 0, fail = 0;
function ok(cond, label) { if (cond) pass++; else { fail++; console.error('  x BASARISIZ: ' + label); } }

const game = sampleGames().find(g => g.id === 'century');
const parsed = parsePgn(game.pgn);
const fens = buildPositions(parsed);
const analyzer = new GameAnalyzer(parsed, fens);
const tt = new Map();
const fakeEngine = { analyze: (fen, mt) => Promise.resolve(searchPosition(fen, { movetime: mt, maxDepth: 12, tt })) };
await analyzer.run({ engine: fakeEngine, movetime: 120 });

const notes = generateCoachNotes(analyzer, parsed.headers, parsed.result);
ok(notes !== null, 'notlar uretildi');
ok(notes.sections.length >= 5, '5+ bolum var: ' + notes.sections.length);
ok(notes.markdown.includes('# Oyun Analiz Raporu'), 'markdown basligi');
ok(notes.markdown.includes('| # | Hamle |'), 'markdown hamle tablosu');
ok(notes.summary.accuracy.w > 70 && notes.summary.accuracy.b > 70, 'dogruluklar makul aralikta');
ok(notes.sections.length >= 5, 'bolum sayisi');
const crit = notes.sections.find(s => s.title === 'Kritik anlar');
ok(crit && crit.items.length > 0, 'kritik anlar dolu');
console.log('\n--- ORNEK CIKTI (ilk 3 madde) ---');
for (const s of notes.sections.slice(0, 3)) {
  console.log('\n## ' + s.title);
  for (const it of s.items.slice(0, 3)) console.log(' - ' + it.slice(0, 160));
}
console.log(`\n${pass} gecti, ${fail} basarisiz`);
process.exit(fail ? 1 : 0);
