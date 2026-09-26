// js/engine-core.js
// ---------------------------------------------------------------------------
// Vezir analiz motoru: negamax + alfa-beta (PVS), null-move pruning,
// geç açılış azaltması (LMR), quiescence araması, transposition tablosu ve
// zaman kontrollü iterative deepening. Tamamen tarayıcıda/Node'da çalışır.
// ---------------------------------------------------------------------------

import {
  Position, generateMoves, makeMove, unmakeMove, isKingAttacked, isInCheck,
  makeNullMove, unmakeNullMove, squareName, PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING,
  WHITE, BLACK, pieceColor
} from './chess.js';
import { PIECE_VALUE, PST, PST_KING_MID, PST_KING_END, PASSED_PAWN_BONUS } from './pst.js';

export const MATE = 30000;
const INF = 40000;
const MAX_PLY = 64;
const TT_EXACT = 0, TT_LOWER = 1, TT_UPPER = 2;

// ---------------------------------------------------------------------------
// Değerlendirme
// ---------------------------------------------------------------------------

// Sifir tahsisli tamponlar (her eval cagrisinda diziyi yeniden olusturmamak icin)
const _wPawns = new Int8Array(8), _bPawns = new Int8Array(8);
const _wFiles = new Int8Array(8), _bFiles = new Int8Array(8);

export function evaluate(pos) {
  const b = pos.board;
  let score = pos.matPst;

  let nonPawn = 0;
  let bishopsW = 0, bishopsB = 0, wKing = -1, bKing = -1;
  let wPawnCount = 0, bPawnCount = 0;
  _wFiles.fill(0); _bFiles.fill(0);

  for (let i = 0; i < 64; i++) {
    const c = b[i];
    if (c === 0) continue;
    const t = c & 7;
    const white = c < 8;
    if (t === KING) { if (white) wKing = i; else bKing = i; continue; }
    if (t === PAWN) {
      if (white) { _wPawns[wPawnCount++] = i; _wFiles[i & 7]++; }
      else { _bPawns[bPawnCount++] = i; _bFiles[i & 7]++; }
      continue;
    }
    if (t === ROOK) { /* dosya bonusu asagida piyon dosyalarina gore */ }
    if (t === BISHOP) { if (white) bishopsW++; else bishopsB++; }
    nonPawn += PIECE_VALUE[t];
  }

  const endgame = nonPawn <= 1300;

  // Sah konumu (orta oyun / son oyun)
  score += PST_KING_MID[wKing] - PST_KING_MID[bKing ^ 56];
  if (endgame) {
    score += (PST_KING_END[wKing] - PST_KING_MID[wKing]) - (PST_KING_END[bKing ^ 56] - PST_KING_MID[bKing ^ 56]);
  }

  // Fil çifti
  if (bishopsW >= 2) score += 30;
  if (bishopsB >= 2) score -= 30;

  // --- Piyon yapısı ---
  const wRooks = [], bRooks = [];
  for (let i = 0; i < 64; i++) {
    const c = b[i];
    if (c === 0) continue;
    if ((c & 7) === ROOK) (c < 8 ? wRooks : bRooks).push(i);
  }

  for (let k = 0; k < wPawnCount; k++) {
    const i = _wPawns[k], f = i & 7, r = i >> 3;
    if (_wFiles[f] > 1) score -= 12;                                   // çift piyon
    if ((f > 0 ? _wFiles[f - 1] : 0) === 0 && (f < 7 ? _wFiles[f + 1] : 0) === 0) score -= 14;  // izole
    let passed = true;
    for (let j = 0; j < bPawnCount; j++) {
      const e = _bPawns[j], ef = e & 7;
      if (ef !== f && ef !== f - 1 && ef !== f + 1) continue;
      if ((e >> 3) > r) { passed = false; break; }
    }
    if (passed) score += PASSED_PAWN_BONUS[7 - r];
    const fr = r - 1;
    if (fr >= 0 && ((f > 0 && _wFiles[f - 1] > 0) || (f < 7 && _wFiles[f + 1] > 0))) score += 6;  // bağlı
  }
  for (let k = 0; k < bPawnCount; k++) {
    const i = _bPawns[k], f = i & 7, r = i >> 3;
    if (_bFiles[f] > 1) score += 12;
    if ((f > 0 ? _bFiles[f - 1] : 0) === 0 && (f < 7 ? _bFiles[f + 1] : 0) === 0) score += 14;
    let passed = true;
    for (let j = 0; j < wPawnCount; j++) {
      const e = _wPawns[j], ef = e & 7;
      if (ef !== f && ef !== f - 1 && ef !== f + 1) continue;
      if ((e >> 3) < r) { passed = false; break; }
    }
    if (passed) score -= PASSED_PAWN_BONUS[r];
    const fr = r + 1;
    if (fr < 8 && ((f > 0 && _bFiles[f - 1] > 0) || (f < 7 && _bFiles[f + 1] > 0))) score -= 6;
  }

  // --- Kale: açık / yarı açık dosya ---
  for (const i of wRooks) {
    if (_wFiles[i & 7] === 0) score += _bFiles[i & 7] === 0 ? 16 : 8;
  }
  for (const i of bRooks) {
    if (_bFiles[i & 7] === 0) score -= _wFiles[i & 7] === 0 ? 16 : 8;
  }

  // --- Şah güvenliği: piyon kalkanı (orta oyun) ---
  if (!endgame) {
    if (wKing >= 0) {
      const f = wKing & 7, r = wKing >> 3;
      let count = 0;
      const nr = r - 1;
      if (nr >= 0) {
        if (f > 0 && _wFiles[f - 1] > 0) count++;
        if (_wFiles[f] > 0) count++;
        if (f < 7 && _wFiles[f + 1] > 0) count++;
      }
      score += count * 10 - (count === 0 ? 22 : 0);
    }
    if (bKing >= 0) {
      const f = bKing & 7, r = bKing >> 3;
      let count = 0;
      const nr = r + 1;
      if (nr < 8) {
        if (f > 0 && _bFiles[f - 1] > 0) count++;
        if (_bFiles[f] > 0) count++;
        if (f < 7 && _bFiles[f + 1] > 0) count++;
      }
      score -= count * 10 - (count === 0 ? 22 : 0);
    }
  }

  return score;
}

