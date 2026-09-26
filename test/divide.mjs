// test/divide.mjs - python-chess ile karsilastirarak perft farkini bulan araç
// Kullanim: node test/divide.mjs "<FEN>" <derinlik>
import { Position, legalMoves, makeMove, unmakeMove, moveToSan, squareName } from '../js/chess.js';
import { execFileSync } from 'node:child_process';

const fen = process.argv[2];
const depth = Number(process.argv[3] || 2);

function perft(pos, d) {
  if (d === 0) return 1;
  const moves = legalMoves(pos);
  if (d === 1) return moves.length;
  let n = 0;
  for (const m of moves) {
    makeMove(pos, m);
    n += perft(pos, d - 1);
    unmakeMove(pos, pos.undoStack[pos.undoStack.length - 1]);
  }
  return n;
}

const pos = new Position();
pos.loadFen(fen);

const script = `
import chess, json
b = chess.Board(${JSON.stringify(fen)})
out = {}
for m in b.legal_moves:
    b.push(m)
    out[m.uci()] = b.legal_moves.count()
    b.pop()
print(json.dumps(out))
`;
const ref = JSON.parse(execFileSync('python3', ['-c', script]).toString());

let total = 0;
for (const m of legalMoves(pos)) {
  const san = moveToSan(pos, m);
  makeMove(pos, m);
  const mine = legalMoves(pos).length;
  unmakeMove(pos, pos.undoStack[pos.undoStack.length - 1]);
  const uci = squareName(m.from) + squareName(m.to) + (m.isPromo ? ['', 'p', 'n', 'b', 'r', 'q', 'k'][m.promotion] : '');
  const expected = ref[uci];
  const mark = expected === mine ? '  ' : '!!';
  if (expected !== mine) {
    console.log(`${mark} ${san.padEnd(8)} ${uci}  benim=${mine}  referans=${expected}`);
  }
  total += mine;
}
console.log(`toplam=${total}`);
