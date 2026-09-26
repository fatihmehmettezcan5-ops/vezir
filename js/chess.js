// js/chess.js
// ---------------------------------------------------------------------------
// Vezir - bağımsız satranç kural motoru (hiçbir dış bağımlılık gerektirmez).
// Tahta gösterimi: 64 karelik Int8Array, indeks 0 = a8, 63 = h1 (FEN sırası).
// Taş kodları: 0 boş, 1..6 = P,N,B,R,Q,K (beyaz), 9..14 = p,n,b,r,q,k (siyah)
// ---------------------------------------------------------------------------

import { PIECE_VALUE, PST } from './pst.js';

export const WHITE = 'w';
export const BLACK = 'b';

const EMPTY = 0, PAWN = 1, KNIGHT = 2, BISHOP = 3, ROOK = 4, QUEEN = 5, KING = 6;
export { EMPTY, PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING };
const LETTERS = { 1: 'P', 2: 'N', 3: 'B', 4: 'R', 5: 'Q', 6: 'K' };
const TYPES = { P: PAWN, N: KNIGHT, B: BISHOP, R: ROOK, Q: QUEEN, K: KING };

export const CASTLE_WK = 1, CASTLE_WQ = 2, CASTLE_BK = 4, CASTLE_BQ = 8;

export function isWhitePiece(c) { return c > 0 && c < 8; }
export function isBlackPiece(c) { return c > 8; }
export function pieceColor(c) { return c === 0 ? null : (c < 8 ? WHITE : BLACK); }
export function pieceType(c) { return c & 7; }
export function pieceLetter(c) { return c === 0 ? '' : LETTERS[c & 7]; }
export function toCode(letter, color) {
  const t = TYPES[letter.toUpperCase()];
  return color === WHITE ? t : t + 8;
}
export function otherColor(c) { return c === WHITE ? BLACK : WHITE; }


// Malzeme + PST skoru (sah haric; sah PST'si motor tarafindan fazdan bagli eklenir)
function pieceScore(code, sq) {
  const t = code & 7;
  if (t === KING) return 0;
  const table = PST[t];
  const idx = code < 8 ? sq : (sq ^ 56);
  return PIECE_VALUE[t] + (table ? table[idx] : 0);
}

const FILES = 'abcdefgh';
export function squareName(idx) { return FILES[idx & 7] + (8 - (idx >> 3)); }
export function squareIndex(name) { return (8 - Number(name[1])) * 8 + FILES.indexOf(name[0]); }

// ---------------------------------------------------------------------------
// Zobrist ozetleme (transposition tablosu icin)
// ---------------------------------------------------------------------------

const ZOB = { piece: [], castling: [], ep: [], turn: null };
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0);
  };
}
(function initZobrist() {
  const rnd = mulberry32(0x9e3779b9);
  for (let c = 0; c < 12; c++) {
    ZOB.piece.push([]);
    for (let sq = 0; sq < 64; sq++) ZOB.piece[c].push([rnd(), rnd()]);
  }
  for (let i = 0; i < 16; i++) ZOB.castling.push([rnd(), rnd()]);
  for (let i = 0; i < 9; i++) ZOB.ep.push([rnd(), rnd()]);
  ZOB.turn = [rnd(), rnd()];
})();

export function zobIndex(code) { return (code & 7) - 1 + (code < 8 ? 0 : 6); }
function epZobIdx(ep) { return ep >= 0 ? (ep & 7) + 1 : 0; }

export function computeHash(pos) {
  let hi = 0, lo = 0;
  for (let i = 0; i < 64; i++) {
    const c = pos.board[i];
    if (c === EMPTY) continue;
    const k = ZOB.piece[zobIndex(c)][i];
    hi ^= k[0]; lo ^= k[1];
  }
  const ck = ZOB.castling[pos.castling];
  const ek = ZOB.ep[epZobIdx(pos.ep)];
  hi ^= ck[0] ^ ek[0]; lo ^= ck[1] ^ ek[1];
  if (pos.turn === BLACK) { hi ^= ZOB.turn[0]; lo ^= ZOB.turn[1]; }
  pos.hashHi = hi >>> 0;
  pos.hashLo = lo >>> 0;
}

export function hashKey(pos) { return pos.hashHi.toString(36) + ':' + pos.hashLo.toString(36); }

