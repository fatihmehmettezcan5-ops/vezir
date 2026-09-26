// js/chart.js
// Değerlendirme grafiği: beyaz açısından skor eğrisi, faz bantları, hata
// işaretleri, imleç + hover ipucu, tıklayarak o hamleye gitme.

const PAD = { left: 36, right: 14, top: 14, bottom: 26 };
let W = 620;
const H = 230;
const SVGNS = 'http://www.w3.org/2000/svg';

const PHASE_LABEL = { opening: 'Açılış', middlegame: 'Orta oyun', endgame: 'Son oyun' };

function el(tag, attrs) {
  const e = document.createElementNS(SVGNS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
}

export class EvalChart {
  constructor(container, options = {}) {
    this.el = typeof container === 'string' ? document.getElementById(container) : container;
    this.onSelect = options.onSelect || (() => {});
    this.data = [];
    this.current = -1;
    this._build();
  }

  _build() {
    const wrap = document.createElement('div');
    wrap.className = 'chart-wrap';

    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart-svg', preserveAspectRatio: 'none' });
    this.svg = svg;

    // Gradyan tanımları
    const defs = el('defs', {});
    const g1 = el('linearGradient', { id: 'evalGrad', x1: '0', y1: '0', x2: '0', y2: '1' });
    g1.appendChild(el('stop', { offset: '0%', 'stop-color': 'var(--chart-w)', 'stop-opacity': '.38' }));
    g1.appendChild(el('stop', { offset: '50%', 'stop-color': 'var(--chart-w)', 'stop-opacity': '.05' }));
    g1.appendChild(el('stop', { offset: '50%', 'stop-color': 'var(--chart-b)', 'stop-opacity': '.05' }));
    g1.appendChild(el('stop', { offset: '100%', 'stop-color': 'var(--chart-b)', 'stop-opacity': '.38' }));
    defs.appendChild(g1);
    svg.appendChild(defs);

    wrap.appendChild(svg);

    const tip = document.createElement('div');
    tip.className = 'chart-tip';
    tip.hidden = true;
    wrap.appendChild(tip);
    this.tip = tip;

    const legend = document.createElement('div');
    legend.className = 'chart-legend';
    legend.innerHTML = `<span class="cl-item"><i class="cl-dot blunder"></i>vahim hata</span>
      <span class="cl-item"><i class="cl-dot mistake"></i>hata</span>
      <span class="cl-item"><i class="cl-dot mate"></i>mat</span>
      <span class="cl-hint">Grafiğe tıklayarak o hamleye gidin</span>`;
    wrap.appendChild(legend);

    this.el.appendChild(wrap);
    this.wrap = wrap;
    this._syncWidth();
    if (typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(() => { this._syncWidth(); this.render(); });
      this._ro.observe(wrap);
    }

    svg.addEventListener('pointermove', (e) => this._hover(e));
    svg.addEventListener('pointerleave', () => { this.tip.hidden = true; });
    svg.addEventListener('click', (e) => {
      const i = this._indexFromEvent(e);
      if (i !== null) this.onSelect(i);
    });
  }

  /* Gerçek piksel genişliğine göre viewBox ayarla: metinler hiç bozulmasın */
  _syncWidth() {
    const rect = this.wrap.getBoundingClientRect();
    const w = Math.round(rect.width);
    if (w > 0 && Math.abs(w - W) > 2) { W = Math.max(320, w); this.svg.setAttribute('viewBox', `0 0 ${W} ${H}`); }
    else this.svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  }

  setData(moves) {
    this.data = moves.map(m => ({
      ply: m.ply,
      san: m.san,
      moveNumber: m.moveNumber,
      color: m.color,
      cls: m.class,
      phase: m.phase,
      mate: m.mateWhiteBefore,
      v: m.mateWhiteBefore !== null && m.mateWhiteBefore !== undefined
        ? (m.mateWhiteBefore > 0 ? 9.6 : -9.6)
        : Math.max(-10, Math.min(10, (m.evalWhiteBefore || 0) / 100))
    }));
    this.render();
  }

  setCurrent(ply) { this.current = ply; this.render(); }

  _indexFromEvent(e) {
    const rect = this.svg.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W;
    const n = Math.max(1, this.data.length - 1);
    const i = Math.round((x - PAD.left) / (W - PAD.left - PAD.right) * n);
    return Math.max(0, Math.min(this.data.length - 1, i));
  }

  _hover(e) {
    if (!this.data.length) return;
    const i = this._indexFromEvent(e);
    const d = this.data[i];
    const x = this._x(i), y = this._y(d.v);
    const rect = this.svg.getBoundingClientRect();
    const cls = d.mate !== null && d.mate !== undefined ? 'mat' : (d.cls || '');
    this.tip.hidden = false;
    this.tip.innerHTML = `<b>${d.moveNumber}${d.color === 'w' ? '.' : '…'} ${d.san}</b>
      <span class="tt-eval ${d.v >= 0 ? 'w' : 'b'}">${d.mate !== null && d.mate !== undefined ? (d.mate > 0 ? '#' + d.mate : '−#' + Math.abs(d.mate)) : (d.v >= 0 ? '+' : '') + d.v.toFixed(2)}</span>
      <span class="tt-phase">${PHASE_LABEL[d.phase] || ''}</span>`;
    const px = (x / W) * rect.width;
    this.tip.style.left = Math.max(4, Math.min(rect.width - 120, px - 55)) + 'px';
    this.tip.style.top = Math.max(2, (y / H) * rect.height - 46) + 'px';
  }

  _x(i) { return PAD.left + (i / Math.max(1, this.data.length - 1)) * (W - PAD.left - PAD.right); }
  _y(v) { return H / 2 - (v / 10) * (H / 2 - PAD.top); }

  render() {
    const svg = this.svg;
    this._syncWidth();
    // defs koru
    while (svg.childNodes.length > 1) svg.removeChild(svg.lastChild);

    // Izgara
    for (const v of [-10, -5, 0, 5, 10]) {
      svg.appendChild(el('line', {
        x1: PAD.left, x2: W - PAD.right, y1: this._y(v), y2: this._y(v),
        class: v === 0 ? 'grid zero' : 'grid'
      }));
      const label = el('text', { x: 5, y: this._y(v) + 4, class: 'grid-label' });
      label.textContent = v === 0 ? '0' : (v > 0 ? '+' : '') + v;
      svg.appendChild(label);
    }

    if (!this.data.length) {
      const t = el('text', { x: W / 2, y: H / 2, 'text-anchor': 'middle', class: 'chart-empty' });
      t.textContent = 'Grafik için oyunu analiz edin';
      svg.appendChild(t);
      return;
    }

    // Faz bantları
    let phaseStart = 0;
    for (let i = 1; i <= this.data.length; i++) {
      if (i === this.data.length || this.data[i].phase !== this.data[phaseStart].phase) {
        const x1 = this._x(phaseStart), x2 = this._x(Math.min(i, this.data.length - 1));
        const band = el('rect', {
          x: x1, y: PAD.top, width: Math.max(1, x2 - x1), height: H - PAD.top - PAD.bottom,
          class: 'phase-band ' + this.data[phaseStart].phase
        });
        svg.appendChild(band);
        const lbl = el('text', { x: (x1 + x2) / 2, y: H - 8, 'text-anchor': 'middle', class: 'phase-label' });
        lbl.textContent = PHASE_LABEL[this.data[phaseStart].phase] || '';
        svg.appendChild(lbl);
        phaseStart = i;
      }
    }

    // Eğri + alan
    let d = '';
    this.data.forEach((p, i) => {
      d += (i === 0 ? 'M' : 'L') + this._x(i).toFixed(1) + ' ' + this._y(p.v).toFixed(1) + ' ';
    });
    const zero = this._y(0);
    svg.appendChild(el('path', {
      d: d + `L${this._x(this.data.length - 1).toFixed(1)} ${zero} L${this._x(0).toFixed(1)} ${zero} Z`,
      class: 'chart-area', fill: 'url(#evalGrad)'
    }));
    svg.appendChild(el('path', { d, class: 'chart-line' }));

    // Hata / mat işaretleri
    this.data.forEach((p, i) => {
      if (p.cls === 'blunder' || p.cls === 'mistake') {
        svg.appendChild(el('circle', { cx: this._x(i), cy: this._y(p.v), r: 4.5, class: 'chart-err ' + p.cls }));
      } else if (p.cls === 'mate' || (p.mate !== null && p.mate !== undefined)) {
        svg.appendChild(el('text', { x: this._x(i), y: this._y(p.v) - 8, 'text-anchor': 'middle', class: 'chart-mate' }))
          .textContent = '#';
      } else if (p.cls === 'brilliant') {
        svg.appendChild(el('circle', { cx: this._x(i), cy: this._y(p.v), r: 4, class: 'chart-err brilliant' }));
      }
    });

    // İmleç
    if (this.current >= 0 && this.current < this.data.length) {
      const cx = this._x(this.current), cy = this._y(this.data[this.current].v);
      svg.appendChild(el('line', { x1: cx, x2: cx, y1: PAD.top, y2: H - PAD.bottom, class: 'chart-cursor' }));
      svg.appendChild(el('circle', { cx, cy, r: 5.5, class: 'chart-cursor-dot' }));
    }
  }
}