// ---------------------------------------------------------------------------
// Yardımcılar
// ---------------------------------------------------------------------------

function moveToUci(m) {
  return squareName(m.from) + squareName(m.to) + (m.isPromo ? 'qrbn'[m.promotion - 2] : '');
}

function mirror(sq) { return sq ^ 56; }

// Beyaz acisindan hesaplanan degerlendirmeyi "hamle sirasi" acisina cevirir
function evalStm(pos) {
  const s = evaluate(pos);
  return pos.turn === WHITE ? s : -s;
}

function orderMoves(pos, moves, ttBest, killer, ply) {
  for (const m of moves) {
    let s = 0;
    if (ttBest && m.from === ttBest.from && m.to === ttBest.to && m.promotion === ttBest.promotion) {
      s = 1 << 24;
    } else if (m.isCapture) {
      s = (1 << 20) + PIECE_VALUE[m.captured & 7] * 16 - PIECE_VALUE[m.piece & 7];
    } else if (m.isPromo) {
      s = (1 << 19) + PIECE_VALUE[m.promotion];
    } else if (killer && killer.from === m.from && killer.to === m.to) {
      s = (1 << 18);
    } else {
      const t = m.piece & 7;
      const table = PST[t];
      if (table) {
        const w = pos.turn === WHITE;
        s = (table[w ? m.to : mirror(m.to)] - table[w ? m.from : mirror(m.from)]) + 64;
      }
    }
    m.orderScore = s;
  }
  moves.sort((a, b) => b.orderScore - a.orderScore);
}

// ---------------------------------------------------------------------------
// Arama
// ---------------------------------------------------------------------------

// Iki seviyeli transposition tablosu (string anahtar uretiminden cok daha hizli)
function ttGet(ctx, hi, lo) {
  const inner = ctx.tt.get(hi);
  return inner ? inner.get(lo) : undefined;
}
function ttSet(ctx, hi, lo, entry) {
  let inner = ctx.tt.get(hi);
  if (!inner) { inner = new Map(); ctx.tt.set(hi, inner); }
  inner.set(lo, entry);
  ctx.ttCount++;
  if (ctx.ttCount > 500000) { ctx.tt.clear(); ctx.ttCount = 0; }
}

export class SearchContext {
  constructor(tt) {
    this.tt = tt || new Map();   // Map<hi, Map<lo, entry>>
    this.ttCount = 0;
    this.nodes = 0;
    this.deadline = 0;
    this.aborted = false;
    this.killers = [];
    this.pvTable = [];
    this.pvLen = [];
    for (let i = 0; i < MAX_PLY + 8; i++) {
      this.pvTable.push(new Array(MAX_PLY + 8).fill(null));
      this.pvLen.push(0);
    }
  }