// ---------------------------------------------------------------------------
// Konum (Position)
// ---------------------------------------------------------------------------

export class Position {
  constructor() {
    this.board = new Int8Array(64);
    this.turn = WHITE;
    this.castling = 0;       // bit alanları: WK=1 WQ=2 BK=4 BQ=8
    this.ep = -1;            // geçerken alma hedef karesi (yoksa -1)
    this.half = 0;           // 50 hamle kuralı sayacı
    this.full = 1;           // tam hamle sayacı
    this.kings = { w: -1, b: -1 };
    this.undoStack = [];
    this.hashHi = 0;
    this.hashLo = 0;
    this.matPst = 0;   // beyaz acisindan malzeme + PST toplami (sah haric)
  }

  clone() {
    const p = new Position();
    p.board.set(this.board);
    p.turn = this.turn;
    p.castling = this.castling;
    p.ep = this.ep;
    p.half = this.half;
    p.full = this.full;
    p.kings = { ...this.kings };
    p.hashHi = this.hashHi;
    p.hashLo = this.hashLo;
    p.matPst = this.matPst;
    return p;
  }

  // --- FEN ---------------------------------------------------------------
  fen() {
    let out = '';
    for (let r = 0; r < 8; r++) {
      let empty = 0;
      for (let f = 0; f < 8; f++) {
        const p = this.board[r * 8 + f];
        if (p === EMPTY) { empty++; continue; }
        if (empty) { out += empty; empty = 0; }
        const letter = LETTERS[p & 7];
        out += isWhitePiece(p) ? letter : letter.toLowerCase();
      }
      if (empty) out += empty;
      if (r < 7) out += '/';
    }
    let cast = '';
    if (this.castling & CASTLE_WK) cast += 'K';
    if (this.castling & CASTLE_WQ) cast += 'Q';
    if (this.castling & CASTLE_BK) cast += 'k';
    if (this.castling & CASTLE_BQ) cast += 'q';
    return `${out} ${this.turn} ${cast || '-'} ${this.ep >= 0 ? squareName(this.ep) : '-'} ${this.half} ${this.full}`;
  }

  loadFen(fen) {
    const parts = fen.trim().split(/\s+/);
    if (parts.length < 4) return false;
    const rows = parts[0].split('/');
    if (rows.length !== 8) return false;
    this.board.fill(EMPTY);
    this.kings = { w: -1, b: -1 };
    for (let r = 0; r < 8; r++) {
      let f = 0;
      for (const ch of rows[r]) {
        if (/[1-8]/.test(ch)) { f += Number(ch); continue; }
        if (f > 7) return false;
        const idx = r * 8 + f;
        const isUpper = ch === ch.toUpperCase();
        const type = TYPES[ch.toUpperCase()];
        if (!type) return false;
        this.board[idx] = isUpper ? type : type + 8;
        if (type === KING) this.kings[isUpper ? 'w' : 'b'] = idx;
        f++;
      }
      if (f !== 8) return false;
    }
    this.turn = parts[1] === 'b' ? BLACK : WHITE;
    this.castling = 0;
    if (parts[2].includes('K')) this.castling |= CASTLE_WK;
    if (parts[2].includes('Q')) this.castling |= CASTLE_WQ;
    if (parts[2].includes('k')) this.castling |= CASTLE_BK;
    if (parts[2].includes('q')) this.castling |= CASTLE_BQ;
    this.ep = parts[3] === '-' ? -1 : squareIndex(parts[3]);
    this.half = Number(parts[4] || 0);
    this.full = Number(parts[5] || 1);
    if (this.kings.w < 0 || this.kings.b < 0) return false;
    let mp = 0;
    for (let i = 0; i < 64; i++) {
      const c = this.board[i];
      if (c === EMPTY) continue;
      mp += isWhitePiece(c) ? pieceScore(c, i) : -pieceScore(c, i);
    }
    this.matPst = mp;
    computeHash(this);
    return true;
  }
}

// ---------------------------------------------------------------------------
// Saldırı tespiti
// ---------------------------------------------------------------------------

const KNIGHT_OFFSETS = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
const KING_OFFSETS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
const ROOK_OFFSETS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const BISHOP_OFFSETS = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

