// test/board.test.mjs - SVG tahta görünümü (jsdom)
import { JSDOM } from 'jsdom';

let pass = 0, fail = 0;
function ok(cond, label) { if (cond) pass++; else { fail++; console.error('  x BASARISIZ: ' + label); } }

const dom = new JSDOM('<div id="board"></div>', { url: 'http://localhost/' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;

const { BoardView } = await import('../js/board.js');
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const MID = 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4';

const board = new BoardView('board');
const d = dom.window.document;

board.render(START);
ok(d.querySelectorAll('.piece').length === 32, 'baslangicta 32 tas: ' + d.querySelectorAll('.piece').length);
ok(d.querySelectorAll('.sq').length === 64, '64 kare');
ok(d.querySelectorAll('.coord').length === 16, '16 koordinat etiketi');
ok(d.querySelector('.piece[data-sq="e1"]') !== null, 'e1 karesinde tas var');
ok(d.querySelector('.piece[data-sq="e1"]').getAttribute('class').includes('white'), 'e1 beyaz');
ok(d.querySelector('.piece[data-sq="d8"]').getAttribute('class').includes('black'), 'd8 siyah');
const kingG = d.querySelector('.piece[data-sq="e1"]');
ok(kingG.children.length >= 5, 'her tas birden fazla sekilden olusuyor: ' + kingG.children.length);
ok(kingG.querySelectorAll('path,rect,circle,ellipse').length === kingG.children.length, 'tum sekiller gercek SVG ogeleri');

board.render(MID);
ok(d.querySelectorAll('.piece').length === 32, 'orta oyunda da 32 tas');
ok(d.querySelector('.piece[data-sq="c4"]') !== null && d.querySelector('.piece[data-sq="e4"]') !== null, 'fil ve piyon dogru karede');

// Vurgular, ok, hedefler
board.setLastMove({ from: 'g1', to: 'f3' });
board.setBestArrow({ from: 'd1', to: 'h5' });
board.setLegalTargets([{ to: 'e5', capture: false }, { to: 'd5', capture: true }]);
board.setCheckSquare('e8');
board.render(MID);
ok(d.querySelectorAll('.hl.lastmove').length === 2, 'son hamle iki kare vurgulanir');
ok(d.querySelectorAll('.hl.check').length === 1, 'sah karesi vurgulanir');
ok(d.querySelectorAll('.best-arrow').length === 1 && d.querySelectorAll('.best-arrow-head').length === 1, 'en iyi hamle oku + ucu');
ok(d.querySelectorAll('.legal-dot').length === 1, 'bos kare hedefi nokta');
ok(d.querySelectorAll('.legal-ring').length === 1, 'alma hedefi halka');

// Çevirme
board.flip();
board.render(MID);
const e1rect = d.querySelector('.sq[data-sq="e1"]');
ok(e1rect.getAttribute('x') === '300', 'cevrilince e1 ortada: x=' + e1rect.getAttribute('x'));
board.flip();

// Terfi seçici
let promo = null;
board.onPromotion = (from, to, piece) => { promo = { from, to, piece }; };
board.showPromotion('e7', 'e8', 'w');
ok(d.querySelectorAll('.promo-cell').length === 4, '4 terfi secenegi (V/K/F/A)');
d.querySelectorAll('.promo-cell')[0].dispatchEvent(new dom.window.Event('pointerdown', { bubbles: true }));
ok(promo && promo.piece === 'q' && promo.from === 'e7' && promo.to === 'e8', 'vezir secildi: ' + JSON.stringify(promo));
ok(d.querySelectorAll('.promo-cell').length === 0, 'secimden sonra seçici kapanir');

// Kare tıklaması
let clicked = null;
board.onSquare = (sq) => { clicked = sq; };
const svg = d.querySelector('.board-svg');
svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 832, height: 832 });
const ev = new dom.window.Event('pointerdown', { bubbles: true });
ev.clientX = 4 * 100 + 50 + 16;   // e karesi (viewBox -16 ofseti)
ev.clientY = (8 - 2) * 100 + 50 + 16;
svg.dispatchEvent(ev);
ok(clicked === 'e2', 'tiklanan kare dogru hesaplandi: ' + clicked);

console.log(`\n${pass} gecti, ${fail} basarisiz`);
process.exit(fail ? 1 : 0);
