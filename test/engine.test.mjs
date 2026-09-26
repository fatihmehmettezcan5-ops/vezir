// test/engine.test.mjs - arama motoru testleri
// Kullanim: node test/engine.test.mjs
import { searchPosition } from '../js/engine-core.js';
import { Position, moveFromUci, moveToSan, legalMoves, makeMove, unmakeMove } from '../js/chess.js';

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) pass++; else { fail++; console.error('  x BASARISIZ: ' + label); }
}

const MOVETIME = Number(process.env.MOVETIME || 900);

async function search(fen, movetime = MOVETIME) {
  return searchPosition(fen, { movetime, maxDepth: 24 });
}

// --- Mat bulma ---------------------------------------------------------------
console.log('Mat testleri...');

// Mat 1: Rd8#
{
  const r = await search('6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1', 700);
  const p = new Position(); p.loadFen('6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1');
  const m = moveFromUci(p, r.best);
  ok(m !== null, 'mat1 gecerli hamle');
  makeMove(p, m);
  const mate = legalMoves(p).length === 0 && require_king_attacked(p, 'b');
  ok(mate, 'Rd8# mati bulundu (' + r.best + ', skor=' + r.score + ', mate=' + r.mate + ')');
  unmakeMove(p, p.undoStack[p.undoStack.length - 1]);
}

function require_king_attacked(pos, color) {
  const k = pos.kings[color];
  return pos.kings[color] >= 0 && isAttacked(pos, k, color === 'w' ? 'b' : 'w');
}
import { isSquareAttacked as isAttacked } from '../js/chess.js';

// Mat 2 (ünlü "Légal" tarzı): Qh5 kazanır
{
  const r = await search('r2qkb1r/pp2nppp/3p4/2pNN1B1/2BnP3/3P4/PPP2PPP/R2bK2R w KQkq - 1 0', 1200);
  console.log('   Legal tarzi pozisyon en iyi:', r.best, 'skor:', r.score, 'derinlik:', r.depth, 'nps:', r.nps);
  ok(r.best === 'd5f6' || r.best === 'f6h5' || r.best === 'e1d2' || r.score > 200, 'Legal tarzi pozisyonda kazanci goruyor');
}

// --- Basit taktikler ---------------------------------------------------------
console.log('Taktik testleri...');

// Savunmasiz siyah vezir: beyaz Nxd5 ile veziri kazanmali
{
  const fen = 'rnb1kbnr/ppp1pppp/8/3q4/8/2N5/PPPPPPPP/R1BQKB1R w KQkq - 0 1';
  const r = await search(fen, 900);
  console.log('   savunmasiz vezir:', r.best, 'skor:', r.score);
  ok(r.best === 'c3d5' && r.score > 400, 'Nxd5 ile vezir kazaniliyor (' + r.best + ', ' + r.score + ')');
}

// Bacak rok: beyaz Rxd8 kazanmali
{
  const fen = '3r2k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1';
  const r = await search(fen, 900);
  console.log('   bacak rok:', r.best, 'skor:', r.score);
  ok(r.best === 'd1d8', 'Rxd8 oynanmali (' + r.best + ')');
}

// --- Hiz ---------------------------------------------------------------------
console.log('Performans...');
{
  const t0 = Date.now();
  const r = await search('r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4', 1000);
  const dt = Date.now() - t0;
  console.log(`   acilis pozisyonu: derinlik=${r.depth} dugum=${r.nodes} nps=${r.nps} sure=${dt}ms`);
  ok(r.nps > 50000, 'makul arama hizi (>50k nps): ' + r.nps);
  ok(r.depth >= 6, 'en az 6 derinlige ulasildi: ' + r.depth);
}

// --- Mat sayisi --------------------------------------------------------------
console.log('Mat sayisi testi...');
{
  // Beyaz: Qg8+ Rxg8 Nf7# tarzi klasik smothered mate oncesi
  const fen = '6rk/6pp/8/6N1/8/8/8/3R3K w - - 0 1';
  const r = await search(fen, 1200);
  console.log('   smothered oncesi:', r.best, 'mate:', r.mate, 'skor:', r.score);
  ok(r.mate !== null && r.mate > 0, 'mat serisi bulundu: ' + r.mate);
}

console.log(`\n${pass} gecti, ${fail} basarisiz`);
process.exit(fail ? 1 : 0);