function onBoard(f, r) { return f >= 0 && f < 8 && r >= 0 && r < 8; }

export function isSquareAttacked(pos, idx, byColor) {
  const b = pos.board;
  const f = idx & 7, r = idx >> 3;
  const own = (c) => (byColor === WHITE ? isWhitePiece(c) : isBlackPiece(c));
  const isEnemyPawn = (c) => (byColor === WHITE ? c === PAWN : c === PAWN + 8);

  // Piyonlar: byColor beyazsa beyaz piyonlar yukarı (r azalır) hamle yapar,
  // yani idx karesine (f±1, r+1) konumundaki beyaz piyonlar saldırır.
  const pr = byColor === WHITE ? r + 1 : r - 1;
  for (const df of [-1, 1]) {
    if (!onBoard(f + df, pr)) continue;
    if (isEnemyPawn(b[pr * 8 + f + df])) return true;
  }

  // Atlar
  for (const [df, dr] of KNIGHT_OFFSETS) {
    const nf = f + df, nr = r + dr;
    if (!onBoard(nf, nr)) continue;
    const p = b[nr * 8 + nf];
    if (p !== EMPTY && own(p) && (p & 7) === KNIGHT) return true;
  }

  // Şah
  for (const [df, dr] of KING_OFFSETS) {
    const nf = f + df, nr = r + dr;
    if (!onBoard(nf, nr)) continue;
    const p = b[nr * 8 + nf];
    if (p !== EMPTY && own(p) && (p & 7) === KING) return true;
  }

  // Kayar taşlar
  for (const [df, dr] of ROOK_OFFSETS) {
    let nf = f + df, nr = r + dr;
    while (onBoard(nf, nr)) {
      const p = b[nr * 8 + nf];
      if (p !== EMPTY) {
        if (own(p)) {
          const t = p & 7;
          if (t === ROOK || t === QUEEN) return true;
        }
        break;
      }
      nf += df; nr += dr;
    }
  }
  for (const [df, dr] of BISHOP_OFFSETS) {
    let nf = f + df, nr = r + dr;
    while (onBoard(nf, nr)) {
      const p = b[nr * 8 + nf];
      if (p !== EMPTY) {
        if (own(p)) {
          const t = p & 7;
          if (t === BISHOP || t === QUEEN) return true;
        }
        break;
      }
      nf += df; nr += dr;
    }
  }
  return false;
}

export function isKingAttacked(pos, color) {
  const k = pos.kings[color];
  return k >= 0 && isSquareAttacked(pos, k, otherColor(color));
}

// ---------------------------------------------------------------------------
// Hamle üretimi
// ---------------------------------------------------------------------------

function mkMove(from, to, piece, captured, extra = {}) {
  return {
    from, to, piece, captured: captured || 0, promotion: 0,
    isCapture: !!captured, isDouble: false, isEP: false, isPromo: false,
    castleK: false, castleQ: false, san: null, ...extra
  };
}

function addPawnMove(list, pos, from, to, captured, promoRank, extra = {}) {
  const piece = pos.board[from];
  if ((to >> 3) === promoRank) {
    for (const promo of [QUEEN, ROOK, BISHOP, KNIGHT]) {
      list.push(mkMove(from, to, piece, captured, { ...extra, isPromo: true, promotion: promo }));
    }
  } else {
    list.push(mkMove(from, to, piece, captured, extra));
  }
}

