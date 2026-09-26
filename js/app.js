// js/app.js
// Vezir ana uygulaması: oyun yükleme, analiz, tahta, gezinme, koç notları.

import { Chess, moveFromUci, squareName, isInCheck } from './chess.js';
import { parsePgn, buildPositions, serializePgn, sampleGames } from './pgn.js';
import { Engine } from './engine.js';
import { GameAnalyzer, CLASSES, formatScore, scoreToWinPercent } from './analysis.js';
import { generateCoachNotes } from './coach.js';
import { AiCoach, buildCoachPayload, renderCoachHtml, AiCoachError } from './ai-coach.js';
import { BoardView } from './board.js';
import { EvalChart } from './chart.js';

const $ = (id) => document.getElementById(id);

const SETTINGS_KEY = 'vezir.settings';

const S = {
  parsed: null,
  fens: [],
  analyzer: null,
  notes: null,
  aiCoach: new AiCoach(),
  aiAbort: null,
  engine: null,
  board: null,
  chart: null,
  currentIdx: 0,          // gösterilen hamle indeksi (0..n)
  explore: null,          // keşif modundaki Chess nesnesi
  playing: false,
  playTimer: null,
  analyzing: false,
  abort: false,
  settings: { movetime: 400, theme: 'dark', speed: 900 }
};

// ---------------------------------------------------------------------------
// Başlatma
// ---------------------------------------------------------------------------

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) Object.assign(S.settings, JSON.parse(raw));
  } catch (e) { /* yoksay */ }
}

function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(S.settings)); } catch (e) { /* yoksay */ }
}

async function init() {
  loadSettings();
  applyTheme();

  S.board = new BoardView('board', {
    onSquare: onSquareClick,
    onPromotion: (from, to, piece) => {
      const chess = S.explore || new Chess(S.fens[S.currentIdx]);
      chess.move({ from, to, promotion: piece });
      S.explore = chess;
      S.board.setLastMove({ from, to });
      S.board.selected = null;
      S.board.setLegalTargets([]);
      updateExploreBadge();
      showPosition();
    }
  });
  S.chart = new EvalChart('chart', { onSelect: (ply) => goToMove(ply + 1) });

  renderSamples();
  refreshAiPane();
  bindUI();

  if (location.protocol === 'file:') {
    toast('Sayfa dosya:// ile açılmış. Modüllerin çalışması için bir sunucu gerekir: python3 -m http.server', 'error');
  }

  $('engineStatus').textContent = 'Motor yükleniyor…';
  $('engineDot').className = 'status-dot busy';
  S.engine = new Engine();
  try {
    await S.engine.init();
    $('engineDot').className = 'status-dot ready';
    $('engineStatus').textContent = 'Motor hazır';
  } catch (e) {
    $('engineDot').className = 'status-dot error';
    $('engineStatus').textContent = 'Motor hatası';
    toast('Analiz motoru yüklenemedi: ' + e.message, 'error');
  }
}

function bindUI() {
  $('loadPgnBtn').addEventListener('click', () => loadPgnText($('pgnInput').value));
  $('clearPgnBtn').addEventListener('click', () => { $('pgnInput').value = ''; });
  $('newGameBtn').addEventListener('click', backToImport);
  $('analyzeBtn').addEventListener('click', startAnalysis);
  $('abortBtn').addEventListener('click', () => { S.abort = true; });
  $('prevBtn').addEventListener('click', () => goMove(-1));
  $('nextBtn').addEventListener('click', () => goMove(1));
  $('startBtn').addEventListener('click', () => goToMove(0));
  $('endBtn').addEventListener('click', () => goToMove(S.parsed ? S.parsed.moves.length : 0));
  $('playBtn').addEventListener('click', togglePlay);
  $('flipBtn').addEventListener('click', () => { S.board.flip(); showPosition(); });
  $('resetExploreBtn').addEventListener('click', () => { S.explore = null; goToMove(S.currentIdx); });
  $('themeBtn').addEventListener('click', toggleTheme);
  $('exportPgnBtn').addEventListener('click', exportPgn);
  $('exportReportBtn').addEventListener('click', exportReport);
  $('engineMoveBtn').addEventListener('click', playEngineMove);
  $('speedSelect').addEventListener('change', (e) => { S.settings.speed = Number(e.target.value); saveSettings(); });
  $('depthSelect').addEventListener('change', (e) => { S.settings.movetime = Number(e.target.value); saveSettings(); });

  document.querySelectorAll('.tab-button').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // AI Koç
  $('aiSaveUrlBtn').addEventListener('click', saveAiWorkerUrl);
  $('aiTestUrlBtn').addEventListener('click', testAiWorkerUrl);
  $('aiGenerateBtn').addEventListener('click', generateAiCoach);
  $('aiCancelBtn').addEventListener('click', () => { if (S.aiAbort) S.aiAbort.abort(); });

  // Dosya yükleme
  const dz = $('dropZone');
  dz.addEventListener('click', () => $('fileInput').click());
  $('fileInput').addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) readFile(e.target.files[0]);
  });
  ['dragover', 'dragenter'].forEach(ev => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('over'); }));
  dz.addEventListener('drop', (e) => {
    if (e.dataTransfer.files && e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]);
  });

  // Uzaktan oyun çekme
  $('ccFetchBtn').addEventListener('click', fetchChesscom);
  $('liFetchBtn').addEventListener('click', fetchLichess);

  // Klavye
  document.addEventListener('keydown', onKeyDown);
}

