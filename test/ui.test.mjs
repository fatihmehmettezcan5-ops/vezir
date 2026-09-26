// test/ui.test.mjs
// Tam arayüz akışı: jsdom + gerçek motor ile giriş -> analiz -> tahta.
import { readFileSync } from 'node:fs';
let JSDOM = null;
try {
  ({ JSDOM } = await import('jsdom'));
} catch (e) {
  console.log('[ui.test] jsdom kurulu degil - bu test atlandi. Kurmak icin: npm install');
  process.exit(0);
}
import { searchPosition, clearTT } from '../js/engine-core.js';
import { sampleGames } from '../js/pgn.js';

let pass = 0, fail = 0;
function ok(cond, label) { if (cond) pass++; else { fail++; console.error('  x BASARISIZ: ' + label); } }

// ---- Worker taklidi (jsdom Worker desteklemez) ----
class FakeWorker {
  constructor() { this.onmessage = null; this.onerror = null; }
  postMessage(msg) {
    if (msg.t === 'init') { queueMicrotask(() => this.onmessage({ data: { t: 'ready' } })); return; }
    if (msg.t === 'newgame') { clearTT(); return; }
    if (msg.t === 'go') {
      let r;
      try { r = searchPosition(msg.fen, { movetime: msg.movetime, maxDepth: 22 }); }
      catch (e) { queueMicrotask(() => this.onerror({ message: e.message })); return; }
      queueMicrotask(() => this.onmessage({ data: { t: 'best', id: msg.id, ...r } }));
    }
  }
  terminate() {}
}

// ---- DOM ortamı ----
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const dom = new JSDOM(html, { url: 'http://localhost:8080/index.html', pretendToBeVisual: true });
const { window } = dom;

globalThis.window = window;
globalThis.document = window.document;
globalThis.location = window.location;
globalThis.localStorage = window.localStorage;
globalThis.navigator = window.navigator;
globalThis.Worker = FakeWorker;
globalThis.URL.createObjectURL = () => 'blob:fake';
globalThis.URL.revokeObjectURL = () => {};
if (!globalThis.FileReader) globalThis.FileReader = window.FileReader;
window.HTMLElement.prototype.scrollIntoView = function () {};
window.Element.prototype.getBoundingClientRect = () => ({ left: 0, top: 0, width: 860, height: 860, right: 860, bottom: 860 });

const $ = (id) => window.document.getElementById(id);

// ---- Uygulamayı yükle ----
await import('../js/app.js');
window.document.dispatchEvent(new window.Event('DOMContentLoaded', { bubbles: true }));
await new Promise(r => setTimeout(r, 60));

ok($('engineStatus').textContent === 'Motor hazır', 'motor hazir: ' + $('engineStatus').textContent);
ok($('importView').hidden === false, 'giris ekrani acik');
ok($('reviewView').hidden === true, 'analiz ekrani gizli');
ok($('sampleList').children.length === 5, '5 ornek oyun listelendi: ' + $('sampleList').children.length);

// ---- Oyun yükle ----
const game = sampleGames().find(g => g.id === 'opera');
$('pgnInput').value = game.pgn;
$('loadPgnBtn').click();
await new Promise(r => setTimeout(r, 60));

ok($('importView').hidden === true, 'giris ekrani kapandi');
ok($('reviewView').hidden === false, 'analiz ekrani acik');
ok($('whiteName').textContent.includes('Morphy'), 'beyaz oyuncu adi: ' + $('whiteName').textContent);
ok($('resultLabel').textContent.length > 3, 'sonuc etiketi: ' + $('resultLabel').textContent);
ok($('moveList').children.length > 10, 'hamle listesi dolu: ' + $('moveList').children.length + ' satir');
ok($('board').querySelectorAll('.piece').length === 32, 'baslangicta 32 tas: ' + $('board').querySelectorAll('.piece').length);
ok($('board').querySelector('.sq[data-sq="e1"]') !== null, 'e1 karesi var');

