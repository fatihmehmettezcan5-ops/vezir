// test/matpst.test.mjs - artimli malzeme+PST skorunun tutarliligini dogrular
import { Position, legalMoves, makeMove, unmakeMove } from '../js/chess.js';
import { PIECE_VALUE, PST } from '../js/pst.js';

function scoreFromScratch(pos) {
  let mp = 0;
  for (let i = 0; i < 64; i++) {
    const c = pos.board[i];
    if (c === 0) continue;
    const t = c & 7;
    if (t === 6) continue;
    const idx = c < 8 ? i : (i ^ 56);
    const v = PIECE_VALUE[t] + (PST[t] ? PST[t][idx] : 0);
    mp += c < 8 ? v : -v;
  }
  return mp;
}

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
let seed = 424242;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

let checked = 0, bad = 0, captures = 0, castles = 0, eps = 0, promos = 0, undos = 0, badUndo = 0;
for (let g = 0; g < 200; g++) {
  const q = new Position();
  q.loadFen(START);
  for (let i = 0; i < 70; i++) {
    const ms = legalMoves(q);
    if (!ms.length) break;
    const m = ms[Math.floor(rnd() * ms.length)];
    if (m.captured) captures++;
    if (m.castleK || m.castleQ) castles++;
    if (m.isEP) eps++;
    if (m.isPromo) promos++;
    const before = q.matPst;
    makeMove(q, m);
    checked++;
    if (q.matPst !== scoreFromScratch(q)) {
      bad++;
      if (bad < 4) console.log('UYUSMAZLIK', q.fen(), q.matPst, scoreFromScratch(q));
    }
    // ara sira geri alma tutarliligini da kontrol et
    if (i % 7 === 3) {
      unmakeMove(q, q.undoStack[q.undoStack.length - 1]);
      undos++;
      if (q.matPst !== before) { badUndo++; console.log('GERI ALMA UYUSMAZ', q.fen()); }
      makeMove(q, m);
    }
  }
}
console.log(`kontrol: ${checked} | alis: ${captures} | rok: ${castles} | gecerken: ${eps} | terfi: ${promos} | geri-alma: ${undos} | uyusmazlik: ${bad + badUndo}`);
process.exit(bad + badUndo ? 1 : 0);