export function generateMoves(pos, capturesOnly = false) {
  const b = pos.board;
  const us = pos.turn;
  const dir = us === WHITE ? -1 : 1;
  const startRank = us === WHITE ? 6 : 1;
  const promoRank = us === WHITE ? 0 : 7;
  const enemyPawn = us === WHITE ? PAWN + 8 : PAWN;
  const moves = [];
  const own = (c) => (us === WHITE ? isWhitePiece(c) : isBlackPiece(c));
  const enemy = (c) => (us === WHITE ? isBlackPiece(c) : isWhitePiece(c));

  for (let idx = 0; idx < 64; idx++) {
    const p = b[idx];
    if (p === EMPTY || !own(p)) continue;
    const type = p & 7;
    const f = idx & 7, r = idx >> 3;

    if (type === PAWN) {
      const one = idx + dir * 8;
      if (!capturesOnly && onBoard(f, r + dir) && b[one] === EMPTY) {
        addPawnMove(moves, pos, idx, one, 0, promoRank);
        if (r === startRank) {
          const two = idx + dir * 16;
          if (b[two] === EMPTY) moves.push(mkMove(idx, two, p, 0, { isDouble: true }));
        }
      }
      for (const df of [-1, 1]) {
        const nf = f + df, nr = r + dir;
        if (!onBoard(nf, nr)) continue;
        const to = nr * 8 + nf;
        if (enemy(b[to])) addPawnMove(moves, pos, idx, to, b[to], promoRank, { isCapture: true });
        else if (to === pos.ep) moves.push(mkMove(idx, to, p, enemyPawn, { isCapture: true, isEP: true }));
      }
      continue;
    }

    if (type === KNIGHT || type === KING) {
      const offsets = type === KNIGHT ? KNIGHT_OFFSETS : KING_OFFSETS;
      for (const [df, dr] of offsets) {
        const nf = f + df, nr = r + dr;
        if (!onBoard(nf, nr)) continue;
        const to = nr * 8 + nf;
        const tp = b[to];
        if (tp !== EMPTY) {
          if (enemy(tp)) moves.push(mkMove(idx, to, p, tp, { isCapture: true }));
        } else if (!capturesOnly) {
          moves.push(mkMove(idx, to, p, 0));
        }
      }
      if (type === KING && !capturesOnly) {
        const home = us === WHITE ? 60 : 4;   // e1 / e8
        const rights = us === WHITE ? (CASTLE_WK | CASTLE_WQ) : (CASTLE_BK | CASTLE_BQ);
        if (idx === home && (pos.castling & rights)) {
          const them = otherColor(us);
          const kingSafe = !isSquareAttacked(pos, idx, them);
          // Renk göre kareler: h1/f1/g1 (beyaz) - h8/f8/g8 (siyah)
          const rfK = us === WHITE ? 63 : 7, tfK = us === WHITE ? 61 : 5, gfK = us === WHITE ? 62 : 6;
          if (pos.castling & (us === WHITE ? CASTLE_WK : CASTLE_BK)) {
            if (b[tfK] === EMPTY && b[gfK] === EMPTY && b[rfK] !== EMPTY &&
                (b[rfK] & 7) === ROOK && own(b[rfK]) &&
                kingSafe && !isSquareAttacked(pos, tfK, them) && !isSquareAttacked(pos, gfK, them)) {
              moves.push(mkMove(idx, gfK, p, 0, { castleK: true }));
            }
          }
          // Renk göre kareler: a1/d1/c1/b1 (beyaz) - a8/d8/c8/b8 (siyah)
          const rfQ = us === WHITE ? 56 : 0, dfQ = us === WHITE ? 59 : 3, cfQ = us === WHITE ? 58 : 2, bfQ = us === WHITE ? 57 : 1;
          if (pos.castling & (us === WHITE ? CASTLE_WQ : CASTLE_BQ)) {
            if (b[dfQ] === EMPTY && b[cfQ] === EMPTY && b[bfQ] === EMPTY && b[rfQ] !== EMPTY &&
                (b[rfQ] & 7) === ROOK && own(b[rfQ]) &&
                kingSafe && !isSquareAttacked(pos, dfQ, them) && !isSquareAttacked(pos, cfQ, them)) {
              moves.push(mkMove(idx, cfQ, p, 0, { castleQ: true }));
            }
          }
        }
      }
      continue;
    }

    // Kayar taşlar
    const offsets = type === ROOK ? ROOK_OFFSETS : type === BISHOP ? BISHOP_OFFSETS : [...ROOK_OFFSETS, ...BISHOP_OFFSETS];
    for (const [df, dr] of offsets) {
      let nf = f + df, nr = r + dr;
      while (onBoard(nf, nr)) {
        const to = nr * 8 + nf;
        const tp = b[to];
        if (tp === EMPTY) {
          if (!capturesOnly) moves.push(mkMove(idx, to, p, 0));
        } else {
          if (enemy(tp)) moves.push(mkMove(idx, to, p, tp, { isCapture: true }));
          break;
        }
        nf += df; nr += dr;
      }
    }
  }
  return moves;
}

// ---------------------------------------------------------------------------
// Hamle yap / geri al
// ---------------------------------------------------------------------------

