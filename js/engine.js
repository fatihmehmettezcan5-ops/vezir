// js/engine.js
// Motor katmanı.
//
// Birincil: Stockfish 18 Lite (WASM, GPLv3) — nmrugg/stockfish.js derlemesi,
// "lite" NNUE ağı gömülü, tek iş parçacıklı (özel CORS başlığı gerektirmez).
// UCI protokolü üzerinden konuşulur.
//
// Yedek: Vezir'in kendi yazdığı motoru (engine-core.js). WASM yüklenemezse
// (çevrimdışı, eski tarayıcı, dosya eksik) uygulama çalışmaya devam eder.

import { Chess } from './chess.js';

const SF_WORKER = 'js/vendor/stockfish-18-lite-single.js';
const BUILTIN_WORKER = 'js/engine-worker.js';

export class Engine {
  constructor() {
    this.kind = null;            // 'stockfish' | 'builtin'
    this.worker = null;
    this.ready = false;
    this.failed = false;
    this.error = null;
    this.name = 'Vezir Engine';
    this.inline = false;
    this._search = null;
    this._clearTT = null;
    this._id = 0;
    this._waiters = new Map();
    this._pending = null;        // Stockfish: bekleyen arama
    this._info = null;           // Stockfish: son info satırı
    this._bootTimer = null;
  }

  init() {
    return this._initStockfish().catch((e) => {
      this.error = e && e.message ? e.message : String(e);
      return this._initBuiltin();
    });
  }

  /* ---------------- Stockfish 18 Lite (WASM) ---------------- */
  _initStockfish() {
    return new Promise((resolve, reject) => {
      let settled = false;
      const done = (fn, arg) => { if (!settled) { settled = true; clearTimeout(this._bootTimer); fn(arg); } };
      // WASM ~7 MB: yavaş bağlantılarda boot biraz sürebilir
      this._bootTimer = setTimeout(() => done(reject, new Error('Stockfish yüklenemedi (zaman aşımı)')), 45000);

      let w;
      try {
        w = new Worker(SF_WORKER);
      } catch (e) { done(reject, e); return; }
      this.worker = w;

      w.onerror = (e) => {
        try { w.terminate(); } catch (x) { /* yoksay */ }
        if (this.worker === w) this.worker = null;
        done(reject, new Error('Stockfish worker hatası'));
      };

      w.onmessage = (ev) => {
        const line = typeof ev.data === 'string' ? ev.data : (ev.data && ev.data.data) || '';
        if (!line) return;
        if (line.startsWith('uciok')) {
          // Hazır: seçenekleri sabitle ve aramayı aç
          w.postMessage('setoption name Threads value 1');
          w.postMessage('setoption name Hash value 16');
          w.postMessage('setoption name UCI_ShowWDL value false');
          w.postMessage('isready');
          return;
        }
        if (line === 'readyok') {
          this.kind = 'stockfish';
          this.ready = true;
          this.name = 'Stockfish 18 Lite';
          this.error = null;
          done(resolve);
          return;
        }
        if (line.startsWith('id name')) {
          this.name = line.slice('id name'.length).trim() || this.name;
          return;
        }
        if (line.startsWith('info')) { this._info = line; return; }
        if (line.startsWith('bestmove')) { this._onBestMove(line); return; }
      };

      w.postMessage('uci');
    });
  }

  _onBestMove(line) {
    const p = this._pending;
    this._pending = null;
    if (!p) return;
    const parts = line.split(/\s+/);
    const best = parts[1] && parts[1] !== '(none)' ? parts[1] : null;
    const info = this._info;
    this._info = null;
    const r = this._parseInfo(info, best, p.fen);
    p.resolve(r);
  }

  /* Yasal hamle sayısı: analiz "zorunlu hamle" tespiti için kullanır */
  _legalCount(fen) {
    try { return new Chess(fen).moves().length; } catch (e) { return 0; }
  }

