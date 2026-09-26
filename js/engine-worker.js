// js/engine-worker.js
// Analiz motorunu ana iş parçacığından izole eden worker.
// Protokol:
//   gelen: { t:'init' } | { t:'newgame' } | { t:'go', fen, movetime, maxDepth, id } | { t:'stop' }
//   giden: { t:'ready' } | { t:'newgame-ok' } | { t:'best', ...sonuc } | { t:'err', d }

import { searchPosition } from './engine-core.js';

let tt = null;   // tum analiz boyunca korunan transposition tablosu
let busy = false;

self.onmessage = (e) => {
  const m = e.data;
  if (!m || !m.t) return;

  if (m.t === 'init') {
    tt = new Map();
    self.postMessage({ t: 'ready' });
    return;
  }

  if (m.t === 'newgame') {
    if (tt) tt.clear();
    self.postMessage({ t: 'newgame-ok' });
    return;
  }

  if (m.t === 'go') {
    if (busy) { self.postMessage({ t: 'err', d: 'Motor mesgul' }); return; }
    busy = true;
    const movetime = Math.max(50, m.movetime || 400);
    try {
      const r = searchPosition(m.fen, { movetime, maxDepth: m.maxDepth || 22, tt });
      self.postMessage({
        t: 'best', fen: m.fen, id: m.id,
        score: r.score, mate: r.mate, best: r.best, pv: r.pv,
        depth: r.depth, nodes: r.nodes, nps: r.nps, timeMs: r.timeMs,
        legalMoves: r.legalMoves
      });
    } catch (err) {
      self.postMessage({ t: 'err', d: String((err && err.message) || err) });
    } finally {
      busy = false;
    }
    return;
  }

  if (m.t === 'stop') return;
};