export function makeMove(pos, m) {
  const b = pos.board;
  const us = pos.turn;
  const oldCastling = pos.castling;
  const oldEp = pos.ep;
  const undo = {
    move: m, castling: oldCastling, ep: oldEp, half: pos.half, full: pos.full,
    kings: { ...pos.kings }, capturedIdx: -1, hashHi: pos.hashHi, hashLo: pos.hashLo,
    matPst: pos.matPst
  };
  const from = m.from, to = m.to, piece = m.piece;
  const placed = m.isPromo ? (us === WHITE ? m.promotion : m.promotion + 8) : piece;

  if (m.isEP) {
    const capIdx = to + (us === WHITE ? 8 : -8);
    undo.capturedIdx = capIdx;
    b[capIdx] = EMPTY;
  } else if (m.captured) {
    undo.capturedIdx = to;
  }

  b[from] = EMPTY;
  b[to] = m.isPromo ? (us === WHITE ? m.promotion : m.promotion + 8) : piece;

  if (m.castleK) {
    const rookFrom = us === WHITE ? 63 : 7, rookTo = us === WHITE ? 61 : 5;
    b[rookTo] = b[rookFrom];
    b[rookFrom] = EMPTY;
  } else if (m.castleQ) {
    const rookFrom = us === WHITE ? 56 : 0, rookTo = us === WHITE ? 59 : 3;
    b[rookTo] = b[rookFrom];
    b[rookFrom] = EMPTY;
  }

  // Rok hakları
  if ((piece & 7) === KING) pos.castling &= us === WHITE ? ~(CASTLE_WK | CASTLE_WQ) : ~(CASTLE_BK | CASTLE_BQ);
  for (const [sq, bit] of [[63, CASTLE_WK], [56, CASTLE_WQ], [7, CASTLE_BK], [0, CASTLE_BQ]]) {
    if (from === sq || to === sq) pos.castling &= ~bit;
  }

  pos.ep = m.isDouble ? (from + to) / 2 : -1;
  pos.half = ((piece & 7) === PAWN || m.captured) ? 0 : pos.half + 1;
  if (us === BLACK) pos.full++;
  pos.turn = otherColor(us);
  if ((piece & 7) === KING) pos.kings[us] = to;

  // --- Artimli malzeme + PST skoru ---
  // Not: alinan tas RAKIBE aittir, bu yuzden isaret -sign olur.
  {
    const sign = us === WHITE ? 1 : -1;
    let mp = pos.matPst;
    mp -= sign * pieceScore(piece, from);
    if (m.isEP) {
      const enemyPawn = us === WHITE ? PAWN + 8 : PAWN;
      mp += sign * pieceScore(enemyPawn, undo.capturedIdx);
    } else if (m.captured) {
      mp += sign * pieceScore(m.captured, to);
    }
    mp += sign * pieceScore(placed, to);
    if (m.castleK || m.castleQ) {
      const rook = us === WHITE ? ROOK : ROOK + 8;
      const rf = m.castleK ? (us === WHITE ? 63 : 7) : (us === WHITE ? 56 : 0);
      const rt = m.castleK ? (us === WHITE ? 61 : 5) : (us === WHITE ? 59 : 3);
      mp -= sign * pieceScore(rook, rf);
      mp += sign * pieceScore(rook, rt);
    }
    pos.matPst = mp;
  }

  // --- Zobrist ozetini artimli guncelle ---
  let hi = undo.hashHi, lo = undo.hashLo;
  const xor = (arr) => { hi ^= arr[0]; lo ^= arr[1]; };
  xor(ZOB.piece[zobIndex(piece)][from]);
  if (m.isEP) {
    const enemyPawn = us === WHITE ? PAWN + 8 : PAWN;
    xor(ZOB.piece[zobIndex(enemyPawn)][undo.capturedIdx]);
  } else if (m.captured) {
    xor(ZOB.piece[zobIndex(m.captured)][to]);
  }
  xor(ZOB.piece[zobIndex(placed)][to]);
  if (m.castleK || m.castleQ) {
    const rook = us === WHITE ? ROOK : ROOK + 8;
    const rf = m.castleK ? (us === WHITE ? 63 : 7) : (us === WHITE ? 56 : 0);
    const rt = m.castleK ? (us === WHITE ? 61 : 5) : (us === WHITE ? 59 : 3);
    xor(ZOB.piece[zobIndex(rook)][rf]);
    xor(ZOB.piece[zobIndex(rook)][rt]);
  }
  xor(ZOB.castling[oldCastling]);
  xor(ZOB.castling[pos.castling]);
  xor(ZOB.ep[epZobIdx(oldEp)]);
  xor(ZOB.ep[epZobIdx(pos.ep)]);
  xor(ZOB.turn);
  pos.hashHi = hi >>> 0;
  pos.hashLo = lo >>> 0;

  pos.undoStack.push(undo);
  return undo;
}

