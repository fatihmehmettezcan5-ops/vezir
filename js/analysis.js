// js/analysis.js
// Oyun analizi: her hamle için motor değerlendirmesi, sınıflandırma ve doğruluk.

import { Chess, Position, moveFromUci, moveToSan, isSquareAttacked, pieceColor, pieceLetter, squareName, otherColor, WHITE, BLACK } from './chess.js';
import { PIECE_VALUE } from './pst.js';
import { detectOpening } from './openings.js';

export const MATE = 30000;

// lichess kazanma olasılığı formülü
export function winProbability(cp) {
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

export function moveAccuracy(winLossPercent) {
  const a = 103.1668 * Math.exp(-0.04354 * Math.max(0, winLossPercent)) - 3.1669;
  return Math.max(0, Math.min(100, a));
}

// Skoru (cp veya mat) kazanma olasılığına çevir (oynayan taraf açısından)
export function scoreToWinPercent(score, mate) {
  if (mate !== null && mate !== undefined) return mate > 0 ? 100 : 0;
  if (score === null || score === undefined) return 50;
  return winProbability(score);
}

export function formatScore(score, mate) {
  if (mate !== null && mate !== undefined) {
    return (mate > 0 ? '#' : '-#') + Math.abs(mate);
  }
  if (score === null || score === undefined) return '0.00';
  return (score > 0 ? '+' : '') + (score / 100).toFixed(2);
}

export const CLASSES = {
  brilliant: { label: 'Parlak', glyph: '‼', short: 'parlak', color: 'var(--cls-brilliant)' },
  best:      { label: 'En iyi', glyph: '★', short: 'en-iyi', color: 'var(--cls-best)' },
  excellent: { label: 'Mükemmel', glyph: '!', short: 'muhtesem', color: 'var(--cls-excellent)' },
  good:      { label: 'İyi', glyph: '✓', short: 'iyi', color: 'var(--cls-good)' },
  inaccuracy:{ label: 'Şüpheli', glyph: '?!', short: 'supheli', color: 'var(--cls-inaccuracy)' },
  mistake:   { label: 'Hata', glyph: '?', short: 'hata', color: 'var(--cls-mistake)' },
  blunder:   { label: 'Vahim hata', glyph: '??', short: 'vahim', color: 'var(--cls-blunder)' },
  forced:    { label: 'Zorunlu', glyph: '·', short: 'zorunlu', color: 'var(--cls-forced)' },
  mate:      { label: 'Mat', glyph: '#', short: 'mat', color: 'var(--cls-mate)' },
  book:      { label: 'Kitap', glyph: '📖', short: 'kitap', color: 'var(--cls-book)' }
};

function classify(winLoss, isBestMove, isMateMove, isBrilliant) {
  if (isMateMove) return 'mate';
  if (isBrilliant) return 'brilliant';
  if (isBestMove && winLoss < 1.5) return 'best';
  if (winLoss < 1.5) return 'best';
  if (winLoss < 4) return 'excellent';
  if (winLoss < 9) return 'good';
  if (winLoss < 16) return 'inaccuracy';
  if (winLoss < 30) return 'mistake';
  return 'blunder';
}

// Faz belirleme
function phaseOf(moveNumber, nonPawnMaterial) {
  if (moveNumber <= 10) return 'opening';
  if (moveNumber > 26 || nonPawnMaterial <= 1300) return 'endgame';
  return 'middlegame';
}

function nonPawnMaterialOf(fen) {
  const pos = new Position();
  pos.loadFen(fen);
  let total = 0;
  for (let i = 0; i < 64; i++) {
    const c = pos.board[i];
    if (!c) continue;
    const t = c & 7;
    if (t === 1 || t === 6) continue;
    total += PIECE_VALUE[t];
  }
  return total;
}

// Saldırı altında ve savunmasız taşlar (belirli renk için)
export function hangingPieces(fen, color) {
  const pos = new Position();
  if (!pos.loadFen(fen)) return [];
  const out = [];
  for (let i = 0; i < 64; i++) {
    const c = pos.board[i];
    if (!c || pieceColor(c) !== color) continue;
    if ((c & 7) === 6) continue;
    if (isSquareAttacked(pos, i, otherColor(color)) && !isSquareAttacked(pos, i, color)) {
      const value = PIECE_VALUE[c & 7];
      if (value >= 300) out.push({ square: squareName(i), piece: pieceLetter(c), value });
    }
  }
  return out;
}

// Piyon terfi teklifi olan taşlar (basit: piyonlar 6./3. şeritte)
function advancedPawns(fen, color) {
  const pos = new Position();
  if (!pos.loadFen(fen)) return [];
  const out = [];
  for (let i = 0; i < 64; i++) {
    const c = pos.board[i];
    if (!c || pieceColor(c) !== color || (c & 7) !== 1) continue;
    const rank = 8 - (i >> 3);
    if (color === WHITE ? rank >= 6 : rank <= 3) out.push(squareName(i));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Ana analiz sınıfı
// ---------------------------------------------------------------------------

export class GameAnalyzer {
  constructor(parsed, fens) {
    this.parsed = parsed;
    this.fens = fens;                 // fens[i] = i. hamle ÖNCESİ konum, fens[n] = son konum
    this.n = parsed.moves.length;
    this.results = [];                // her konum için motor sonucu
    this.moves = [];                  // her hamle için analiz
    this.done = false;
    this.aborted = false;
  }

  async run({ engine, movetime = 400, onProgress = () => {}, signal = null }) {
    const total = this.n + 1;
    for (let i = 0; i <= this.n; i++) {
      if (signal && signal.aborted) { this.aborted = true; return; }
      const fen = this.fens[i];
      let r;
      try {
        r = await engine.analyze(fen, movetime);
      } catch (e) {
        this.aborted = true;
        throw e;
      }
      this.results[i] = {
        score: r.score, mate: r.mate, best: r.best, pv: r.pv,
        depth: r.depth, nodes: r.nodes, nps: r.nps, legalMoves: r.legalMoves
      };
      if (i < this.n) {
        onProgress(i + 1, total, `Hamle ${i + 1}/${this.n} analiz ediliyor…`);
      } else {
        onProgress(total, total, 'Tamamlanıyor…');
      }
    }
    this._buildMoves();
    this.done = true;
  }

  _buildMoves() {
    const chess = new Chess(this.parsed.startFen);
    const sans = [];
    this.moves = [];
    for (let i = 0; i < this.n; i++) {
      const before = this.results[i];
      const after = this.results[i + 1];
      const mv = this.parsed.moves[i];
      const playedUci = squareName(mv.move.from) + squareName(mv.move.to) + (mv.move.isPromo ? 'qrbn'[mv.move.promotion - 2] : '');

      // SAN'a çevirme (pv ve en iyi hamle)
      const pos = new Chess(this.fens[i]);
      const bestMove = before.best ? moveFromUci(pos.pos, before.best) : null;
      const bestSan = bestMove ? moveToSan(pos.pos, bestMove) : null;
      const pvSan = [];
      const replay = new Chess(this.fens[i]);
      for (const uci of (before.pv || [])) {
        const m = moveFromUci(replay.pos, uci);
        if (!m) break;
        pvSan.push(m.san || moveToSan(replay.pos, m));
        replay.move(m.san || moveToSan(replay.pos, m));
      }

      const moverColor = mv.color;
      const scoreBefore = before.score !== null ? before.score : null;
      const mateBefore = before.mate;
      // hamle sonrası skor: rakip açısından → oynayan açısına çevir
      let scoreAfter = null, mateAfter = null;
      if (after) {
        if (after.mate !== null && after.mate !== undefined) {
          mateAfter = after.mate > 0 ? -after.mate : -after.mate;  // rakip için mat → oynayan açısından negatif
          mateAfter = -after.mate;
        } else {
          scoreAfter = -(after.score === null ? 0 : after.score);
        }
      }

      const wpBefore = scoreToWinPercent(scoreBefore, mateBefore);
      const wpAfter = scoreToWinPercent(scoreAfter, mateAfter);

      const isBestMove = bestMove ? (bestMove.from === mv.move.from && bestMove.to === mv.move.to && bestMove.promotion === mv.move.promotion) : false;
      const forced = before.legalMoves === 1;

      // Mat hamlesi mi? (oynayan taraf mat etti)
      let isMateMove = false;
      if (mateBefore !== null && mateBefore !== undefined && mateBefore > 0 && isBestMove) isMateMove = true;
      // hamle sonrası konumda rakip mat edilmişse
      if (after && after.mate !== null && after.mate !== undefined && after.mate < 0) isMateMove = true;

      // Parlak hamle: en iyi hamle + materyal feda edilmiş + sonuç hâlâ iyi
      let isBrilliant = false;
      if (isBestMove && !forced) {
        const beforeMat = materialOf(this.fens[i], moverColor);
        const afterMat = materialOf(this.fens[i + 1], moverColor);
        const sacrificed = beforeMat - afterMat;
        if (sacrificed >= 200 && wpAfter >= 40) isBrilliant = true;
      }

      // Mat bulan hamle kayıp üretmez: kazanma oranı değişmez, doğruluk tamdır.
      const winLoss = isMateMove ? 0 : Math.max(0, wpBefore - wpAfter);
      const cls = forced ? 'forced' : classify(winLoss, isBestMove, isMateMove, isBrilliant);
      const accuracy = forced ? 100 : moveAccuracy(winLoss);

      // Beyaz açısından değerlendirme (grafik için)
      const evalWhiteBefore = moverColor === 'w' ? (scoreBefore ?? 0) : -(scoreBefore ?? 0);
      const evalWhiteAfter = moverColor === 'w' ? (scoreAfter ?? 0) : -(scoreAfter ?? 0);
      const mateWhiteBefore = mateBefore !== null && mateBefore !== undefined ? (moverColor === 'w' ? mateBefore : -mateBefore) : null;

      const moveNumber = mv.moveNumber;
      const nonPawn = nonPawnMaterialOf(this.fens[i]);

      this.moves.push({
        ply: i, san: mv.san, moveNumber, color: moverColor,
        best: before.best, bestSan, pv: before.pv, pvSan,
        scoreBefore, mateBefore, scoreAfter, mateAfter,
        evalWhiteBefore, evalWhiteAfter, mateWhiteBefore,
        winLoss, class: cls, accuracy, forced, isBestMove,
        depth: before.depth, nps: before.nps,
        comment: mv.comment, nags: mv.nags,
        phase: phaseOf(moveNumber, nonPawn),
        fenBefore: this.fens[i], fenAfter: this.fens[i + 1]
      });

      chess.move(mv.san);
      sans.push(mv.san);
    }

    this.sans = sans;
    this.opening = detectOpening(sans);
  }

  // --- Özet istatistikler ----------------------------------------------------
  summary() {
    if (!this.done) return null;
    const per = { w: [], b: [] };
    const phases = { opening: { w: [], b: [] }, middlegame: { w: [], b: [] }, endgame: { w: [], b: [] } };
    const counts = { w: {}, b: {} };
    for (const m of this.moves) {
      if (m.forced) continue;
      per[m.color].push(m.accuracy);
      phases[m.phase][m.color].push(m.accuracy);
      counts[m.color][m.class] = (counts[m.color][m.class] || 0) + 1;
    }
    const avg = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 100;
    const worst = (color) => this.moves
      .filter(m => m.color === color && !m.forced && (m.class === 'blunder' || m.class === 'mistake'))
      .sort((a, b) => b.winLoss - a.winLoss)[0] || null;

    return {
      accuracy: { w: avg(per.w), b: avg(per.b) },
      phaseAccuracy: {
        opening: { w: avg(phases.opening.w), b: avg(phases.opening.b) },
        middlegame: { w: avg(phases.middlegame.w), b: avg(phases.middlegame.b) },
        endgame: { w: avg(phases.endgame.w), b: avg(phases.endgame.b) }
      },
      counts,
      blunders: { w: counts.w.blunder || 0, b: counts.b.blunder || 0 },
      mistakes: { w: counts.w.mistake || 0, b: counts.b.mistake || 0 },
      inaccuracies: { w: counts.w.inaccuracy || 0, b: counts.b.inaccuracy || 0 },
      worstWhite: worst('w'),
      worstBlack: worst('b'),
      totalMoves: this.moves.length,
      opening: this.opening
    };
  }
}

function materialOf(fen, color) {
  const pos = new Position();
  if (!pos.loadFen(fen)) return 0;
  let total = 0;
  for (let i = 0; i < 64; i++) {
    const c = pos.board[i];
    if (!c || pieceColor(c) !== color) continue;
    total += PIECE_VALUE[c & 7];
  }
  return total;
}
