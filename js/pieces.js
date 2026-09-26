// js/pieces.js
// Gömülü SVG satranç taş seti.
//
// Neden Unicode glif (♞ ♜ …) değil? Glifler işletim sistemine göre değişir;
// bazı sistemlerde hiç yoktur ve kutu ikonu çıkar. Bu set her yerde birebir
// aynı görünür, taşları 100x100'ün kare alanına oturtur ve gölge/derinlik
// katmanlarıyla modern düz tasarım sunar.
//
// Her taş aynı "kaide" (taban) payını kullanır -> görsel bütünlük.

const BASE = '<rect class="p-base" x="25" y="83" width="50" height="9" rx="4"/>';
const SHADOW = '<ellipse class="p-shadow" cx="50" cy="93" rx="23" ry="3.5"/>';

// Her taş: [gövde yolu, süs detayları]
const SHAPES = {
  P: [
    '<circle class="p-body" cx="50" cy="31" r="12.5"/>',
    '<rect class="p-body" x="38.5" y="42" width="23" height="5.5" rx="2.75"/>',
    '<path class="p-body" d="M41 48 C36 58 33.5 68 33.5 83 L66.5 83 C66.5 68 64 58 59 48 Z"/>'
  ],
  R: [
    '<path class="p-body" d="M29 47 L29 35 L38 35 L38 45 L62 45 L62 35 L71 35 L71 47 L71 77 C71 79.5 69.5 81 67 81 L33 81 C30.5 81 29 79.5 29 77 Z"/>',
    '<rect class="p-detail" x="33" y="55" width="34" height="2.6" rx="1.3"/>',
    '<rect class="p-detail" x="33" y="66" width="34" height="2.6" rx="1.3"/>'
  ],
  N: [
    // Baş-yatak silueti: ense -> kulak -> alın -> burun -> çene -> boyun
    '<path class="p-body" d="M35 83 L35 62 C35 50 40 42 49 38 L45 26 L54 30 C61 25 70 29 73 38 L80 45 C75 51 69 53 65 56 C63 65 57 71 49 73 L49 83 Z"/>',
    '<path class="p-detail" d="M49 38 C43 44 40 52 39 61 C39 66 41 70 44 73 C40 64 40 52 47 44 Z"/>',
    '<circle class="p-eye" cx="60" cy="39" r="2.6"/>',
    '<path class="p-detail" d="M65 56 C62 60 57 64 51 66" fill="none" stroke-width="2.2" stroke-linecap="round"/>'
  ],
  B: [
    '<path class="p-body" d="M50 16 C56 16 60 21 60 27 C60 31 58 34 55 36 C62 40 66 47 66 55 C66 63 62 70 58 77 L58 83 L42 83 L42 77 C38 70 34 63 34 55 C34 47 38 40 45 36 C42 34 40 31 40 27 C40 21 44 16 50 16 Z"/>',
    '<circle class="p-detail" cx="50" cy="12.5" r="4.5"/>',
    '<path class="p-detail" d="M50 40 L50 62" fill="none" stroke-width="2.4" stroke-linecap="round"/>',
    '<path class="p-detail" d="M44 50 L56 50" fill="none" stroke-width="2.2" stroke-linecap="round"/>'
  ],
  Q: [
    '<path class="p-body" d="M28 76 C28 62 33 52 39 46 L31 34 L43 42 L50 28 L57 42 L69 34 L61 46 C67 52 72 62 72 76 Z"/>',
    '<circle class="p-detail" cx="31" cy="30" r="4.2"/>',
    '<circle class="p-detail" cx="50" cy="24" r="4.2"/>',
    '<circle class="p-detail" cx="69" cy="30" r="4.2"/>',
    '<rect class="p-detail" x="33" y="77" width="34" height="2.8" rx="1.4"/>'
  ],
  K: [
    '<path class="p-body" d="M30 76 C30 62 35 52 42 47 L36 35 L45 42 L50 30 L55 42 L64 35 L58 47 C65 52 70 62 70 76 Z"/>',
    '<rect class="p-detail" x="47.6" y="10" width="4.8" height="18" rx="2"/>',
    '<rect class="p-detail" x="41" y="15.6" width="18" height="4.8" rx="2"/>',
    '<circle class="p-detail" cx="36" cy="31" r="4"/>',
    '<circle class="p-detail" cx="64" cy="31" r="4"/>',
    '<rect class="p-detail" x="34" y="77" width="32" height="2.8" rx="1.4"/>'
  ]
};

// Taşı bir <g> içinde üretir (100x100 yerel koordinat).
export function pieceMarkup(type, color) {
  const shapes = SHAPES[type] || SHAPES.P;
  return SHADOW + BASE + shapes.join('');
}

const SVGNS = 'http://www.w3.org/2000/svg';
const TAG_RE = /<(rect|circle|ellipse|path|line)\b([^>]*?)\/?>/g;
const ATTR_RE = /([a-zA-Z-]+)="([^"]*)"/g;

// Markup dizgesini GERÇEK SVG öğelerine çevirir. innerHTML yerine bunu
// kullanıyoruz: innerHTML SVG üzerinde tarayıcılararası tutarsız (jsdom'da hiç
// parse edilmiyor), createElementNS ise her yerde deterministik.
export function pieceElements(type, color) {
  const markup = pieceMarkup(type, color);
  const out = [];
  let m;
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(markup)) !== null) {
    const el = document.createElementNS(SVGNS, m[1]);
    let a;
    ATTR_RE.lastIndex = 0;
    while ((a = ATTR_RE.exec(m[2])) !== null) el.setAttribute(a[1], a[2]);
    out.push(el);
  }
  return out;
}

export function pieceTransform(x, y) {
  return `translate(${x},${y})`;
}

export const PIECE_TYPES = Object.keys(SHAPES);
