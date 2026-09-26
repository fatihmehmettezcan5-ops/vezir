// test/chess.test.mjs - kural motoru testleri (node test/chess.test.mjs)
import { Chess, Position, legalMoves, moveFromSan, moveToSan, squareName, makeMove, unmakeMove } from '../js/chess.js';

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; }
  else { fail++; console.error('  x BASARISIZ: ' + label); }
}
function eq(a, b, label) { ok(a === b, `${label} (beklenen ${b}, bulunan ${a})`); }

function perft(pos, depth) {
  if (depth === 0) return 1;
  const moves = legalMoves(pos);
  if (depth === 1) return moves.length;
  let nodes = 0;
  for (const m of moves) {
    makeMove(pos, m);
    nodes += perft(pos, depth - 1);
    unmakeMove(pos, pos.undoStack[pos.undoStack.length - 1]);
  }
  return nodes;
}

function perftFrom(fen, depth) {
  const p = new Position();
  p.loadFen(fen);
  return perft(p, depth);
}

// --- Perft testleri (standart konumlar) -------------------------------------
console.log('Perft testleri...');
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const KIWIPETE = 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1';
const POS3 = '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1';
const POS4 = 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1';
const POS5 = 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8';
const POS6 = 'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10';

eq(perftFrom(START, 1), 20, 'baslangic d1');
eq(perftFrom(START, 2), 400, 'baslangic d2');
eq(perftFrom(START, 3), 8902, 'baslangic d3');
eq(perftFrom(START, 4), 197281, 'baslangic d4');
eq(perftFrom(KIWIPETE, 1), 48, 'kiwipete d1');
eq(perftFrom(KIWIPETE, 2), 2039, 'kiwipete d2');
eq(perftFrom(KIWIPETE, 3), 97862, 'kiwipete d3');
eq(perftFrom(POS3, 1), 14, 'pos3 d1');
eq(perftFrom(POS3, 2), 191, 'pos3 d2');
eq(perftFrom(POS3, 3), 2812, 'pos3 d3');
eq(perftFrom(POS3, 4), 43238, 'pos3 d4');
eq(perftFrom(POS4, 1), 6, 'pos4 d1');
eq(perftFrom(POS4, 2), 264, 'pos4 d2');
eq(perftFrom(POS4, 3), 9467, 'pos4 d3');
eq(perftFrom(POS5, 1), 44, 'pos5 d1');
eq(perftFrom(POS5, 2), 1486, 'pos5 d2');
eq(perftFrom(POS5, 3), 62379, 'pos5 d3');
eq(perftFrom(POS6, 1), 46, 'pos6 d1');
eq(perftFrom(POS6, 2), 2079, 'pos6 d2');
eq(perftFrom(POS6, 3), 89890, 'pos6 d3');

// --- SAN uretimi -------------------------------------------------------------
console.log('SAN testleri...');
function sanOf(fen, uci) {
  const p = new Position();
  p.loadFen(fen);
  const from = (8 - Number(uci[1])) * 8 + 'abcdefgh'.indexOf(uci[0]);
  const to = (8 - Number(uci[3])) * 8 + 'abcdefgh'.indexOf(uci[2]);
  const promo = uci[4] ? { q: 5, r: 4, b: 3, n: 2 }[uci[4]] : 0;
  const m = legalMoves(p).find(m => m.from === from && m.to === to && (promo ? (m.isPromo && m.promotion === promo) : !m.isPromo));
  return moveToSan(p, m);
}
eq(sanOf(START, 'e2e4'), 'e4', 'ilk piyon hamlesi');
eq(sanOf(START, 'g1f3'), 'Nf3', 'at hamlesi');
eq(sanOf('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', 'e1g1'), 'O-O', 'kisa rok');
eq(sanOf('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', 'e1c1'), 'O-O-O', 'uzun rok');
eq(sanOf('4k3/8/8/8/8/8/8/4K3 w - - 0 1', 'e1e2'), 'Ke2', 'sah hamlesi');
eq(sanOf('rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 2', 'e4d5'), 'exd5', 'piyon alis');
eq(sanOf('8/8/8/8/8/8/8/R3K2R w KQ - 0 1', 'a1a8'), 'Ra8', 'kaleye alissiz');
eq(sanOf('4k3/8/8/8/8/8/8/R3K2R w KQ - 0 1', 'a1a8'), 'Ra8+', 'sah veren');
eq(sanOf('r3k3/8/8/8/8/8/8/R3K2R w KQq - 0 1', 'a1a8'), 'Rxa8+', 'kale alip sah veren');
eq(sanOf('8/P7/8/8/8/8/8/k6K w - - 0 1', 'a7a8q'), 'a8=Q+', 'terfi Q');
eq(sanOf('8/P7/8/8/8/8/8/k6K w - - 0 1', 'a7a8n'), 'a8=N', 'terfi N');
eq(sanOf('R7/8/8/7k/4K3/8/8/R7 w - - 0 1', 'a1a4'), 'R1a4', 'sira belirsizligi');
eq(sanOf('R7/8/8/7k/4K3/8/8/R7 w - - 0 1', 'a8a4'), 'R8a4', 'sira belirsizligi 2');
eq(sanOf('4k3/8/8/8/7K/8/8/R6R w - - 0 1', 'a1d1'), 'Rad1', 'dosya belirsizligi');
eq(sanOf('R7/8/8/8/8/8/8/R6k w - - 0 1', 'a8a2'), 'R8a2#', 'sira belirsizligi + mat');