// Null hamle (arama icin): sadece sirayi ve gecerken alma karesini degistirir
export function makeNullMove(pos) {
  const undo = { ep: pos.ep, hashHi: pos.hashHi, hashLo: pos.hashLo };
  let hi = pos.hashHi, lo = pos.hashLo;
  const xor = (arr) => { hi ^= arr[0]; lo ^= arr[1]; };
  xor(ZOB.ep[epZobIdx(pos.ep)]);
  xor(ZOB.ep[0]);
  xor(ZOB.turn);
  pos.ep = -1;
  pos.turn = otherColor(pos.turn);
  pos.hashHi = hi >>> 0;
  pos.hashLo = lo >>> 0;
  return undo;
}

export function unmakeNullMove(pos, undo) {
  pos.turn = otherColor(pos.turn);
  pos.ep = undo.ep;
  pos.hashHi = undo.hashHi;
  pos.hashLo = undo.hashLo;
}

export function unmakeMove(pos, undo) {
  const m = undo.move;
  const b = pos.board;
  const us = otherColor(pos.turn); // hamleyi yapan taraf
  const from = m.from, to = m.to;

  b[from] = m.piece;
  b[to] = EMPTY;
  // Alınan taşı geri koy (terfi hamlelerinde de geçerli: capturedIdx === to)
  if (undo.capturedIdx >= 0) b[undo.capturedIdx] = m.captured;
  if (m.castleK) {
    const rookFrom = us === WHITE ? 63 : 7, rookTo = us === WHITE ? 61 : 5;
    b[rookFrom] = b[rookTo];
    b[rookTo] = EMPTY;
  } else if (m.castleQ) {
    const rookFrom = us === WHITE ? 56 : 0, rookTo = us === WHITE ? 59 : 3;
    b[rookFrom] = b[rookTo];
    b[rookTo] = EMPTY;
  }

  pos.turn = us;
  pos.castling = undo.castling;
  pos.ep = undo.ep;
  pos.half = undo.half;
  pos.full = undo.full;
  pos.kings = { ...undo.kings };
  pos.hashHi = undo.hashHi;
  pos.hashLo = undo.hashLo;
  pos.matPst = undo.matPst;
  pos.undoStack.pop();
}

export function legalMoves(pos) {
  const pseudo = generateMoves(pos);
  const us = pos.turn;
  const out = [];
  for (const m of pseudo) {
    makeMove(pos, m);
    if (!isKingAttacked(pos, us)) out.push(m);
    unmakeMove(pos, pos.undoStack[pos.undoStack.length - 1]);
  }
  return out;
}

export function isInCheck(pos) { return isKingAttacked(pos, pos.turn); }