  _parseInfo(info, best, fen) {
    const out = {
      score: null, mate: null, best, pv: [],
      depth: 0, nodes: 0, nps: 0, timeMs: 0, legalMoves: fen ? this._legalCount(fen) : 0
    };
    if (!info) return out;
    const num = (re) => { const m = info.match(re); return m ? Number(m[1]) : null; };
    out.depth = num(/ depth (\d+)/) || 0;
    out.nodes = num(/ nodes (\d+)/) || 0;
    out.nps = num(/ nps (\d+)/) || 0;
    out.timeMs = num(/ time (\d+)/) || 0;
    const mate = num(/ score mate (-?\d+)/);
    const cp = num(/ score cp (-?\d+)/);
    if (mate !== null) {
      // Stockfish "mate 0" = oynayan taraf mat edilmiş (oyun bitti)
      out.mate = mate === 0 ? 0 : mate;
      out.score = mate === 0 ? -30000 : null;
    } else if (cp !== null) {
      out.score = cp;
    }
    const pvM = info.match(/ pv (.+)$/);
    if (pvM) out.pv = pvM[1].trim().split(/\s+/).filter(Boolean);
    return out;
  }

  /* ---------------- Yerleşik motor (yedek) ---------------- */
  async _initBuiltin() {
    try {
      this.worker = new Worker(BUILTIN_WORKER, { type: 'module' });
    } catch (e) {
      return this._initInline();
    }
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (err) => { if (!settled) { settled = true; reject(err); } };
      this.worker.onmessage = (e) => {
        const m = e.data;
        if (m.t === 'ready') {
          settled = true;
          this.kind = 'builtin';
          this.ready = true;
          this.name = 'Vezir Engine';
          this.error = null;
          resolve();
          return;
        }
        if (m.t === 'best') {
          const w = this._waiters.get(m.id);
          if (w) { this._waiters.delete(m.id); w.resolve(m); }
          return;
        }
        if (m.t === 'err') {
          const w = this._waiters.get(m.id);
          if (w) { this._waiters.delete(m.id); w.reject(new Error(m.d)); }
        }
      };
      this.worker.onerror = () => {
        try { this.worker.terminate(); } catch (x) { /* yoksay */ }
        this.worker = null;
        fail(new Error('Yerleşik motor worker hatası'));
      };
      this.worker.postMessage({ t: 'init' });
    }).catch(async (e) => {
      await this._initInline();
    });
  }

  async _initInline() {
    const mod = await import('./engine-core.js');
    this._search = mod.searchPosition;
    this._clearTT = mod.clearTT;
    this.inline = true;
    this.kind = 'builtin';
    this.ready = true;
    this.name = 'Vezir Engine';
    this.error = null;
  }

  /* ---------------- Ortak arayüz ---------------- */
  newGame() {
    if (this.kind === 'stockfish' && this.worker) this.worker.postMessage('ucinewgame');
    else if (this.worker) this.worker.postMessage({ t: 'newgame' });
    else if (this._clearTT) this._clearTT();
  }

  analyze(fen, movetime = 400, maxDepth = 22) {
    const ms = Math.max(50, movetime);
    if (this.kind === 'stockfish') {
      if (!this.worker || !this.ready) return Promise.reject(new Error('Motor hazır değil'));
      if (this._pending) return Promise.reject(new Error('Motor mesgul'));
      return new Promise((resolve, reject) => {
        this._pending = { resolve, reject, fen };
        this._info = null;
        this.worker.postMessage(`position fen ${fen}`);
        this.worker.postMessage(`go movetime ${ms} depth ${Math.max(1, maxDepth)}`);
      });
    }
    if (this.inline) {
      try { return Promise.resolve(this._search(fen, { movetime: ms, maxDepth })); }
      catch (e) { return Promise.reject(e); }
    }
    if (!this.worker || !this.ready) return Promise.reject(new Error('Motor hazır değil'));
    const id = ++this._id;
    return new Promise((resolve, reject) => {
      this._waiters.set(id, { resolve, reject });
      this.worker.postMessage({ t: 'go', fen, movetime: ms, maxDepth, id });
    });
  }

  destroy() {
    if (this.worker) {
      try { if (this.kind === 'stockfish') this.worker.postMessage('quit'); } catch (e) { /* yoksay */ }
      try { this.worker.terminate(); } catch (e) { /* yoksay */ }
      this.worker = null;
    }
    this.ready = false;
    this._pending = null;
  }
}
