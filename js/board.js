// js/board.js
// SVG satranç tahtası: kareler, taşlar (Unicode glif + stroke), vurgular,
// en iyi hamle oku, yasal hamle noktaları, tıklama/drag etkileşimi.

const GLYPHS = { K: '♚', Q: '♛', R: '♜', B: '♝', N: '♞', P: '♟' };
const FILES = 'abcdefgh';
const SQUARE_SIZE = 100;

function squareName(idx) { return FILES[idx & 7] + (8 - (idx >> 3)); }
function squareIndex(name) { return (8 - Number(name[1])) * 8 + FILES.indexOf(name[0]); }

export class BoardView {
  constructor(container, options = {}) {
    this.el = typeof container === 'string' ? document.getElementById(container) : container;
    this.flipped = false;
    this.onSquare = options.onSquare || (() => {});
    this.selected = null;
    this.legalTargets = [];
    this.lastMove = null;
    this.bestArrow = null;   // { from, to } UCI benzeri kare adları
    this.checkSquare = null;
    this._fen = null;
    this._build();
  }

  _build() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '-30 -30 860 860');
    svg.setAttribute('class', 'board-svg');
    svg.setAttribute('role', 'grid');
    svg.setAttribute('aria-label', 'Satranç tahtası');

    this.layers = {};
    for (const name of ['squares', 'coords', 'highlights', 'arrows', 'dots', 'pieces']) {
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('class', 'layer-' + name);
      svg.appendChild(g);
      this.layers[name] = g;
    }
    this.svg = svg;
    this.el.appendChild(svg);

    svg.addEventListener('pointerdown', (e) => {
      const sq = this._squareFromEvent(e);
      if (sq) this.onSquare(sq, e);
    });
  }

  _squareFromEvent(e) {
    const rect = this.svg.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 860 - 30;
    const y = ((e.clientY - rect.top) / rect.height) * 860 - 30;
    if (x < 0 || x >= 800 || y < 0 || y >= 800) return null;
    const col = Math.floor(x / SQUARE_SIZE);
    const row = Math.floor(y / SQUARE_SIZE);
    const fileIdx = this.flipped ? 7 - col : col;
    const rankIdx = this.flipped ? 7 - row : row;
    return FILES[fileIdx] + (8 - rankIdx);
  }

  flip() { this.flipped = !this.flipped; if (this._fen) this.render(this._fen); }

  setLastMove(move) { this.lastMove = move; }
  setBestArrow(arrow) { this.bestArrow = arrow; }
  setLegalTargets(targets) { this.legalTargets = targets || []; }
  setCheckSquare(sq) { this.checkSquare = sq; }

  render(fen) {
    this._fen = fen;
    const rows = fen.split(' ')[0].split('/');
    for (const key of Object.keys(this.layers)) this.layers[key].innerHTML = '';

    // Kareler
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const rowIdx = this.flipped ? 7 - r : r;
        const fileIdx = this.flipped ? 7 - f : f;
        const sqName = FILES[fileIdx] + (8 - rowIdx);
        const isDark = (fileIdx + rowIdx) % 2 === 1;
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', f * SQUARE_SIZE);
        rect.setAttribute('y', r * SQUARE_SIZE);
        rect.setAttribute('width', SQUARE_SIZE);
        rect.setAttribute('height', SQUARE_SIZE);
        rect.setAttribute('class', 'sq ' + (isDark ? 'dark' : 'light'));
        rect.dataset.sq = sqName;
        this.layers.squares.appendChild(rect);
      }
    }

    // Koordinatlar
    for (let i = 0; i < 8; i++) {
      const fileLabel = FILES[this.flipped ? 7 - i : i];
      const rankLabel = String(8 - (this.flipped ? 7 - i : i));
      const ft = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      ft.setAttribute('x', i * SQUARE_SIZE + 8);
      ft.setAttribute('y', 8 * SQUARE_SIZE + 22);
      ft.setAttribute('class', 'coord');
      ft.textContent = fileLabel;
      this.layers.coords.appendChild(ft);
      const rt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      rt.setAttribute('x', -18);
      rt.setAttribute('y', i * SQUARE_SIZE + 24);
      rt.setAttribute('class', 'coord');
      rt.textContent = rankLabel;
      this.layers.coords.appendChild(rt);
    }

    // Vurgular: son hamle, seçili kare, şah
    const highlight = (sq, cls) => {
      const rect = this.layers.highlights.querySelector(`[data-sq="${sq}"]`);
      if (!rect) {
        const idx = squareIndex(sq);
        const fileIdx = idx & 7, rankIdx = idx >> 3;
        const col = this.flipped ? 7 - fileIdx : fileIdx;
        const row = this.flipped ? 7 - rankIdx : rankIdx;
        const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        r.setAttribute('x', col * SQUARE_SIZE);
        r.setAttribute('y', row * SQUARE_SIZE);
        r.setAttribute('width', SQUARE_SIZE);
        r.setAttribute('height', SQUARE_SIZE);
        r.setAttribute('class', 'hl ' + cls);
        r.dataset.sq = sq;
        this.layers.highlights.appendChild(r);
      }
    };
    if (this.lastMove) { highlight(this.lastMove.from, 'lastmove'); highlight(this.lastMove.to, 'lastmove'); }
    if (this.selected) highlight(this.selected, 'selected');
    if (this.checkSquare) highlight(this.checkSquare, 'check');

    // En iyi hamle oku
    if (this.bestArrow && this.bestArrow.from !== this.bestArrow.to) {
      const a = this._arrowCoords(this.bestArrow.from, this.bestArrow.to);
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', a.x1); line.setAttribute('y1', a.y1);
      line.setAttribute('x2', a.x2); line.setAttribute('y2', a.y2);
      line.setAttribute('class', 'best-arrow');
      this.layers.arrows.appendChild(line);
    }

    // Yasal hedef noktaları
    for (const sq of this.legalTargets) {
      const idx = squareIndex(sq);
      const fileIdx = idx & 7, rankIdx = idx >> 3;
      const col = this.flipped ? 7 - fileIdx : fileIdx;
      const row = this.flipped ? 7 - rankIdx : rankIdx;
      const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      c.setAttribute('cx', col * SQUARE_SIZE + SQUARE_SIZE / 2);
      c.setAttribute('cy', row * SQUARE_SIZE + SQUARE_SIZE / 2);
      c.setAttribute('r', SQUARE_SIZE * 0.16);
      c.setAttribute('class', 'legal-dot');
      this.layers.dots.appendChild(c);
    }

    // Taşlar
    for (let r = 0; r < 8; r++) {
      let f = 0;
      for (const ch of rows[r]) {
        if (/[1-8]/.test(ch)) { f += Number(ch); continue; }
        const idx = r * 8 + f;
        const rowIdx = this.flipped ? 7 - r : r;
        const fileIdx = this.flipped ? 7 - f : f;
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', fileIdx * SQUARE_SIZE + SQUARE_SIZE / 2);
        text.setAttribute('y', rowIdx * SQUARE_SIZE + SQUARE_SIZE * 0.78);
        text.setAttribute('class', 'piece ' + (ch === ch.toUpperCase() ? 'white' : 'black'));
        text.setAttribute('text-anchor', 'middle');
        text.textContent = GLYPHS[ch.toUpperCase()];
        text.dataset.sq = squareName(idx);
        this.layers.pieces.appendChild(text);
        f++;
      }
    }
  }

  _arrowCoords(fromSq, toSq) {
    const a = this._center(fromSq);
    const b = this._center(toSq);
    // oku hedef karesinin kenarına kadar kısalt
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const shrink = SQUARE_SIZE * 0.42;
    return { x1: a.x, y1: a.y, x2: b.x - (dx / len) * shrink, y2: b.y - (dy / len) * shrink };
  }

  _center(sq) {
    const idx = squareIndex(sq);
    const fileIdx = idx & 7, rankIdx = idx >> 3;
    const col = this.flipped ? 7 - fileIdx : fileIdx;
    const row = this.flipped ? 7 - rankIdx : rankIdx;
    return { x: col * SQUARE_SIZE + SQUARE_SIZE / 2, y: row * SQUARE_SIZE + SQUARE_SIZE / 2 };
  }
}
