// js/icons.js
// Çizilmiş SVG ikon seti. Unicode glif ve emoji ikon yerine kullanılır:
// tek strok kalınlığı, tek eklem stili, 24×24 kılavuz.
// İkonlar iki biçimde üretilir: düz (stroke) ve dolu (fill).

const S = 2.2;            // strok kalınlığı
const CAP = 'round';      // eklem / uç stili

/* Hamle sınıfı göstergeleri — küçük boyutta okunacak siluetler */
const CLASS = {
  brilliant: `<path d="M12 3.2l2.1 5.3 5.3 2.1-5.3 2.1L12 18l-2.1-5.3L4.6 10.6l5.3-2.1z" fill="currentColor"/>`,
  best: `<path d="M4.8 12.9l4.5 4.5L19.4 7.3" fill="none" stroke="currentColor" stroke-width="${S}" stroke-linecap="${CAP}" stroke-linejoin="${CAP}"/>`,
  excellent: `<path d="M6.2 14.2l5.8-5.8 5.8 5.8" fill="none" stroke="currentColor" stroke-width="${S}" stroke-linecap="${CAP}" stroke-linejoin="${CAP}"/>`,
  good: `<circle cx="12" cy="12" r="3.4" fill="currentColor"/>`,
  inaccuracy: `<path d="M12 5.4v7.4" fill="none" stroke="currentColor" stroke-width="${S}" stroke-linecap="${CAP}"/><circle cx="12" cy="17.6" r="1.35" fill="currentColor"/>`,
  mistake: `<path d="M8.2 5v7.4M15.8 5v7.4" fill="none" stroke="currentColor" stroke-width="${S}" stroke-linecap="${CAP}"/><circle cx="8.2" cy="17.6" r="1.35" fill="currentColor"/><circle cx="15.8" cy="17.6" r="1.35" fill="currentColor"/>`,
  blunder: `<path d="M6.6 6.6l10.8 10.8M17.4 6.6L6.6 17.4" fill="none" stroke="currentColor" stroke-width="${S}" stroke-linecap="${CAP}"/>`,
  mate: `<path d="M9 4.4v15.2M15 4.4v15.2M4.6 9h14.8M4.6 15h14.8" fill="none" stroke="currentColor" stroke-width="${S}" stroke-linecap="${CAP}"/>`,
  forced: `<path d="M6 12h12" fill="none" stroke="currentColor" stroke-width="${S}" stroke-linecap="${CAP}"/>`
};