// --- SAN ayristirma ----------------------------------------------------------
console.log('SAN ayristirma testleri...');
function parseSan(fen, san) {
  const p = new Position();
  p.loadFen(fen);
  const m = moveFromSan(p, san);
  return m ? squareName(m.from) + squareName(m.to) + (m.isPromo ? ['', 'p', 'n', 'b', 'r', 'q', 'k'][m.promotion] : '') : null;
}
eq(parseSan(START, 'e4'), 'e2e4', 'e4 ayristir');
eq(parseSan(START, 'Nf3'), 'g1f3', 'Nf3 ayristir');
eq(parseSan('4k3/8/8/8/8/8/4P3/4K3 w - - 0 1', 'e8d8'), null, 'gecersiz hamle');
eq(parseSan('8/P7/8/8/8/8/8/k6K w - - 0 1', 'a8=Q+'), 'a7a8q', 'terfi + isaretli');
eq(parseSan('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', 'O-O'), 'e1g1', 'rok ayristir');
eq(parseSan('r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1', '0-0-0'), 'e8c8', 'siyah uzun rok');
eq(parseSan('4k3/8/8/8/3pP3/8/8/4K3 b - e3 0 1', 'dxe3'), 'd4e3', 'gecerken alma ayristir');

// --- Mat / pat / oyun sonu ----------------------------------------------------
console.log('Oyun sonu testleri...');
const fool = new Chess();
['f3', 'e5', 'g4', 'Qh4'].forEach(s => fool.move(s));
ok(fool.isCheckmate(), 'fool\'s mate tespit edilmeli');
eq(fool.isGameOver().result, '0-1', 'fool\'s mate sonucu');

const stalemate = new Chess('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
ok(stalemate.isStalemate(), 'pat tespit edilmeli');

const ep = new Chess();
['e4', 'a6', 'e5', 'd5'].forEach(s => ep.move(s));
const epMove = ep.move('exd6');
ok(epMove && epMove.isEP, 'gecerken alma hamlesi yapilabilmeli');
ok(ep.fen().split(' ')[0].includes('p2P4'), 'gecerken alinan piyon kaldirilmis');

const fifty = new Chess('8/8/4k3/8/8/4K3/8/6R1 w - - 99 60');
ok(!fifty.isFiftyMoveDraw(), '99 yarim hamlede beraberlik yok');
fifty.move('Ra1');
ok(fifty.isFiftyMoveDraw(), '100 yarim hamlede beraberlik');

ok(new Chess('8/8/4k3/8/8/4K3/8/8 w - - 0 1').isInsufficientMaterial(), 'K vs K yetersiz');
ok(!new Chess('8/8/4k3/8/8/4K3/6R1/8 w - - 0 1').isInsufficientMaterial(), 'K+R vs K yeterli');

// --- Tarihce / geri alma -----------------------------------------------------
console.log('Tarihce testleri...');
const h = new Chess();
['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6'].forEach(s => h.move(s));
const hist = h.history();
eq(hist.join(' '), 'e4 e5 Nf3 Nc6 Bb5 a6', 'tarihce SAN listesi');
h.undo();
eq(h.history().length, 5, 'geri alma sonrasi hamle sayisi');

// --- FEN tur >> ----------------------------------------------------------------
const f1 = new Chess();
['d4', 'Nf6', 'c4', 'e6', 'Nc3', 'Bb4'].forEach(s => f1.move(s));
const f2 = new Chess(f1.fen());
eq(f2.fen(), f1.fen(), 'FEN tur');

console.log(`\n${pass} gecti, ${fail} basarisiz`);
process.exit(fail ? 1 : 0);
