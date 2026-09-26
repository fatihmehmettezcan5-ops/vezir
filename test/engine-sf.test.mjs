// test/engine-sf.test.mjs
// Motor katmanı: Stockfish 18 Lite (UCI) + yerleşik motor yedeği.
// Gerçek WASM burada çalıştırılamaz (tarayıcı worker'ı gerekir); bunun yerine
// UCI diyaloğu birebir simüle edilerek ayrıştırma ve protokol doğrulanır.

import { readFileSync } from 'node:fs';

const realWorker = globalThis.Worker;

/* --- Simüle edilmiş Stockfish worker'ı --- */
class FakeSfWorker {
  constructor(url) {
    this.url = url;
    this.onmessage = null;
    this.posted = [];
    this.script = [];          // { info: [...], bestmove: 'e2e4' }
    FakeSfWorker.last = this;
    queueMicrotask(() => {
      this._emit('id name Stockfish 18 Lite');
      this._emit('id author the Stockfish developers');
      this._emit('option name Threads type spin default 1 min 1 max 1');
      this._emit('uciok');
    });
  }
  _emit(line) { if (this.onmessage) this.onmessage({ data: line }); }
  /* Bir sonraki "go" komutunun vereceği yanıtı hazırla */
  reply(infoLines, bestmove) { this.script.push({ infoLines, bestmove }); return this; }
  postMessage(cmd) {
    this.posted.push(cmd);
    if (cmd === 'isready') return queueMicrotask(() => this._emit('readyok'));
    if (cmd.startsWith('position fen')) { this._fen = cmd.slice('position fen '.length); return; }
    if (cmd.startsWith('go ')) {
      const step = this.script.shift() || { infoLines: [], bestmove: '(none)' };
      step.infoLines.forEach((l, i) => setTimeout(() => this._emit(l), i * 2));
      setTimeout(() => this._emit('bestmove ' + step.bestmove), step.infoLines.length * 2 + 2);
    }
  }
  terminate() { this.terminated = true; }
}

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; } else { fail++; console.log('  x BASARISIZ: ' + m); } };

// ---- 1) WASM dosyası depoda ve geçerli ----
const wasm = readFileSync(new URL('../js/vendor/stockfish-18-lite-single.wasm', import.meta.url));
ok(wasm.length > 5_000_000, 'Stockfish 18 Lite WASM depoda: ' + (wasm.length / 1048576).toFixed(2) + ' MB');
ok(readFileSync(new URL('../js/vendor/stockfish-18-lite-single.js', import.meta.url)).toString().includes('Stockfish.js 18'),
   'yukleyici Stockfish 18 (nmrugg/stockfish.js) derlemesi');
ok(wasm.length < 8_000_000, 'lite surum ~7 MB sinirinin altinda');

// ---- 2) Motor katmanı: Stockfish yolu ----
globalThis.Worker = FakeSfWorker;
const { Engine } = await import('../js/engine.js');
const eng = new Engine();
await eng.init();
ok(eng.kind === 'stockfish', 'Stockfish birincil motor olarak yuklendi: ' + eng.kind);
ok(eng.name.includes('Stockfish 18'), 'motor adi: ' + eng.name);
ok(FakeSfWorker.last.url.endsWith('vendor/stockfish-18-lite-single.js'), 'dogru worker dosyasi: ' + FakeSfWorker.last.url);
ok(FakeSfWorker.last.posted[0] === 'uci', 'UCI el sikismasi gonderildi');

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
FakeSfWorker.last.reply([
  'info depth 1 seldepth 1 multipv 1 score cp 24 nodes 20 nps 4000 hashfull 0 time 5 pv e2e4',
  'info depth 8 seldepth 10 multipv 1 score cp 31 nodes 12345 nps 24000 hashfull 0 time 514 pv e2e4 e7e5 g1f3 b8c6',
  'info depth 12 seldepth 16 multipv 1 score mate 3 nodes 98765 nps 190000 hashfull 12 time 519 pv e2e4 e7e5 f1c4 b8c6 d1h5'
], 'e2e4 ponder e7e5');
const r = await eng.analyze(START, 500, 22);
ok(r.best === 'e2e4', 'en iyi hamle: ' + r.best);
ok(r.score === null && r.mate === 3, 'mat skoru ayristirildi: mate=' + r.mate + ' score=' + r.score);
ok(r.depth === 12, 'derinlik: ' + r.depth);
ok(r.nodes === 98765 && r.nps === 190000, 'nodes/nps: ' + r.nodes + '/' + r.nps);
ok(r.pv.length === 5 && r.pv[0] === 'e2e4', 'PV UCI formatinda: ' + r.pv.join(' '));
ok(r.legalMoves === 20, 'yasal hamle sayisi: ' + r.legalMoves);
ok(FakeSfWorker.last.posted.some(c => c === 'position fen ' + START), 'position fen gonderildi');
ok(FakeSfWorker.last.posted.some(c => c === 'go movetime 500 depth 22'), 'go movetime/depth gonderildi');

// sıradaki aramada cp skoru gelsin
FakeSfWorker.last.reply([
  'info depth 20 seldepth 24 multipv 1 score cp -145 nodes 500000 nps 250000 time 2000 pv d2d4 d7d5'
], 'd2d4 ponder d7d5');
const r2 = await eng.analyze(START, 500, 22);
ok(r2.score === -145 && r2.mate === null, 'cp skoru ayristirildi: ' + r2.score);
ok(r2.best === 'd2d4', 'ikinci arama en iyi hamle: ' + r2.best);

// oyun bitti konumu: mate 0
FakeSfWorker.last.reply(['info depth 0 score mate 0'], '(none)');
const r3 = await eng.analyze('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1', 200, 22);
ok(r3.best === null && r3.mate === 0 && r3.score === -30000, 'mat edilmis konum: best=' + r3.best + ' mate=' + r3.mate);

eng.newGame();
ok(FakeSfWorker.last.posted.includes('ucinewgame'), 'yeni oyun komutu gonderildi');

// ---- 3) Yedek: Stockfish yüklenemezse yerleşik devreye girer ----
class FailWorker { constructor() { throw new Error('WASM yok'); } postMessage() {} terminate() {} }
globalThis.Worker = FailWorker;
const eng2 = new Engine();
await eng2.init();
ok(eng2.kind === 'builtin' || eng2.inline === true, 'Stockfish olmadan yerlesik motora dustu: ' + eng2.kind);
const rb = await eng2.analyze('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 120, 6);
ok(typeof rb.best === 'string' && rb.best.length >= 4, 'yerlesik motor hamle uretiyor: ' + rb.best);
ok(typeof rb.depth === 'number' && rb.depth >= 1, 'yerlesik motor derinlik: ' + rb.depth);

console.log(`\n${pass} gecti, ${fail} basarisiz`);
globalThis.Worker = realWorker;
process.exit(fail ? 1 : 0);