// ---- Analiz ----
$('analyzeBtn').click();
const t0 = Date.now();
while (!$('progressWrap').hidden && Date.now() - t0 < 120000) {
  await new Promise(r => setTimeout(r, 250));
  if ($('abortBtn').hidden && $('analyzeBtn').disabled === false && $('summaryPane').children.length) break;
}
ok($('analyzeBtn').disabled === false, 'analiz dugmesi tekrar aktif');
ok($('summaryPane').textContent.includes('Doğruluk'), 'ozet paneli dolduruldu');
ok($('whiteAcc').textContent.includes('%'), 'beyaz dogrulugu gosterildi: ' + $('whiteAcc').textContent);
ok($('blackAcc').textContent.includes('%'), 'siyah dogrulugu gosterildi');
ok($('coachPane').textContent.length > 200, 'koc notlari dolduruldu (' + $('coachPane').textContent.length + ' karakter)');
ok($('coachPane').textContent.includes('Açılış') || $('coachPane').textContent.includes('Genel'), 'koc notlari bolum iceriyor');
const glyphs = $('moveList').querySelectorAll('.ml-glyph');
ok(glyphs.length > 10, 'hamle listesinde sinif glifleri: ' + glyphs.length);
ok($('chart').querySelectorAll('.chart-line').length === 1, 'grafik cizgisi cizildi');
ok($('chart').querySelectorAll('.chart-err').length > 0, 'grafikte hata isaretcisi var');

// ---- Hamle secimi ----
$('moveList').querySelectorAll('.ml-move')[8].click();
await new Promise(r => setTimeout(r, 30));
ok($('moveCard').textContent.includes('Oynanan'), 'secili hamle karti dolduruldu');
ok($('moveCard').querySelector('.mc-badge') !== null, 'sinif rozeti var');
ok($('evalLabel').textContent !== '0.00', 'degerlendirme cubugu guncellendi: ' + $('evalLabel').textContent);
const w1 = $('evalFill').style.transform;
$('moveList').querySelectorAll('.ml-move')[12].click();
await new Promise(r => setTimeout(r, 30));
ok($('evalFill').style.transform !== w1, 'degerlendirme cubugu hamleyle degisti: ' + w1 + ' -> ' + $('evalFill').style.transform);
ok($('board').querySelectorAll('.piece').length > 0, 'tahta cizildi');

// ---- Hamle listesi barlari / ozet karti / kritik anlar ----
const bars = $('moveList').querySelectorAll('.ml-bar');
ok(bars.length > 10, 'hamle listesinde degerlendirme bari: ' + bars.length);
const accs = $('moveList').querySelectorAll('.ml-acc');
ok(accs.length > 10 && /%\d+/.test(accs[0].textContent), 'dogruluk yuzdesi gosteriliyor: ' + accs[0].textContent);
const fill = bars[0].querySelector('.ml-bar-fill');
ok(fill && /%$/.test(fill.style.width || ''), 'bar dolgusu genisligi ayarli: ' + (fill && fill.style.width));

const meter = $('whiteMeter');
ok(/scaleX\(0\.\d+\)/.test(meter.style.transform || ''), 'dogruluk olceri dolduruldu: ' + meter.style.transform);
ok(/scaleX\(0\.\d+\)/.test($('blackMeter').style.transform || ''), 'siyah olceri dolduruldu');
ok($('ghStats').querySelectorAll('.gh-chip').length >= 3, 'sinif cipleri: ' + $('ghStats').querySelectorAll('.gh-chip').length);
ok($('ghStats').textContent.includes('Açılış'), 'faz ozeti cipinde');

