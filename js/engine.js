// js/engine.js
// Ana iş parçacığındaki motor sarmalayıcısı (worker üzerinden).

export class Engine {
  constructor() {
    this.worker = null;
    this.ready = false;
    this.failed = false;
    this.error = null;
    this.inline = false;      // worker yoksa ana iş parçacığında çalış
    this._search = null;
    this._id = 0;
    this._waiters = new Map();
  }

  init() {
    return new Promise((resolve, reject) => {
      try {
        this.worker = new Worker('js/engine-worker.js', { type: 'module' });
      } catch (e) {
        this._initInline().then(resolve, () => {
          this.failed = true;
          this.error = e.message;
          reject(new Error('Worker başlatılamadı: ' + e.message));
        });
        return;
      }
      this.worker.onmessage = (e) => {
        const m = e.data;
        if (m.t === 'ready') { this.ready = true; resolve(); return; }
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
        // Worker çöktü: ana iş parçacığına düş
        if (this.worker) { try { this.worker.terminate(); } catch (e) { /* yoksay */ } }
        this.worker = null;
        this._initInline().then(resolve, reject);
      };
      this.worker.postMessage({ t: 'init' });
    });
  }

  // Worker kullanılamıyorsa motoru ana iş parçacığında çalıştır (yedek)
  async _initInline() {
    if (this.inline) return;
    try {
      const mod = await import('./engine-core.js');
      this._search = mod.searchPosition;
      this._clearTT = mod.clearTT;
      this.inline = true;
      this.ready = true;
      this.error = null;
    } catch (e) {
      this.failed = true;
      this.error = e.message;
      throw e;
    }
  }

  newGame() {
    if (this.worker) this.worker.postMessage({ t: 'newgame' });
    else if (this._clearTT) this._clearTT();
  }

  // Bir konumu analiz et; sonuç: { score, mate, best, pv, depth, nodes, nps }
  analyze(fen, movetime = 400, maxDepth = 22) {
    if (this.inline) {
      try {
        return Promise.resolve(this._search(fen, { movetime, maxDepth }));
      } catch (e) { return Promise.reject(e); }
    }
    if (!this.worker || !this.ready) return Promise.reject(new Error('Motor hazır değil'));
    const id = ++this._id;
    return new Promise((resolve, reject) => {
      this._waiters.set(id, { resolve, reject });
      this.worker.postMessage({ t: 'go', fen, movetime, maxDepth, id });
    });
  }

  destroy() {
    if (this.worker) { this.worker.terminate(); this.worker = null; }
    this.ready = false;
  }
}
