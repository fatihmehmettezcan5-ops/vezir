// test/analysis.test.mjs - analiz ve siniflandirma testleri
import { parsePgn, buildPositions, sampleGames } from '../js/pgn.js';
import { GameAnalyzer, moveAccuracy, winProbability, scoreToWinPercent } from '../js/analysis.js';
import { searchPosition } from '../js/engine-core.js';

let pass = 0, fail = 0;
function ok(cond, label) { if (cond) pass++; else { fail++; console.error('  x BASARISIZ: ' + label); } }
function eq(a, b, label) { ok(a === b, `${label} (beklenen ${JSON.stringify(b)}, bulunan ${JSON.stringify(a)})`); }

// Formul testleri
eq(Math.round(winProbability(0)), 50, '0 cp -> %50');
ok(winProbability(300) > 70 && winProbability(300) < 80, '+3 cp -> ~%75');
ok(winProbability(-300) < 40, '-3 cp -> ~%35');
eq(Math.round(moveAccuracy(0)), 100, 'kayipsiz hamle -> %100 dogruluk');
ok(moveAccuracy(30) < 35, 'buyuk kayip -> dusuk dogruluk');
eq(scoreToWinPercent(null, 3), 100, 'mat-3 -> %100');
eq(scoreToWinPercent(null, -2), 0, 'mat-e-2 -> %0');

// Gercek oyun analizi (hizli mod)
console.log('Opera Oyunu analizi...');
const game = sampleGames().find(g => g.id === 'opera');
const parsed = parsePgn(game.pgn);
const fens = buildPositions(parsed);
eq(fens.length, parsed.moves.length + 1, 'konum sayisi');

const analyzer = new GameAnalyzer(parsed, fens);
const tt = new Map();
// motoru dogrudan cagiran sahte engine
const fakeEngine = {
  analyze: (fen, movetime) => Promise.resolve(searchPosition(fen, { movetime, maxDepth: 12, tt }))
};
await analyzer.run({ engine: fakeEngine, movetime: 300 });

ok(analyzer.done, 'analiz tamamlandi');
eq(analyzer.moves.length, parsed.moves.length, 'her hamle analiz edildi');

const summary = analyzer.summary();
ok(summary.accuracy.w > 50 && summary.accuracy.w <= 100, 'beyaz dogruluk mantikli: ' + summary.accuracy.w.toFixed(1));
ok(summary.accuracy.b >= 80 && summary.accuracy.b <= 100,
   'siyah dogruluk mantikli: ' + summary.accuracy.b.toFixed(1));
// NOT: "kazananin dogrulugu daha yuksek" genel bir kural DEGIL. Opera oyununda
// her iki taraf da temiz oynar (mat zorlamasi gelene kadar); Olumsuz Ornek
// (Evergreen Game) kazananin dogrulugunun daha DUSUK oldugu bir feda oyunudur.
ok(summary.accuracy.w >= 85,
   'kazanan (beyaz) mat verene kadar temiz oynadi: %' + summary.accuracy.w.toFixed(1));

// Son hamle mat olarak isaretlenmeli
const last = analyzer.moves[analyzer.moves.length - 1];
eq(last.san, 'Rd8#', 'son hamle Rd8#');
eq(last.class, 'mate', 'son hamle MAT sinifi');

// Morphy nun kurban hamlesi (Nxb5) en iyi hamle olmali
const sac = analyzer.moves.find(m => m.san === 'Nxb5');
ok(sac && (sac.isBestMove || sac.class === 'brilliant' || sac.class === 'best'), 'Nxb5 en iyi/parlak hamle: ' + (sac && sac.class));

// Acilis tespiti
ok(summary.opening !== null, 'acilis tespit edildi: ' + (summary.opening && summary.opening.name));

console.log(`\n${pass} gecti, ${fail} basarisiz`);
process.exit(fail ? 1 : 0);