function readFile(file) {
  const reader = new FileReader();
  reader.onload = () => loadPgnText(String(reader.result || ''));
  reader.onerror = () => toast('Dosya okunamadı', 'error');
  reader.readAsText(file);
}

// ---------------------------------------------------------------------------
// Oyun yükleme
// ---------------------------------------------------------------------------

function loadPgnText(text) {
  if (!text || !text.trim()) { toast('Önce bir PGN yapıştırın', 'error'); return; }
  let parsed;
  try {
    parsed = parsePgn(text);
  } catch (e) {
    toast('PGN okunamadı: ' + e.message, 'error');
    return;
  }
  if (!parsed.moves.length) {
    toast('PGN içinde hamle bulunamadı', 'error');
    return;
  }
  if (parsed.errors.length) {
    toast(`${parsed.errors.length}. hamlede hata: "${parsed.errors[0].token}" — analiz buraya kadar yapılacak`, 'info');
  }
  applyGame(parsed);
}

function applyGame(parsed) {
  S.parsed = parsed;
  S.fens = buildPositions(parsed);
  S.analyzer = null;
  S.notes = null;
  S.currentIdx = 0;
  S.explore = null;
  S.abort = true;
  stopPlay();

  $('importView').hidden = true;
  $('reviewView').hidden = false;
  $('coachPane').innerHTML = '<div class="empty-hint">Oyunu analiz ettiğinizde koç notları burada görünecek.</div>';
  $('analyzeBtn').disabled = false;
  $('abortBtn').hidden = true;
  $('progressWrap').hidden = true;

  updatePlayerInfo();
  refreshAiPane();
  renderMoveList();
  S.chart.setData([]);
  showPosition();

  if (S.engine && S.engine.ready) S.engine.newGame();
  toast(`Oyun yüklendi: ${parsed.moves.length} hamle`, 'success');
}

function updatePlayerInfo() {
  const h = S.parsed.headers;
  $('whiteName').textContent = h.White || 'Beyaz';
  $('blackName').textContent = h.Black || 'Siyah';
  $('whiteRating').textContent = h.WhiteElo ? '(' + h.WhiteElo + ')' : '';
  $('blackRating').textContent = h.BlackElo ? '(' + h.BlackElo + ')' : '';
  $('resultLabel').textContent = resultText(S.parsed.result);
  $('moveCountLabel').textContent = S.parsed.moves.length + ' hamle';
  if ($('moveCountLabel2')) $('moveCountLabel2').textContent = S.parsed.moves.length + ' hamle';
  $('whiteAcc').textContent = '—';
  $('blackAcc').textContent = '—';
  setDonut('whiteDonut', 0);
  setDonut('blackDonut', 0);
  $('ghStats').innerHTML = '';
  $('criticalStrip').hidden = true;
  if (S.parsed.moves.length) {
    const open = S.parsed.moves.slice(0, 6).map(m => m.san).join(' ');
    $('openingLabel').textContent = open;
  }
}

function setDonut(id, accuracy) {
  const el = $(id);
  if (!el) return;
  const C = 2 * Math.PI * 18;
  const v = Math.max(0, Math.min(100, accuracy));
  el.style.strokeDasharray = C.toFixed(1);
  el.style.strokeDashoffset = (C * (1 - v / 100)).toFixed(1);
  el.setAttribute('stroke', accuracy >= 90 ? 'var(--green)' : accuracy >= 75 ? 'var(--gold)' : 'var(--red)');
}

function renderGameStats() {
  const stats = $('ghStats');
  if (!S.analyzer) { stats.innerHTML = ''; return; }
  const sum = S.analyzer.summary();
  if (!sum) { stats.innerHTML = ''; return; }
  const order = ['brilliant', 'best', 'excellent', 'good', 'inaccuracy', 'mistake', 'blunder', 'mate'];
  let html = '';
  for (const key of order) {
    const n = (sum.counts.w[key] || 0) + (sum.counts.b[key] || 0);
    if (!n) continue;
    const cls = CLASSES[key];
    html += `<span class="gh-chip" style="--c:${cls.color}" title="${cls.label}"><b>${cls.glyph}</b> ${cls.label} <i>${n}</i></span>`;
  }
  const ph = sum.phaseAccuracy;
  html += `<span class="gh-chip phase" title="Açılış / orta oyun / son oyun doğruluğu (beyaz · siyah)">📊 Açılış %${ph.opening.w.toFixed(0)}/%${ph.opening.b.toFixed(0)} · Orta %${ph.middlegame.w.toFixed(0)}/%${ph.middlegame.b.toFixed(0)} · Son %${ph.endgame.w.toFixed(0)}/%${ph.endgame.b.toFixed(0)}</span>`;
  stats.innerHTML = html;

  setDonut('whiteDonut', sum.accuracy.w);
  setDonut('blackDonut', sum.accuracy.b);
  $('whiteAcc').textContent = '%' + sum.accuracy.w.toFixed(1);
  $('blackAcc').textContent = '%' + sum.accuracy.b.toFixed(1);
}