  checkTime() {
    if ((this.nodes & 2047) === 0 && Date.now() > this.deadline) this.aborted = true;
  }
}

function quiesce(ctx, pos, alpha, beta, ply) {
  ctx.nodes++;
  ctx.checkTime();
  if (ctx.aborted) return 0;

  const inCheck = isInCheck(pos);
  let standPat = -INF;
  if (!inCheck) {
    standPat = evalStm(pos);
    if (standPat >= beta) return standPat;
    if (standPat > alpha) alpha = standPat;
  }
  if (ply >= MAX_PLY - 4) return inCheck ? standPat : evalStm(pos);

  const moves = generateMoves(pos, !inCheck);
  if (!inCheck) orderMoves(pos, moves, null, null, ply);

  const us = pos.turn;
  let best = inCheck ? -INF : standPat;
  let legal = 0;

  for (const m of moves) {
    // delta budama (sadece normal çapta)
    if (!inCheck && !m.isPromo) {
      const gain = PIECE_VALUE[m.captured & 7];
      if (standPat + gain + 120 < alpha) continue;
    }
    makeMove(pos, m);
    if (isKingAttacked(pos, us)) { unmakeMove(pos, pos.undoStack[pos.undoStack.length - 1]); continue; }
    legal++;
    const score = -quiesce(ctx, pos, -beta, -alpha, ply + 1);
    unmakeMove(pos, pos.undoStack[pos.undoStack.length - 1]);
    if (ctx.aborted) return 0;
    if (score > best) best = score;
    if (score > alpha) alpha = score;
    if (alpha >= beta) break;
  }
  if (inCheck && legal === 0) return -MATE + ply;   // mat
  return best;
}

function negamax(ctx, pos, depth, alpha, beta, ply) {
  ctx.nodes++;
  ctx.checkTime();
  if (ctx.aborted) return 0;

  const isRoot = ply === 0;
  const hi = pos.hashHi, lo = pos.hashLo;

  // --- Transposition tablosu ---
  let ttBest = null;
  const entry = ttGet(ctx, hi, lo);
  if (entry) {
    ttBest = entry.best;
    if (!isRoot && entry.depth >= depth) {
      let score = entry.score;
      if (score >= MATE - 100) score -= ply;
      else if (score <= -(MATE - 100)) score += ply;
      if (entry.flag === TT_EXACT) return score;
      if (entry.flag === TT_LOWER && score >= beta) return score;
      if (entry.flag === TT_UPPER && score <= alpha) return score;
    }
  }

  const inCheck = isInCheck(pos);
  if (depth <= 0 && !inCheck) return quiesce(ctx, pos, alpha, beta, ply);

  // Şah uzatması
  if (inCheck) depth++;

  // --- Null-move budama ---
  if (!inCheck && !isRoot && depth >= 3 && beta < MATE - 100) {
    let hasHeavy = false;
    for (let i = 0; i < 64; i++) {
      const c = pos.board[i];
      if (c === 0) continue;
      const t = c & 7;
      if ((t === KNIGHT || t === BISHOP || t === ROOK || t === QUEEN) && pieceColor(c) === pos.turn) { hasHeavy = true; break; }
    }
    if (hasHeavy) {
      const undo = makeNullMove(pos);
      const R = depth > 6 ? 3 : 2;
      const score = -negamax(ctx, pos, depth - 1 - R, -beta, -beta + 1, ply + 1);
      unmakeNullMove(pos, undo);
      if (ctx.aborted) return 0;
      if (score >= beta && score < MATE - 100) return beta;
    }
  }

  const moves = generateMoves(pos);
  orderMoves(pos, moves, ttBest, ctx.killers[ply] && ctx.killers[ply][0], ply);

  const us = pos.turn;
  const originalAlpha = alpha;
  let bestScore = -INF, bestMove = null, legal = 0;

  for (const m of moves) {
    makeMove(pos, m);
    if (isKingAttacked(pos, us)) { unmakeMove(pos, pos.undoStack[pos.undoStack.length - 1]); continue; }
    legal++;

    let score;
    const quiet = !m.isCapture && !m.isPromo;
    const reduction = (quiet && depth >= 3 && legal >= 4 && !inCheck) ? (legal >= 8 ? 2 : 1) : 0;
    const childDepth = depth - 1 - reduction;

    if (legal === 1) {
      score = -negamax(ctx, pos, depth - 1, -beta, -alpha, ply + 1);
    } else {
      score = -negamax(ctx, pos, childDepth, -alpha - 1, -alpha, ply + 1);
      if (!ctx.aborted && score > alpha) {
        if (reduction > 0) score = -negamax(ctx, pos, depth - 1, -alpha - 1, -alpha, ply + 1);
        if (score > alpha && score < beta) score = -negamax(ctx, pos, depth - 1, -beta, -alpha, ply + 1);
      }
    }
    unmakeMove(pos, pos.undoStack[pos.undoStack.length - 1]);
    if (ctx.aborted) return 0;

    if (score > bestScore) {
      bestScore = score;
      bestMove = m;
      if (score > alpha) {
        alpha = score;
        // PV güncelle
        ctx.pvTable[ply][0] = m;
        for (let i = 0; i < ctx.pvLen[ply + 1]; i++) ctx.pvTable[ply][i + 1] = ctx.pvTable[ply + 1][i];
        ctx.pvLen[ply] = ctx.pvLen[ply + 1] + 1;
      }
    }
    if (alpha >= beta) {
      if (quiet) {
        if (!ctx.killers[ply]) ctx.killers[ply] = [];
        ctx.killers[ply][1] = ctx.killers[ply][0];
        ctx.killers[ply][0] = m;
      }
      break;
    }
  }

  if (legal === 0) return inCheck ? -MATE + ply : 0;

  // --- TT kaydet ---
  let storeScore = bestScore;
  if (storeScore >= MATE - 100) storeScore += ply;
  else if (storeScore <= -(MATE - 100)) storeScore -= ply;
  const flag = bestScore >= beta ? TT_LOWER : (bestScore > originalAlpha ? TT_EXACT : TT_UPPER);
  ttSet(ctx, hi, lo, {
    depth, score: storeScore, flag,
    best: bestMove ? { from: bestMove.from, to: bestMove.to, promotion: bestMove.promotion } : null
  });

  return bestScore;
}