/* Arayüz ikonları */
const UI = {
  first: `<path d="M18 5.2v13.6L9.4 12z" fill="currentColor"/><path d="M6 5.2v13.6" fill="none" stroke="currentColor" stroke-width="${S}" stroke-linecap="${CAP}"/>`,
  prev: `<path d="M15.4 5.2v13.6L6 12z" fill="currentColor"/>`,
  play: `<path d="M8 5.2l11 6.8-11 6.8z" fill="currentColor"/>`,
  pause: `<path d="M8.4 5.2v13.6M15.6 5.2v13.6" fill="none" stroke="currentColor" stroke-width="${S + 0.4}" stroke-linecap="${CAP}"/>`,
  next: `<path d="M8.6 5.2v13.6L18 12z" fill="currentColor"/>`,
  last: `<path d="M6 5.2v13.6L14.6 12z" fill="currentColor"/><path d="M18 5.2v13.6" fill="none" stroke="currentColor" stroke-width="${S}" stroke-linecap="${CAP}"/>`,
  flip: `<path d="M4.6 9.4h12.8M14.4 6.4l3 3-3 3" fill="none" stroke="currentColor" stroke-width="${S}" stroke-linecap="${CAP}" stroke-linejoin="${CAP}"/><path d="M19.4 14.6H6.6M9.6 11.6l-3 3 3 3" fill="none" stroke="currentColor" stroke-width="${S}" stroke-linecap="${CAP}" stroke-linejoin="${CAP}"/>`,
  moves: `<path d="M4.6 6.6h14.8M4.6 12h14.8M4.6 17.4h9.4" fill="none" stroke="currentColor" stroke-width="${S}" stroke-linecap="${CAP}"/>`,
  chart: `<path d="M4.4 19.4h15.2" fill="none" stroke="currentColor" stroke-width="${S}" stroke-linecap="${CAP}"/><path d="M7.4 19.4V12M12 19.4V6.6M16.6 19.4v-4.6" fill="none" stroke="currentColor" stroke-width="${S}" stroke-linecap="${CAP}"/>`,
  coach: `<path d="M9.2 18.2h5.6" fill="none" stroke="currentColor" stroke-width="${S}" stroke-linecap="${CAP}"/><path d="M12 3.4a6 6 0 0 0-3.4 10.9v2.3h6.8v-2.3A6 6 0 0 0 12 3.4z" fill="none" stroke="currentColor" stroke-width="${S}" stroke-linecap="${CAP}" stroke-linejoin="${CAP}"/>`,
  ai: `<path d="M12 3.6l1.9 4.7 4.7 1.9-4.7 1.9L12 16.8l-1.9-4.7-4.7-1.9 4.7-1.9z" fill="none" stroke="currentColor" stroke-width="${S}" stroke-linejoin="${CAP}"/><path d="M18.4 15.6l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" fill="currentColor"/>`,
  analyze: `<circle cx="10.8" cy="10.8" r="5.9" fill="none" stroke="currentColor" stroke-width="${S}"/><path d="M15.2 15.2l4.4 4.4" fill="none" stroke="currentColor" stroke-width="${S}" stroke-linecap="${CAP}"/>`,
  upload: `<path d="M12 16.4V5.2M8.2 9L12 5.2 15.8 9" fill="none" stroke="currentColor" stroke-width="${S}" stroke-linecap="${CAP}" stroke-linejoin="${CAP}"/><path d="M4.8 15.4v2.4a2 2 0 0 0 2 2h10.4a2 2 0 0 0 2-2v-2.4" fill="none" stroke="currentColor" stroke-width="${S}" stroke-linecap="${CAP}"/>`,
  link: `<path d="M9.6 14.4a3.4 3.4 0 0 1 0-4.8l2.2-2.2a3.4 3.4 0 0 1 4.8 4.8l-1 1" fill="none" stroke="currentColor" stroke-width="${S}" stroke-linecap="${CAP}"/><path d="M14.4 9.6a3.4 3.4 0 0 1 0 4.8l-2.2 2.2a3.4 3.4 0 0 1-4.8-4.8l1-1" fill="none" stroke="currentColor" stroke-width="${S}" stroke-linecap="${CAP}"/>`,
  comment: `<path d="M4.4 6.6a2 2 0 0 1 2-2h11.2a2 2 0 0 1 2 2v7.2a2 2 0 0 1-2 2H9.8L6 19.4v-3.6H6.4a2 2 0 0 1-2-2z" fill="none" stroke="currentColor" stroke-width="${S}" stroke-linecap="${CAP}" stroke-linejoin="${CAP}"/>`,
  sun: `<circle cx="12" cy="12" r="4.1" fill="none" stroke="currentColor" stroke-width="${S}"/><path d="M12 3.2v2.2M12 18.6v2.2M3.2 12h2.2M18.6 12h2.2M5.8 5.8l1.6 1.6M16.6 16.6l1.6 1.6M18.2 5.8l-1.6 1.6M7.4 16.6l-1.6 1.6" fill="none" stroke="currentColor" stroke-width="${S}" stroke-linecap="${CAP}"/>`,
  moon: `<path d="M19.4 14.6A7.8 7.8 0 0 1 9.4 4.6a7.8 7.8 0 1 0 10 10z" fill="none" stroke="currentColor" stroke-width="${S}" stroke-linejoin="${CAP}"/>`,
  close: `<path d="M6.6 6.6l10.8 10.8M17.4 6.6L6.6 17.4" fill="none" stroke="currentColor" stroke-width="${S}" stroke-linecap="${CAP}"/>`,
  check: `<path d="M4.8 12.9l4.5 4.5L19.4 7.3" fill="none" stroke="currentColor" stroke-width="${S + 0.3}" stroke-linecap="${CAP}" stroke-linejoin="${CAP}"/>`,
  warn: `<path d="M12 4.4l8.4 15.2H3.6z" fill="none" stroke="currentColor" stroke-width="${S}" stroke-linejoin="${CAP}"/><path d="M12 10v4.2" fill="none" stroke="currentColor" stroke-width="${S}" stroke-linecap="${CAP}"/><circle cx="12" cy="17" r="1.15" fill="currentColor"/>`,
  board: `<rect x="3.6" y="3.6" width="16.8" height="16.8" rx="2.4" fill="none" stroke="currentColor" stroke-width="${S}"/><path d="M3.6 9.6h16.8M3.6 15.2h16.8M9.2 3.6v16.8M15 3.6v16.8" fill="none" stroke="currentColor" stroke-width="1.5"/>`,
  crown: `<path d="M4.4 17.6h15.2" fill="none" stroke="currentColor" stroke-width="${S}" stroke-linecap="${CAP}"/><path d="M4.6 8.2l3.6 3.2L12 5.6l3.8 5.8 3.6-3.2-1.6 8.2H6.2z" fill="none" stroke="currentColor" stroke-width="${S}" stroke-linejoin="${CAP}"/>`
};

/* SVG metni üret (innerHTML ile güvenli: içerik sabit, kullanıcı verisi yok) */
export function icon(name, size = 16, cls = '') {
  const body = CLASS[name] || UI[name];
  if (!body) return '';
  return `<svg class="ic ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body}</svg>`;
}

/* Hamle sınıfı göstergesi (mevcut sınıf glifi yerine) */
export function classIcon(cls) { return icon(CLASS[cls] ? cls : 'good', 15, 'ic-class'); }

export const hasIcon = (name) => !!(CLASS[name] || UI[name]);