function renderCritical() {
  const strip = $('criticalStrip');
  const cards = $('criticalCards');
  if (!S.analyzer || !S.analyzer.moves.length) { strip.hidden = true; return; }
  const crit = S.analyzer.moves
    .filter(m => !m.forced && (m.class === 'blunder' || m.class === 'mistake' || m.class === 'inaccuracy'))
    .sort((a, b) => b.winLoss - a.winLoss)
    .slice(0, 6);
  if (!crit.length) { strip.hidden = true; return; }
  strip.hidden = false;
  cards.innerHTML = '';
  for (const m of crit) {
    const cls = CLASSES[m.class];
    const card = document.createElement('button');
    card.className = 'cs-card';
    card.style.setProperty('--c', cls.color);
    const num = Math.ceil((m.ply + 1) / 2) + (m.color === 'w' ? '.' : '...');
    card.innerHTML = `
      <span class="cs-num">${num}</span>
      <span class="cs-san">${escapeHtml(m.san)}</span>
      <span class="cs-badge">${cls.glyph} ${cls.label}</span>
      <span class="cs-loss">−${m.winLoss.toFixed(1)} puan</span>
      <span class="cs-best">en iyi: ${escapeHtml(m.bestSan || '—')}</span>`;
    card.addEventListener('click', () => { S.explore = null; goToMove(m.ply + 1); switchTab('moves'); });
    cards.appendChild(card);
  }
}

function resultText(r) {
  return { '1-0': 'Beyaz kazandı', '0-1': 'Siyah kazandı', '1/2-1/2': 'Beraberlik', '*': 'Devam eden / bilinmiyor' }[r] || r;
}

// ---------------------------------------------------------------------------
// Görünüm
// ---------------------------------------------------------------------------

function showPosition() {
  if (!S.parsed) return;
  const idx = S.currentIdx;
  const fen = S.explore ? S.explore.fen() : S.fens[idx];
  const lastMove = S.explore
    ? (S.explore.history({ verbose: true }).slice(-1)[0] || null)
    : (idx > 0 ? S.parsed.moves[idx - 1].move : null);

  S.board.setLastMove(lastMove ? { from: squareName(lastMove.from), to: squareName(lastMove.to) } : null);
  S.board.setLegalTargets([]);
  S.board.selected = null;
  S.board.clearPromotion();

  // Şah karesi
  const chess = S.explore || new Chess(fen);
  if (isInCheck(chess.pos)) {
    const color = chess.turn();
    S.board.setCheckSquare(squareName(chess.pos.kings[color]));
  } else {
    S.board.setCheckSquare(null);
  }

  // En iyi hamle oku (analiz varsa)
  const analysis = S.analyzer && S.analyzer.moves[idx - 1];
  if (analysis && analysis.best && !S.explore) {
    S.board.setBestArrow({ from: analysis.best.slice(0, 2), to: analysis.best.slice(2, 4) });
  } else {
    S.board.setBestArrow(null);
  }

  S.board.render(fen);

  // Hamle listesi vurgusu
  document.querySelectorAll('.ml-move.active').forEach(el => el.classList.remove('active'));
  if (idx > 0 && !S.explore) {
    const el = document.querySelector(`.ml-move[data-ply="${idx - 1}"]`);
    if (el) {
      el.classList.add('active');
      el.scrollIntoView({ block: 'nearest' });
    }
  }

  // Değerlendirme çubuğu + bilgi kartı
  updateEvalBar(fen, idx);
  updateMoveInfo(idx);
  S.chart.setCurrent(idx - 1);
  $('moveLabel').textContent = idx === 0 ? 'Başlangıç' : `${Math.ceil(idx / 2)}.${idx % 2 === 0 ? '' : '…'} ${S.parsed.moves[idx - 1].san}`;
}

function updateEvalBar(fen, idx) {
  let score = 0, mate = null;
  if (S.analyzer && S.analyzer.moves.length) {
    const i = Math.min(idx, S.analyzer.moves.length) - 1;
    if (i >= 0) {
      const m = S.analyzer.moves[i];
      score = m.evalWhiteBefore;
      mate = m.mateWhiteBefore;
    }
  }
  // beyaz açısından yüzde
  let pct;
  if (mate !== null && mate !== undefined) {
    pct = mate > 0 ? 100 : 0;
  } else {
    pct = 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * score)) - 1);
  }
  $('evalFill').style.width = Math.max(2, Math.min(98, pct)) + '%';
  $('evalLabel').textContent = mate !== null && mate !== undefined
    ? (mate > 0 ? '#' + mate : '-#' + Math.abs(mate))
    : (score > 0 ? '+' : '') + (score / 100).toFixed(2);
}