export function hasNoLegalMoves(pos) {
  const pseudo = generateMoves(pos);
  const us = pos.turn;
  for (const m of pseudo) {
    makeMove(pos, m);
    const safe = !isKingAttacked(pos, us);
    unmakeMove(pos, pos.undoStack[pos.undoStack.length - 1]);
    if (safe) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// SAN (standart cebirsel gösterim)
// ---------------------------------------------------------------------------

function sanCheckSuffix(pos, m) {
  makeMove(pos, m);
  let suffix = '';
  if (isKingAttacked(pos, pos.turn)) suffix = hasNoLegalMoves(pos) ? '#' : '+';
  unmakeMove(pos, pos.undoStack[pos.undoStack.length - 1]);
  return suffix;
}

export function moveToSan(pos, m) {
  if (m.san) return m.san;
  let san;
  if (m.castleK) san = 'O-O';
  else if (m.castleQ) san = 'O-O-O';
  else {
    const type = m.piece & 7;
    if (type === PAWN) {
      san = m.isCapture ? `${FILES[m.from & 7]}x${squareName(m.to)}` : squareName(m.to);
      if (m.isPromo) san += '=' + LETTERS[m.promotion];
    } else {
      const others = generateMoves(pos).filter(o =>
        o.to === m.to && (o.piece & 7) === type && o.from !== m.from);
      let disamb = '';
      if (others.length) {
        const sameFile = others.some(o => (o.from & 7) === (m.from & 7));
        const sameRank = others.some(o => (o.from >> 3) === (m.from >> 3));
        if (!sameFile) disamb = FILES[m.from & 7];
        else if (!sameRank) disamb = String(8 - (m.from >> 3));
        else disamb = squareName(m.from);
      }
      san = LETTERS[type] + disamb + (m.isCapture ? 'x' : '') + squareName(m.to);
    }
  }
  return san + sanCheckSuffix(pos, m);
}

const SAN_RE = /^([KQRBN])?([a-h])?([1-8])?(x)?([a-h][1-8])(?:=?([QRBN]))?$/;

export function moveFromSan(pos, san) {
  let s = san.trim().replace(/[!?]+$/, '').replace(/[+#]+$/, '').replace(/e\.p\.?$/, '').replace(/^\.\.\./, '').trim();
  if (/^(0-0-0|O-O-O|o-o-o)$/.test(s)) s = 'O-O-O';
  else if (/^(0-1|O-O|o-o)$/.test(s)) s = 'O-O';
  const moves = legalMoves(pos);
  if (s === 'O-O') {
    const m = moves.find(m => m.castleK);
    if (m) { m.san = moveToSan(pos, m); return m; }
    return null;
  }
  if (s === 'O-O-O') {
    const m = moves.find(m => m.castleQ);
    if (m) { m.san = moveToSan(pos, m); return m; }
    return null;
  }
  const match = s.match(SAN_RE);
  if (!match) return null;
  const [, pieceLetter, fromFile, fromRank, , target, promo] = match;
  const type = pieceLetter ? TYPES[pieceLetter] : PAWN;
  const to = squareIndex(target);
  const candidates = moves.filter(m => {
    if (m.to !== to) return false;
    if ((m.piece & 7) !== type) return false;
    if (promo) { if (!m.isPromo || m.promotion !== TYPES[promo]) return false; }
    else if (m.isPromo) return false;
    if (fromFile && FILES[m.from & 7] !== fromFile) return false;
    if (fromRank && String(8 - (m.from >> 3)) !== fromRank) return false;
    return true;
  });
  if (!candidates.length) return null;
  const m = candidates[0];
  m.san = moveToSan(pos, m);
  return m;
}

export function moveFromUci(pos, uci) {
  const from = squareIndex(uci.slice(0, 2));
  const to = squareIndex(uci.slice(2, 4));
  const promo = uci.length > 4 ? TYPES[uci[4].toUpperCase()] : 0;
  const moves = legalMoves(pos);
  const m = moves.find(m => m.from === from && m.to === to && (promo ? (m.isPromo && m.promotion === promo) : !m.isPromo));
  if (!m) return null;
  m.san = moveToSan(pos, m);
  return m;
}

// ---------------------------------------------------------------------------
// Oyun sonu / yardımcılar
// ---------------------------------------------------------------------------

export function insufficientMaterial(pos) {
  const minors = [];
  for (let i = 0; i < 64; i++) {
    const p = pos.board[i];
    if (p === EMPTY) continue;
    const t = p & 7;
    if (t === PAWN || t === ROOK || t === QUEEN) return false;
    if (t === KNIGHT || t === BISHOP) minors.push({ color: pieceColor(p), type: t, sq: i });
  }
  if (minors.length === 0) return true;                       // K vs K
  if (minors.length === 1) return true;                       // K+minor vs K
  if (minors.length === 2 && minors[0].type === BISHOP && minors[1].type === BISHOP &&
      minors[0].color !== minors[1].color) {
    const color = (i) => (((i >> 3) + (i & 7)) % 2);          // 0 = koyu kare
    return color(minors[0].sq) === color(minors[1].sq);       // aynı renk filller
  }
  return false;
}

export function positionKey(pos) {
  const parts = pos.fen().split(' ');
  return parts.slice(0, 4).join(' ');
}

// ---------------------------------------------------------------------------
// Chess sarmalayıcı sınıf (uygulama arayüzü)
// ---------------------------------------------------------------------------

export class Chess {
  constructor(fen) {
    this.pos = new Position();
    if (fen) this.pos.loadFen(fen);
    else this.pos.loadFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
    this._keys = [positionKey(this.pos)];
  }

  static START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

  reset() {
    this.pos.loadFen(Chess.START_FEN);
    this._keys = [positionKey(this.pos)];
  }

  load(fen) {
    const p = new Position();
    if (!p.loadFen(fen)) return false;
    this.pos = p;
    this._keys = [positionKey(p)];
    return true;
  }

  fen() { return this.pos.fen(); }
  turn() { return this.pos.turn; }
  moveNumber() { return this.pos.full; }
  inCheck() { return isInCheck(this.pos); }

  moves(opts = {}) {
    const list = legalMoves(this.pos);
    if (opts.square !== undefined) {
      const sq = typeof opts.square === 'string' ? squareIndex(opts.square) : opts.square;
      return list.filter(m => m.from === sq);
    }
    if (opts.verbose) return list;
    return list.map(m => moveToSan(this.pos, m));
  }

  get(square) {
    const idx = typeof square === 'string' ? squareIndex(square) : square;
    const p = this.pos.board[idx];
    if (p === EMPTY) return null;
    return { color: pieceColor(p), type: pieceLetter(p) };
  }

  // san: "e4", "Nf3", {from:'e2', to:'e4', promotion:'q'}
  move(san) {
    let m = null;
    if (typeof san === 'string') m = moveFromSan(this.pos, san);
    else if (san && typeof san === 'object') {
      const from = squareIndex(san.from);
      const to = squareIndex(san.to);
      const promo = san.promotion ? TYPES[san.promotion.toUpperCase()] : 0;
      m = legalMoves(this.pos).find(mm => mm.from === from && mm.to === to &&
        (promo ? (mm.isPromo && mm.promotion === promo) : !mm.isPromo)) || null;
      if (m) m.san = moveToSan(this.pos, m);
    }
    if (!m) return null;
    makeMove(this.pos, m);
    this._keys.push(positionKey(this.pos));
    return m;
  }

  undo() {
    const u = this.pos.undoStack[this.pos.undoStack.length - 1];
    if (!u) return null;
    unmakeMove(this.pos, u);
    this._keys.pop();
    return u.move;
  }

  history(opts = {}) {
    // Mevcut hamleleri SAN olarak döndür (geçici tahta üzerinde yeniden oynanır)
    const moves = [];
    const p = this.pos;
    const stack = p.undoStack.slice();
    const startFen = this._keys[0] + ' 0 1';
    const replay = new Position();
    replay.loadFen(startFen);
    for (const u of stack) {
      const m = u.move;
      m.san = null;
      moves.push(opts.verbose ? { ...m, san: moveToSan(replay, m) } : moveToSan(replay, m));
      makeMove(replay, m);
    }
    return moves;
  }

  isCheckmate() { return isInCheck(this.pos) && hasNoLegalMoves(this.pos); }
  isStalemate() { return !isInCheck(this.pos) && hasNoLegalMoves(this.pos); }
  isInsufficientMaterial() { return insufficientMaterial(this.pos); }
  isFiftyMoveDraw() { return this.pos.half >= 100; }
  isThreefold() {
    const key = this._keys[this._keys.length - 1];
    return this._keys.filter(k => k === key).length >= 3;
  }

  isGameOver() {
    if (this.isCheckmate()) return { over: true, result: this.turn() === WHITE ? '0-1' : '1-0', reason: 'checkmate' };
    if (this.isStalemate()) return { over: true, result: '1/2-1/2', reason: 'stalemate' };
    if (this.isInsufficientMaterial()) return { over: true, result: '1/2-1/2', reason: 'insufficient material' };
    if (this.isFiftyMoveDraw()) return { over: true, result: '1/2-1/2', reason: 'fifty-move rule' };
    if (this.isThreefold()) return { over: true, result: '1/2-1/2', reason: 'threefold repetition' };
    return { over: false };
  }
}

export function positionAtFen(fen) {
  const p = new Position();
  p.loadFen(fen);
  return p;
}
