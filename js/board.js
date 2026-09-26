// js/board.js
// SVG satranç tahtası: kareler, koordinatlar, vurgular, en iyi hamle oku,
// yasal hedefler (nokta / alma halkası), tıklama ile hamle ve terfi seçici.

import { pieceElements } from './pieces.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const FILES = 'abcdefgh';
const SQ = 100;

function squareName(idx) { return FILES[idx & 7] + (8 - (idx >> 3)); }
function squareIndex(name) { return (8 - Number(name[1])) * 8 + FILES.indexOf(name[0]); }
function svgEl(tag, attrs) {
  const e = document.createElementNS(SVGNS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
}

export class BoardView {
  constructor(container, options = {}) {
    this.el = typeof container === 'string' ? document.getElementById(container) : container;
    this.flipped = false;
    this.onSquare = options.onSquare || (() => {});
    this.onPromotion = options.onPromotion || null;
    this.selected = null;
    this.legalTargets = [];       // [{to, capture}]
    this.lastMove = null;
    this.bestArrow = null;
    this.checkSquare = null;
    this.pendingPromotion = null; // {from, to}
    this._fen = null;
    this._build();
  }

  _build() {
    const svg = svgEl('svg', { viewBox: '-16 -16 832 832', class: 'board-svg', role: 'grid', 'aria-label': 'Satranç tahtası' });
    this.layers = {};
    for (const name of ['squares', 'coords', 'highlights', 'arrows', 'targets', 'pieces', 'promo']) {
      const g = svgEl('g', { class: 'layer-' + name });
      svg.appendChild(g);
      this.layers[name] = g;
    }
    this.svg = svg;
    this.el.appendChild(svg);
    svg.addEventListener('pointerdown', (e) => {
      const sq = this._squareFromEvent(e);
      if (sq) this.onSquare(sq, e);
    });
    svg.addEventListener('contextmenu', (e) => {
      if (this.pendingPromotion) { e.preventDefault(); this.clearPromotion(); }
    });
  }

  _squareFromEvent(e) {
    const rect = this.svg.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 832 - 16;
    const y = ((e.clientY - rect.top) / rect.height) * 832 - 16;
    if (x < 0 || x >= 800 || y < 0 || y >= 800) return null;
    const col = Math.floor(x / SQ), row = Math.floor(y / SQ);
    const fileIdx = this.flipped ? 7 - col : col;
    const rankIdx = this.flipped ? 7 - row : row;
    return FILES[fileIdx] + (8 - rankIdx);
  }

  flip() { this.flipped = !this.flipped; if (this._fen) this.render(this._fen); }
  setLastMove(m) { this.lastMove = m; }
  setBestArrow(a) { this.bestArrow = a; }
  setLegalTargets(t) { this.legalTargets = t || []; }
  setCheckSquare(sq) { this.checkSquare = sq; }

  // Terfi seçici: {from, to} verilir; kullanıcı Q/R/B/N seçince onPromotion çağrılır.
  showPromotion(from, to, color) {
    this.pendingPromotion = { from, to };
    const layer = this.layers.promo;
    layer.innerHTML = '';
    const idx = squareIndex(to);
    const col = this.flipped ? 7 - (idx & 7) : (idx & 7);
    const row = this.flipped ? 7 - (idx >> 3) : (idx >> 3);
    const box = svgEl('g', { class: 'promo-box', transform: `translate(${col * SQ},${row * SQ})` });
    const dim = svgEl('rect', { x: 0, y: 0, width: SQ, height: SQ * 4, class: 'promo-dim' });
    box.appendChild(dim);
    const types = ['q', 'r', 'b', 'n'];
    types.forEach((t, i) => {
      const cell = svgEl('g', { class: 'promo-cell', transform: `translate(0,${i * SQ})` });
      cell.appendChild(svgEl('rect', { x: 6, y: 6, width: SQ - 12, height: SQ - 12, rx: 10, class: 'promo-bg' }));
      const piece = svgEl('g', { class: 'piece ' + (color === 'w' ? 'white' : 'black'), transform: 'translate(14,10) scale(0.72)' });
      appendPiece(piece, t.toUpperCase(), color);
      cell.appendChild(piece);
      cell.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        const p = this.pendingPromotion;
        this.clearPromotion();
        if (this.onPromotion) this.onPromotion(p.from, p.to, t);
      });
      box.appendChild(cell);
    });
    layer.appendChild(box);
  }

  clearPromotion() { this.pendingPromotion = null; this.layers.promo.innerHTML = ''; }

  render(fen) {
    this._fen = fen;
    for (const k in this.layers) {
      if (k !== 'promo') this.layers[k].innerHTML = '';
    }
    const rows = fen.split(' ')[0].split('/');
    const isLight = (f, r) => ((f + r) % 2 === 0);

    // Kareler
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const rowIdx = this.flipped ? 7 - r : r;
        const fileIdx = this.flipped ? 7 - f : f;
        const sqName = FILES[fileIdx] + (8 - rowIdx);
        const rect = svgEl('rect', {
          x: f * SQ, y: r * SQ, width: SQ, height: SQ,
          class: 'sq ' + (isLight(fileIdx, rowIdx) ? 'light' : 'dark'), 'data-sq': sqName
        });
        this.layers.squares.appendChild(rect);
      }
    }

    // Koordinatlar: karelerin içinde, küçük ve soluk (profesyonel tahta görünümü)
    for (let i = 0; i < 8; i++) {
      const col = i;
      const fileLabel = FILES[this.flipped ? 7 - i : i];
      const rankLabel = String(8 - (this.flipped ? 7 - i : i));
      const fileRow = this.flipped ? 0 : 7;
      const rankCol = this.flipped ? 7 : 0;
      const dark = isLight(this.flipped ? 7 - i : i, this.flipped ? 7 - fileRow : fileRow);
      const ft = svgEl('text', {
        x: col * SQ + 7, y: (fileRow + 1) * SQ - 8,
        class: 'coord ' + (dark ? 'on-dark' : 'on-light')
      });
      ft.textContent = fileLabel;
      this.layers.coords.appendChild(ft);
      const dark2 = isLight(rankCol, this.flipped ? 7 - i : i);
      const rt = svgEl('text', {
        x: rankCol * SQ + 7, y: i * SQ + 19,
        class: 'coord ' + (dark2 ? 'on-dark' : 'on-light')
      });
      rt.textContent = rankLabel;
      this.layers.coords.appendChild(rt);
    }

    // Vurgular
    const highlight = (sq, cls) => {
      const idx = squareIndex(sq);
      const col = this.flipped ? 7 - (idx & 7) : (idx & 7);
      const row = this.flipped ? 7 - (idx >> 3) : (idx >> 3);
      this.layers.highlights.appendChild(svgEl('rect', {
        x: col * SQ, y: row * SQ, width: SQ, height: SQ, class: 'hl ' + cls, 'data-sq': sq
      }));
    };
    if (this.lastMove) { highlight(this.lastMove.from, 'lastmove'); highlight(this.lastMove.to, 'lastmove'); }
    if (this.selected) highlight(this.selected, 'selected');
    if (this.checkSquare) highlight(this.checkSquare, 'check');

    // En iyi hamle oku (ok ucu işaretiyle)
    if (this.bestArrow && this.bestArrow.from !== this.bestArrow.to) {
      const a = this._center(this.bestArrow.from), b = this._center(this.bestArrow.to);
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const shrink = SQ * 0.44;
      const x2 = b.x - (dx / len) * shrink, y2 = b.y - (dy / len) * shrink;
      const ang = Math.atan2(dy, dx) * 180 / Math.PI;
      this.layers.arrows.appendChild(svgEl('line', {
        x1: a.x, y1: a.y, x2: x2, y2: y2, class: 'best-arrow'
      }));
      this.layers.arrows.appendChild(svgEl('path', {
        d: 'M -13 -9 L 4 0 L -13 9 Z',
        class: 'best-arrow-head',
        transform: `translate(${x2},${y2}) rotate(${ang})`
      }));
    }

    // Yasal hedefler
    for (const t of this.legalTargets) {
      const idx = squareIndex(t.to);
      const col = this.flipped ? 7 - (idx & 7) : (idx & 7);
      const row = this.flipped ? 7 - (idx >> 3) : (idx >> 3);
      const cx = col * SQ + SQ / 2, cy = row * SQ + SQ / 2;
      if (t.capture) {
        this.layers.targets.appendChild(svgEl('circle', { cx, cy, r: SQ * 0.44, class: 'legal-ring' }));
      } else {
        this.layers.targets.appendChild(svgEl('circle', { cx, cy, r: SQ * 0.15, class: 'legal-dot' }));
      }
    }

    // Taşlar
    for (let r = 0; r < 8; r++) {
      let f = 0;
      for (const ch of rows[r]) {
        if (/[1-8]/.test(ch)) { f += Number(ch); continue; }
        const idx = r * 8 + f;
        const rowIdx = this.flipped ? 7 - r : r;
        const fileIdx = this.flipped ? 7 - f : f;
        const g = svgEl('g', {
          class: 'piece ' + (ch === ch.toUpperCase() ? 'white' : 'black'),
          'data-sq': squareName(idx),
          transform: `translate(${fileIdx * SQ},${rowIdx * SQ})`
        });
        appendPiece(g, ch.toUpperCase(), ch === ch.toUpperCase() ? 'w' : 'b');
        this.layers.pieces.appendChild(g);
        f++;
      }
    }
  }

  _center(sq) {
    const idx = squareIndex(sq);
    const col = this.flipped ? 7 - (idx & 7) : (idx & 7);
    const row = this.flipped ? 7 - (idx >> 3) : (idx >> 3);
    return { x: col * SQ + SQ / 2, y: row * SQ + SQ / 2 };
  }
}

function appendPiece(group, type, color) {
  for (const el of pieceElements(type, color)) group.appendChild(el);
  return group;
}