function updateMoveInfo(idx) {
  const card = $('moveCard');
  if (!S.analyzer || idx === 0 || idx > S.analyzer.moves.length) {
    card.innerHTML = '<div class="card-empty">Bir hamle seçin veya tüm oyunu analiz edin.</div>';
    return;
  }
  const m = S.analyzer.moves[idx - 1];
  const cls = CLASSES[m.class];
  const delta = (m.scoreAfter - m.scoreBefore);
  const share = whiteShare(m.scoreBefore || 0);
  const shareAfter = whiteShare(m.scoreAfter || 0);
  const mover = m.color === 'w' ? 'Beyaz' : 'Siyah';
  const verdict = m.class === 'best' || m.class === 'brilliant' || m.class === 'mate'
    ? `${mover} en iyi hamleyi buldu.`
    : m.class === 'forced'
      ? 'Tek yasal hamle — değerlendirmeye girmez.'
      : `${mover} bu hamlede ${m.winLoss.toFixed(1)} kazanma puanı kaybetti; en iyisi <b>${escapeHtml(m.bestSan || '—')}</b> idi.`;
  card.innerHTML = `
    <div class="mc-head">
      <span class="mc-badge" style="--c:${cls.color}">${cls.glyph} ${cls.label}</span>
      <span class="mc-acc">doğruluk <b>%${m.accuracy.toFixed(1)}</b></span>
    </div>
    <div class="mc-verdict">${verdict}</div>
    <div class="mc-grid">
      <div><span class="mc-k">Oynanan</span><span class="mc-v">${escapeHtml(m.san)}</span></div>
      <div><span class="mc-k">En iyi</span><span class="mc-v best">${escapeHtml(m.bestSan || '—')}</span></div>
      <div><span class="mc-k">Değerlendirme</span><span class="mc-v">${formatScore(m.scoreBefore, m.mateBefore)}</span></div>
      <div><span class="mc-k">Hamle sonrası</span><span class="mc-v">${formatScore(m.scoreAfter, m.mateAfter)}</span></div>
    </div>
    <div class="mc-evalbar" title="Hamle öncesi → sonrası kazanma olasılığı (beyaz)">
      <span class="mc-eval-mark" style="left:${share.toFixed(1)}%"></span>
      <span class="mc-eval-mark after" style="left:${shareAfter.toFixed(1)}%"></span>
      <span class="mc-eval-fill" style="left:${Math.min(share, shareAfter).toFixed(1)}%;width:${Math.abs(shareAfter - share).toFixed(1)}%"></span>
    </div>
    <div class="mc-meta">
      <span class="${delta < -50 ? 'loss' : delta > 50 ? 'gain' : ''}">${delta >= 0 ? '+' : ''}${(delta / 100).toFixed(2)} piyon</span>
      <span>·</span><span>derinlik ${m.depth}</span>
      <span>·</span><span>${Math.round((m.nps || 0) / 1000)}k nps</span>
      <span>·</span><span>${m.phase === 'opening' ? 'açılış' : m.phase === 'endgame' ? 'son oyun' : 'orta oyun'}</span>
    </div>
    ${m.pvSan && m.pvSan.length ? `<div class="mc-pv"><span class="mc-k">Devam çizgisi</span><span class="mc-pv-line">${escapeHtml(m.pvSan.slice(0, 8).join(' '))}</span></div>` : ''}
    ${m.comment ? `<div class="mc-comment">💬 ${escapeHtml(m.comment)}</div>` : ''}
  `;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderMoveList() {
  const container = $('moveList');
  container.innerHTML = '';
  const moves = S.parsed.moves;
  for (let i = 0; i < moves.length; i += 2) {
    const row = document.createElement('div');
    row.className = 'ml-row';
    const num = document.createElement('span');
    num.className = 'ml-num';
    num.textContent = (i / 2 + 1) + '.';
    row.appendChild(num);
    row.appendChild(moveEl(i));
    if (moves[i + 1]) row.appendChild(moveEl(i + 1));
    container.appendChild(row);
  }
  const refresh = S.analyzer && S.analyzer.moves.length ? refreshMoveListClasses : null;
  if (refresh) refresh();
}

function whiteShare(cp) {
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

function moveEl(ply) {
  const m = S.parsed.moves[ply];
  const el = document.createElement('button');
  el.className = 'ml-move';
  el.dataset.ply = ply;
  el.addEventListener('click', () => { S.explore = null; goToMove(ply + 1); });
  el.appendChild(span('ml-san', m.san));

  const analysis = S.analyzer && S.analyzer.moves[ply];
  if (analysis) {
    const cls = CLASSES[analysis.class];
    el.classList.add('cls-' + analysis.class);
    el.title = `${cls.label} · ${analysis.bestSan ? 'en iyi ' + analysis.bestSan : ''} · kazanma kaybı ${analysis.winLoss.toFixed(1)} puan`;
    el.appendChild(span('ml-glyph', cls.glyph, `color:${cls.color}`));

    // Değerlendirme çubuğu: merkezden avantajlı tarafa doğru dolar
    const bar = document.createElement('span');
    bar.className = 'ml-bar';
    const share = whiteShare(analysis.scoreBefore || 0);
    const fill = document.createElement('span');
    fill.className = 'ml-bar-fill ' + (share >= 50 ? 'white' : 'black');
    fill.style.width = Math.min(50, Math.abs(share - 50) * 2) + '%';
    fill.style[share >= 50 ? 'right' : 'left'] = '50%';
    bar.appendChild(fill);
    el.appendChild(bar);

    // Doğruluk yüzdesi
    const acc = span('ml-acc', analysis.forced ? '' : '%' + analysis.accuracy.toFixed(0));
    acc.style.color = cls.color;
    el.appendChild(acc);
  } else {
    el.title = m.comment || '';
    el.appendChild(span('ml-spacer'));
  }
  if (m.comment) el.title = m.comment;
  return el;
}

function span(cls, text, style) {
  const e = document.createElement('span');
  e.className = cls;
  if (text != null) e.textContent = text;
  if (style) e.setAttribute('style', style);
  return e;
}

// Analiz bittikten sonra listeyi barlarla yeniden çiz
function refreshMoveListClasses() {
  const container = $('moveList');
  if (!container) return;
  container.innerHTML = '';
  const moves = S.parsed.moves;
  for (let i = 0; i < moves.length; i += 2) {
    const row = document.createElement('div');
    row.className = 'ml-row';
    const num = document.createElement('span');
    num.className = 'ml-num';
    num.textContent = (i / 2 + 1) + '.';
    row.appendChild(num);
    row.appendChild(moveEl(i));
    if (moves[i + 1]) row.appendChild(moveEl(i + 1));
    container.appendChild(row);
  }
}

// ---------------------------------------------------------------------------
// Gezinme
// ---------------------------------------------------------------------------

function goMove(delta) {
  const next = Math.max(0, Math.min(S.parsed.moves.length, S.currentIdx + delta));
  S.explore = null;
  goToMove(next);
}

function goToMove(idx) {
  S.currentIdx = Math.max(0, Math.min(S.parsed.moves.length, idx));
  S.explore = null;
  updateExploreBadge();
  showPosition();
}

function togglePlay() {
  S.playing = !S.playing;
  $('playBtn').textContent = S.playing ? '⏸' : '▶';
  if (S.playing) {
    if (S.currentIdx >= S.parsed.moves.length) goToMove(0);
    S.playTimer = setInterval(() => {
      if (S.currentIdx >= S.parsed.moves.length) { togglePlay(); return; }
      goMove(1);
    }, S.settings.speed);
  } else {
    stopPlay();
  }
}

function stopPlay() {
  if (S.playTimer) { clearInterval(S.playTimer); S.playTimer = null; }
  S.playing = false;
  $('playBtn').textContent = '▶';
}

function onKeyDown(e) {
  if ($('reviewView').hidden) return;
  if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
  if (e.key === 'ArrowLeft') { goMove(-1); e.preventDefault(); }
  else if (e.key === 'ArrowRight') { goMove(1); e.preventDefault(); }
  else if (e.key === 'Home') { goToMove(0); e.preventDefault(); }
  else if (e.key === 'End') { goToMove(S.parsed.moves.length); e.preventDefault(); }
  else if (e.key === ' ') { togglePlay(); e.preventDefault(); }
  else if (e.key === 'f' || e.key === 'F') { S.board.flip(); showPosition(); }
  else if (e.key === 'Escape') { S.explore = null; goToMove(S.currentIdx); }
}

// ---------------------------------------------------------------------------
// Keşif modu (tahtada hamle deneme)
// ---------------------------------------------------------------------------

function onSquareClick(sq) {
  if (!S.parsed) return;
  const chess = S.explore || new Chess(S.fens[S.currentIdx]);
  const piece = chess.get(sq);

  if (S.board.selected) {
    const from = S.board.selected;
    const mv = chess.moves({ verbose: true }).find(m => m.from === sqIndex(from) && m.to === sqIndex(sq));
    if (mv) {
      if (mv.isPromo) {
        S.board.showPromotion(from, sq, chess.turn());
        return;
      }
      chess.move({ from, to: sq });
      S.explore = chess;
      S.board.setLastMove({ from, to: sq });
      updateExploreBadge();
      showPosition();
      return;
    }
    if (sq === from) { S.board.selected = null; S.board.setLegalTargets([]); S.board.render(S.explore ? S.explore.fen() : S.fens[S.currentIdx]); return; }
  }

  if (piece && piece.color === chess.turn()) {
    S.board.selected = sq;
    const targets = chess.moves({ verbose: true, square: sq })
      .map(m => ({ to: squareName(m.to), capture: !!(m.captured || m.isEP) }));
    S.board.setLegalTargets(targets);
    S.board.render(chess.fen());
  } else {
    S.board.selected = null;
    S.board.setLegalTargets([]);
    S.board.render(chess.fen());
  }
}

function sqIndex(name) {
  return (8 - Number(name[1])) * 8 + 'abcdefgh'.indexOf(name[0]);
}

function updateExploreBadge() {
  const badge = $('exploreBadge');
  if (S.explore) {
    const hist = S.explore.history();
    badge.hidden = false;
    badge.textContent = `Keşif modu: ${hist.length} hamle oynadınız — Esc ile oyuna dönün`;
  } else {
    badge.hidden = true;
  }
}

async function playEngineMove() {
  if (!S.engine || !S.engine.ready) { toast('Motor hazır değil', 'error'); return; }
  const chess = S.explore || new Chess(S.fens[S.currentIdx]);
  $('engineStatus').textContent = 'Motor düşünüyor…';
  try {
    const r = await S.engine.analyze(chess.fen(), 600);
    if (r.best) {
      const mv = moveFromUci(chess.pos, r.best);
      if (mv) {
        chess.move(mv.san);
        S.explore = chess;
        S.board.setBestArrow({ from: r.best.slice(0, 2), to: r.best.slice(2, 4) });
        updateExploreBadge();
        showPosition();
      }
    }
  } catch (e) {
    toast('Motor hatası: ' + e.message, 'error');
  } finally {
    $('engineStatus').textContent = S.engine && S.engine.ready ? 'Motor hazır' : 'Motor hatası';
  }
}

// ---------------------------------------------------------------------------
// Analiz
// ---------------------------------------------------------------------------

async function startAnalysis() {
  if (!S.engine || !S.engine.ready) { toast('Motor henüz hazır değil', 'error'); return; }
  if (S.analyzing) return;
  S.analyzing = true;
  S.abort = false;
  $('analyzeBtn').disabled = true;
  $('abortBtn').hidden = false;
  $('progressWrap').hidden = false;
  $('progressBar').style.width = '0%';
  $('progressText').textContent = 'Hazırlanıyor…';

  const movetime = S.settings.movetime;
  const analyzer = new GameAnalyzer(S.parsed, S.fens);

  try {
    await analyzer.run({
      engine: S.engine,
      movetime,
      signal: { get aborted() { return S.abort; } },
      onProgress: (done, total, text) => {
        $('progressBar').style.width = Math.round((done / total) * 100) + '%';
        $('progressText').textContent = text;
      }
    });
    if (S.abort) {
      toast('Analiz durduruldu', 'info');
    } else {
      S.analyzer = analyzer;
      S.notes = generateCoachNotes(analyzer, S.parsed.headers, S.parsed.result);
      refreshMoveListClasses();
      refreshAiPane();
      renderCoach();
      renderSummary();
      renderGameStats();
      renderCritical();
      S.chart.setData(analyzer.moves);
      showPosition();
      toast('Analiz tamamlandı', 'success');
      switchTab('coach');
    }
  } catch (e) {
    toast('Analiz hatası: ' + e.message, 'error');
  } finally {
    S.analyzing = false;
    $('analyzeBtn').disabled = false;
    $('abortBtn').hidden = true;
    $('progressWrap').hidden = true;
  }
}

function renderSummary() {
  const s = S.analyzer.summary();
  if (!s) return;
  $('whiteAcc').textContent = '%' + s.accuracy.w.toFixed(1) + ' doğruluk';
  $('blackAcc').textContent = '%' + s.accuracy.b.toFixed(1) + ' doğruluk';
  $('summaryPane').innerHTML = `
    <div class="sum-grid">
      <div class="sum-card">
        <div class="sum-title">Doğruluk</div>
        <div class="sum-acc">
          <div><span class="dot white"></span> %${s.accuracy.w.toFixed(1)}</div>
          <div><span class="dot black"></span> %${s.accuracy.b.toFixed(1)}</div>
        </div>
      </div>
      <div class="sum-card">
        <div class="sum-title">Hatalar</div>
        <div class="sum-counts">
          <span class="chip blunder">?? ${s.blunders.w + s.blunders.b}</span>
          <span class="chip mistake">? ${s.mistakes.w + s.mistakes.b}</span>
          <span class="chip inaccuracy">?! ${s.inaccuracies.w + s.inaccuracies.b}</span>
        </div>
      </div>
      <div class="sum-card">
        <div class="sum-title">Fazlar (beyaz/siyah)</div>
        <div class="sum-phases">
          <div>Açılış: %${s.phaseAccuracy.opening.w.toFixed(0)} / %${s.phaseAccuracy.opening.b.toFixed(0)}</div>
          <div>Orta oyun: %${s.phaseAccuracy.middlegame.w.toFixed(0)} / %${s.phaseAccuracy.middlegame.b.toFixed(0)}</div>
          <div>Son oyun: %${s.phaseAccuracy.endgame.w.toFixed(0)} / %${s.phaseAccuracy.endgame.b.toFixed(0)}</div>
        </div>
      </div>
    </div>`;
}

function renderCoach() {
  if (!S.notes) return;
  const el = $('coachPane');
  let html = '';
  if (S.analyzer.opening) {
    html += `<div class="coach-opening">Açılış: <strong>${escapeHtml(S.analyzer.opening.name)}</strong> <span class="eco">${S.analyzer.opening.eco}</span></div>`;
  }
  for (const sec of S.notes.sections) {
    html += `<div class="coach-section"><h4>${escapeHtml(sec.title)}</h4><ul>`;
    for (const item of sec.items) html += `<li>${escapeHtml(item)}</li>`;
    html += '</ul></div>';
  }
  el.innerHTML = html;
}

// ---------------------------------------------------------------------------
// AI Koç (Cloudflare Worker + Gemini)
// ---------------------------------------------------------------------------

function aiStatus(text, type) {
  const el = $('aiStatus');
  if (!el) return;
  el.textContent = text || '';
  el.className = 'ai-status' + (type ? ' ' + type : '');
}

function refreshAiPane() {
  const configured = S.aiCoach.isConfigured();
  $('aiSetup').hidden = configured;
  $('aiRun').hidden = !configured;
  if (configured) {
    $('aiWorkerUrl').value = S.aiCoach.getWorkerUrl();
    $('aiCostHint').textContent = S.analyzer && S.analyzer.moves.length
      ? `${S.analyzer.moves.length} hamlenin analizi gönderilecek`
      : 'Önce oyunu analiz edin';
  }
}

async function saveAiWorkerUrl() {
  const url = $('aiWorkerUrl').value.trim();
  if (!url) { aiStatus('Bir adres girin', 'error'); return; }
  if (!/^https?:\/\//.test(url)) { aiStatus('Adres http:// veya https:// ile başlamalı', 'error'); return; }
  S.aiCoach.setWorkerUrl(url);
  aiStatus('Kaydedildi. Bağlantı test ediliyor…');
  await testAiWorkerUrl();
}

async function testAiWorkerUrl() {
  aiStatus('Test ediliyor…');
  try {
    const health = await S.aiCoach.checkHealth();
    if (!health.keyConfigured) {
      aiStatus('Worker ayakta ama GEMINI_API_KEY tanımlı değil: npx wrangler secret put GEMINI_API_KEY', 'error');
      return;
    }
    aiStatus(`Bağlantı tamam · model: ${health.model || '?'}`, 'ok');
    refreshAiPane();
  } catch (e) {
    aiStatus(e.message, 'error');
  }
}

async function generateAiCoach() {
  if (!S.analyzer) { aiStatus('Önce oyunu analiz edin', 'error'); switchTab('coach'); return; }
  const payload = buildCoachPayload(S.analyzer, S.parsed.headers, S.parsed.result);
  if (!payload) { aiStatus('Analiz verisi yok', 'error'); return; }

  S.aiAbort = new AbortController();
  $('aiGenerateBtn').disabled = true;
  $('aiCancelBtn').hidden = false;
  $('aiProgress').hidden = false;
  $('aiProgressBar').style.width = '35%';
  $('aiProgressText').textContent = 'Yapay zeka düşünüyor…';
  $('aiOutput').innerHTML = '';

  try {
    const res = await S.aiCoach.generate(payload, { signal: S.aiAbort.signal });
    $('aiProgressBar').style.width = '100%';
    $('aiOutput').innerHTML = renderCoachHtml(res.coach, res);
    aiStatus('', '');
  } catch (e) {
    const friendly = e instanceof AiCoachError
      ? e.message
      : 'Beklenmeyen hata: ' + e.message;
    $('aiOutput').innerHTML = `<div class="ai-error">⚠ ${escapeHtml(friendly)}</div>`;
  } finally {
    $('aiGenerateBtn').disabled = false;
    $('aiCancelBtn').hidden = true;
    $('aiProgress').hidden = true;
    S.aiAbort = null;
  }
}

// ---------------------------------------------------------------------------
// Sekmeler / tema / dışa aktarma
// ---------------------------------------------------------------------------

function switchTab(tab) {
  document.querySelectorAll('.tab-button').forEach(b => {
    const active = b.dataset.tab === tab;
    b.classList.toggle('active', active);
    b.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  document.querySelectorAll('.tab-pane').forEach(p => { p.hidden = p.dataset.pane !== tab; });
}

function applyTheme() {
  document.documentElement.dataset.theme = S.settings.theme;
  $('themeBtn').textContent = S.settings.theme === 'dark' ? '☀' : '☾';
}

function toggleTheme() {
  S.settings.theme = S.settings.theme === 'dark' ? 'light' : 'dark';
  saveSettings();
  applyTheme();
}

function backToImport() {
  stopPlay();
  S.abort = true;
  $('reviewView').hidden = true;
  $('importView').hidden = false;
}

function exportPgn() {
  if (!S.parsed) return;
  const text = serializePgn({
    headers: S.parsed.headers,
    moves: S.parsed.moves.map(m => m.san),
    result: S.parsed.result
  });
  downloadFile((S.parsed.headers.White || 'oyun') + '-' + (S.parsed.headers.Black || 'vezir') + '.pgn', text);
  toast('PGN indirildi', 'success');
}

function exportReport() {
  if (!S.notes) { toast('Önce oyunu analiz edin', 'error'); return; }
  downloadFile('analiz-raporu.md', S.notes.markdown);
  toast('Rapor indirildi', 'success');
}

function downloadFile(name, content) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// ---------------------------------------------------------------------------
// Uzaktan oyunlar
// ---------------------------------------------------------------------------

async function fetchChesscom() {
  const user = $('ccUser').value.trim();
  if (!user) { toast('Kullanıcı adı girin', 'error'); return; }
  const list = $('remoteList');
  list.innerHTML = '<div class="hint">Yükleniyor…</div>';
  try {
    const archivesResp = await fetch(`https://api.chess.com/pub/player/${encodeURIComponent(user)}/games/archives`);
    if (!archivesResp.ok) throw new Error('Kullanıcı bulunamadı (' + archivesResp.status + ')');
    const archives = await archivesResp.json();
    const url = archives.archives && archives.archives[archives.archives.length - 1];
    if (!url) throw new Error('Oyun arşivi yok');
    const resp = await fetch(url);
    const data = await resp.json();
    const games = (data.games || []).slice(-25).reverse();
    renderRemoteList(games.map(g => ({
      label: `${g.white.username} (${g.white.rating || '?'}) – ${g.black.username} (${g.black.rating || '?'})`,
      meta: `${g.time_class || ''} · ${g.end_time ? new Date(g.end_time * 1000).toLocaleDateString('tr-TR') : ''}`,
      pgn: g.pgn
    })));
  } catch (e) {
    list.innerHTML = `<div class="hint error">Hata: ${escapeHtml(e.message)} (çevrimdışı mısınız?)</div>`;
  }
}

async function fetchLichess() {
  const user = $('liUser').value.trim();
  if (!user) { toast('Kullanıcı adı girin', 'error'); return; }
  const list = $('remoteList');
  list.innerHTML = '<div class="hint">Yükleniyor…</div>';
  try {
    const resp = await fetch(`https://lichess.org/api/games/user/${encodeURIComponent(user)}?max=25&pgnInJson=true`, {
      headers: { Accept: 'application/x-ndjson' }
    });
    if (!resp.ok) throw new Error('Kullanıcı bulunamadı (' + resp.status + ')');
    const text = await resp.text();
    const games = text.trim().split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    renderRemoteList(games.map(g => ({
      label: `${g.players?.white?.user?.name || '?'} – ${g.players?.black?.user?.name || '?'}`,
      meta: `${g.speed || ''} · ${g.winner ? (g.winner === 'white' ? '1-0' : '0-1') : '1/2-1/2'}`,
      pgn: g.pgn
    })));
  } catch (e) {
    list.innerHTML = `<div class="hint error">Hata: ${escapeHtml(e.message)} (çevrimdışı mısınız?)</div>`;
  }
}

function renderRemoteList(games) {
  const list = $('remoteList');
  if (!games.length) { list.innerHTML = '<div class="hint">Oyun bulunamadı</div>'; return; }
  list.innerHTML = '';
  for (const g of games) {
    const item = document.createElement('button');
    item.className = 'remote-item';
    item.innerHTML = `<span class="ri-label">${escapeHtml(g.label)}</span><span class="ri-meta">${escapeHtml(g.meta || '')}</span>`;
    item.addEventListener('click', () => loadPgnText(g.pgn));
    list.appendChild(item);
  }
}

// ---------------------------------------------------------------------------
// Örnek oyunlar
// ---------------------------------------------------------------------------

function renderSamples() {
  const el = $('sampleList');
  el.innerHTML = '';
  for (const g of sampleGames()) {
    const btn = document.createElement('button');
    btn.className = 'sample-item';
    btn.innerHTML = `<span class="si-title">${escapeHtml(g.title)}</span><span class="si-note">${escapeHtml(g.note || '')}</span>`;
    btn.addEventListener('click', () => loadPgnText(g.pgn));
    el.appendChild(btn);
  }
}

// ---------------------------------------------------------------------------
// Bildirim
// ---------------------------------------------------------------------------

function toast(message, type = 'info') {
  const container = $('toastContainer');
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 300);
  }, 3600);
}

document.addEventListener('DOMContentLoaded', init);