ok($('criticalStrip').hidden === false, 'kritik anlar seridi gorunur');
const csCards = $('criticalCards').querySelectorAll('.cs-card');
ok(csCards.length >= 3, 'kritik an kartlari: ' + csCards.length);
ok(csCards[0].textContent.includes('en iyi:'), 'kritik kartta en iyi hamle onerisi var');
const firstLoss = csCards[0].textContent.match(/−(\d+\.\d)/);
ok(firstLoss !== null, 'kritik kartta puan kaybi var: ' + (firstLoss && firstLoss[0]));
csCards[0].click();
await new Promise(r => setTimeout(r, 30));
ok($('reviewView').querySelector('[data-pane="moves"]').hidden === false, 'kritik karta tiklayinca hamle sekmesi acilir');
ok($('moveCard').textContent.includes('Oynanan'), 'kritik karta tiklayinca hamle karti doluyor');
ok($('moveCard').querySelector('.mc-verdict') !== null, 'hamle karti yorum cumlesi iceriyor');
ok($('moveCard').querySelector('.mc-eval-fill') !== null, 'hamle karti degerlendirme cubugu iceriyor');

// ---- Sekmeler ----
$('reviewView').querySelector('.tab-button[data-tab="chart"]').click();
ok($('reviewView').querySelector('[data-pane="chart"]').hidden === false, 'grafik sekmesi acildi');
ok($('reviewView').querySelector('[data-pane="moves"]').hidden === true, 'hamle sekmesi kapandi');
$('reviewView').querySelector('.tab-button[data-tab="coach"]').click();
ok($('coachPane').hidden === false, 'koc sekmesi acildi');

// ---- Klavye gezinme ----
const before = $('moveLabel').textContent;
window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
await new Promise(r => setTimeout(r, 20));
ok($('moveLabel').textContent !== before, 'sol ok hamle degistirdi: ' + before + ' -> ' + $('moveLabel').textContent);
window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
await new Promise(r => setTimeout(r, 20));
ok($('moveLabel').textContent === before, 'sag ok geri dondu');

// ---- Keşif modu: tahtada hamle ----
$('startBtn').click();            // baslangic konumuna don
await new Promise(r => setTimeout(r, 20));
function clickSquare(sq) {
  const file = sq.charCodeAt(0) - 97;
  const rank = Number(sq[1]);
  const x = file * 100 + 50, y = (8 - rank) * 100 + 50;
  $('board').querySelector('.board-svg').dispatchEvent(new window.Event('pointerdown', { bubbles: true, cancelable: true }));
  // olay nesnesinde clientX/Y yok: elle ayarla
}
// jsdom olay nesnesine clientX eklenmiyor; dogrudan tahta olayini taklit et
const svg = $('board').querySelector('.board-svg');
function fireSquare(sq) {
  const file = sq.charCodeAt(0) - 97;
  const rank = Number(sq[1]);
  const ev = new window.Event('pointerdown', { bubbles: true, cancelable: true });
  ev.clientX = file * 100 + 50;
  ev.clientY = (8 - rank) * 100 + 50;
  svg.dispatchEvent(ev);
}
fireSquare('e2');
await new Promise(r => setTimeout(r, 20));
ok($('board').querySelectorAll('.legal-dot').length > 0, 'yasal hamle noktalari: ' + $('board').querySelectorAll('.legal-dot').length);
fireSquare('e4');
await new Promise(r => setTimeout(r, 20));
ok($('exploreBadge').hidden === false, 'kesif modu acildi');
ok($('board').querySelector('.piece[data-sq="e4"]') !== null, 'e4 karesinde piyon var');
window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
await new Promise(r => setTimeout(r, 20));
ok($('exploreBadge').hidden === true, 'Esc ile kesif modundan cikildi');

// ---- Tema ----
$('themeBtn').click();
ok(window.document.documentElement.dataset.theme === 'light', 'acik temaya gecildi');
$('themeBtn').click();
ok(window.document.documentElement.dataset.theme === 'dark', 'koyu temaya donuldu');

// ---- Dışa aktarma ----
let downloaded = null;
const realCreate = globalThis.URL.createObjectURL;
window.HTMLAnchorElement.prototype.click = function () { downloaded = this.download; };
$('exportReportBtn').click();
ok(downloaded === 'analiz-raporu.md', 'rapor indirildi: ' + downloaded);
$('exportPgnBtn').click();
ok(/\.pgn$/.test(downloaded || ''), 'PGN indirildi: ' + downloaded);