// ---------------------------------------------------------------------------
// Kök arama (iterative deepening)
// ---------------------------------------------------------------------------

export function searchPosition(fen, opts = {}) {
  const movetime = opts.movetime || 500;
  const maxDepth = opts.maxDepth || 22;
  const tt = opts.tt || new Map();

  const pos = new Position();
  if (!pos.loadFen(fen)) throw new Error('Geçersiz FEN: ' + fen);

  const ctx = new SearchContext(tt);
  ctx.deadline = Date.now() + movetime;

  let best = null, bestScore = 0, bestPv = [], depthDone = 0;
  const rootMoves = generateMoves(pos);

  if (rootMoves.length === 0) {
    const check = isInCheck(pos);
    return {
      score: check ? -MATE : 0, mate: check ? 0 : null, best: null, pv: [],
      depth: 0, nodes: 0, nps: 0, timeMs: 0, legalMoves: 0
    };
  }

  for (let depth = 1; depth <= maxDepth; depth++) {
    ctx.pvLen.fill(0);
    const score = negamax(ctx, pos, depth, -INF, INF, 0);
    if (!ctx.aborted) {
      depthDone = depth;
      const m = ctx.pvTable[0][0];
      if (m) {
        best = m;
        bestScore = score;
        const pv = [];
        for (let i = 0; i < ctx.pvLen[0]; i++) pv.push(ctx.pvTable[0][i]);
        bestPv = pv;
      }
    }
    if (ctx.aborted) break;
    if (bestScore >= MATE - 100 || bestScore <= -(MATE - 100)) break;
    if (Date.now() > ctx.deadline) break;
  }

  const elapsed = Math.max(1, Date.now() - ctx.deadline + movetime);
  let mate = null, score = bestScore;
  if (bestScore >= MATE - 100) mate = MATE - bestScore;
  else if (bestScore <= -(MATE - 100)) mate = -(MATE - bestScore);
  if (bestScore >= MATE - 100 || bestScore <= -(MATE - 100)) score = null;

  return {
    score, mate, best: best ? moveToUci(best) : moveToUci(rootMoves[0]),
    pv: bestPv.map(moveToUci), depth: depthDone, nodes: ctx.nodes,
    nps: Math.round(ctx.nodes / elapsed * 1000), timeMs: elapsed,
    legalMoves: rootMoves.length
  };
}

export function clearTT(tt) { if (tt) tt.clear(); }
