// js/chart.js
// Degerlendirme grafigi (SVG): oyun boyunca beyaz acisindan skor egrisi.

const PAD = { left: 34, right: 12, top: 10, bottom: 18 };

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
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 600 220');
    svg.setAttribute('class', 'chart-svg');
    svg.setAttribute('preserveAspectRatio', 'none');
    wrap.appendChild(svg);
    this.svg = svg;
    this.el.appendChild(wrap);
    svg.addEventListener('click', (e) => {
      const rect = svg.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 600;
      const n = Math.max(1, this.data.length - 1);
      const idx = Math.round((x - PAD.left) / (600 - PAD.left - PAD.right) * n);
      this.onSelect(Math.max(0, Math.min(this.data.length - 1, idx)));
    });
  }

  setData(moves) {
    this.data = moves.map(m => ({
      v: m.mateWhiteBefore !== null && m.mateWhiteBefore !== undefined
        ? (m.mateWhiteBefore > 0 ? 10 : -10)
        : Math.max(-10, Math.min(10, (m.evalWhiteBefore || 0) / 100)),
      cls: m.class,
      ply: m.ply
    }));
    this.render();
  }

  setCurrent(ply) { this.current = ply; this.render(); }

  render() {
    const svg = this.svg;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    const W = 600, H = 220;
    const n = Math.max(1, this.data.length);
    const x = (i) => PAD.left + (i / Math.max(1, n - 1)) * (W - PAD.left - PAD.right);
    const y = (v) => H / 2 - (v / 10) * (H / 2 - PAD.top);

    for (const v of [-10, -5, 0, 5, 10]) {
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', PAD.left);
      line.setAttribute('x2', W - PAD.right);
      line.setAttribute('y1', y(v));
      line.setAttribute('y2', y(v));
      line.setAttribute('class', v === 0 ? 'grid zero' : 'grid');
      svg.appendChild(line);
      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', 4);
      label.setAttribute('y', y(v) + 4);
      label.setAttribute('class', 'grid-label');
      label.textContent = v === 0 ? '0' : (v > 0 ? '+' : '') + v;
      svg.appendChild(label);
    }

    if (this.data.length) {
      let d = '';
      this.data.forEach((p, i) => {
        const px = x(i), py = y(p.v);
        d += (i === 0 ? 'M' : 'L') + px.toFixed(1) + ' ' + py.toFixed(1) + ' ';
      });
      const area = d + 'L' + x(this.data.length - 1).toFixed(1) + ' ' + y(0) + ' L' + x(0).toFixed(1) + ' ' + y(0) + ' Z';
      const areaEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      areaEl.setAttribute('d', area);
      areaEl.setAttribute('class', 'chart-area');
      svg.appendChild(areaEl);
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', d);
      path.setAttribute('class', 'chart-line');
      svg.appendChild(path);

      this.data.forEach((p, i) => {
        if (p.cls === 'blunder' || p.cls === 'mistake') {
          const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          c.setAttribute('cx', x(i));
          c.setAttribute('cy', y(p.v));
          c.setAttribute('r', 4);
          c.setAttribute('class', 'chart-err ' + p.cls);
          svg.appendChild(c);
        }
      });

      if (this.current >= 0 && this.current < this.data.length) {
        const cx = x(this.current), cy = y(this.data[this.current].v);
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', cx); line.setAttribute('x2', cx);
        line.setAttribute('y1', PAD.top); line.setAttribute('y2', H - PAD.bottom);
        line.setAttribute('class', 'chart-cursor');
        svg.appendChild(line);
        const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        dot.setAttribute('cx', cx); dot.setAttribute('cy', cy);
        dot.setAttribute('r', 5);
        dot.setAttribute('class', 'chart-cursor-dot');
        svg.appendChild(dot);
      }
    } else {
      const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      t.setAttribute('x', W / 2); t.setAttribute('y', H / 2);
      t.setAttribute('text-anchor', 'middle');
      t.setAttribute('class', 'chart-empty');
      t.textContent = 'Grafik için oyunu analiz edin';
      svg.appendChild(t);
    }
  }
}