// ---- AI Koç sekmesi ----
window.document.querySelector('.tab-button[data-tab="ai"]').click();
ok($('aiRun').hidden === false, 'AI Koc hazir gelir (kurulum adimi yok)');
ok($('aiGenerateBtn').disabled === false, 'AI koç uretim dugmesi etkin');
ok($('aiGenerateBtn').textContent.includes('AI koç'), 'uretum dugmesi etiketli');
ok(document.querySelector('.ai-advanced') !== null, 'kendi sunucusu icin gelismis bolum var');
ok($('aiWorkerUrl').value === '', 'kullaniciya adres sormuyor');

// anahtar verilmeden uretim denemesi
$('aiGenerateBtn') && null;
const realFetch = globalThis.fetch;
const COACH_JSON = {
  ok: true, model: 'gemini-2.5-flash', usage: { promptTokens: 900, outputTokens: 250 },
  coach: {
    overall: 'Sağlam bir oyun.', strengths: ['Açılış hazırlığı'], weaknesses: ['Son oyun tekniği'],
    keyMoments: [{ move: '9. Nxb5', what: 'Materyal feda', why: 'Rok açıldı', better: 'Bc4' }],
    studyPlan: ['Günlük taktik çöz'], estimatedLevel: '1500-1700'
  }
};
globalThis.fetch = (url, opts) => {
  const u = String(url);
  if (u.endsWith('/health')) {
    return Promise.resolve(new Response(JSON.stringify({ ok: true, model: 'gemini-2.5-flash', keyConfigured: true }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }));
  }
  return Promise.resolve(new Response(JSON.stringify(COACH_JSON),
    { status: 200, headers: { 'Content-Type': 'application/json' } }));
};

$('aiWorkerUrl').value = 'https://vezir-ai-coach.test.workers.dev';
$('aiSaveUrlBtn').click();
await new Promise(r => setTimeout(r, 50));
ok($('aiWorkerUrl').value === 'https://vezir-ai-coach.test.workers.dev', 'ozel adres kaydedildi: ' + $('aiWorkerUrl').value);
ok($('aiCostHint').textContent.includes('hamle'), 'analiz verisi gonderilecegi yaziyor');
ok($('aiStatus').textContent.includes('gemini'), 'baglanti testi mesaji: ' + $('aiStatus').textContent);

$('aiGenerateBtn').click();
const aiT0 = Date.now();
while ($('aiGenerateBtn').disabled && Date.now() - aiT0 < 60000) await new Promise(r => setTimeout(r, 100));
ok($('aiOutput').textContent.includes('Sağlam bir oyun.'), 'AI koc yorumu goruntulendi');
ok($('aiOutput').textContent.includes('Günlük taktik çöz'), 'calisma plani gorunuyor');
ok($('aiOutput').textContent.includes('Daha iyisi'), 'kritik anlar gorunuyor');
ok($('aiGenerateBtn').disabled === false, 'uretici dugmesi tekrar aktif');

// hata yolu: worker hatasi
globalThis.fetch = () => Promise.resolve(new Response(JSON.stringify({ ok: false, error: 'Günlük limite ulaşıldı', code: 'rate_limited' }),
  { status: 429, headers: { 'Content-Type': 'application/json' } }));
$('aiGenerateBtn').click();
const aiT1 = Date.now();
while ($('aiGenerateBtn').disabled && Date.now() - aiT1 < 60000) await new Promise(r => setTimeout(r, 100));
ok($('aiOutput').textContent.includes('Günlük limite ulaşıldı'), 'hata mesaji kullaniciya gosterildi');
globalThis.fetch = realFetch;

// ---- Yeni oyun ekranı ----
$('newGameBtn').click();
ok($('importView').hidden === false && $('reviewView').hidden === true, 'yeni oyun ekranina donuldu');

console.log(`\n${pass} gecti, ${fail} basarisiz`);
process.exit(fail ? 1 : 0);
