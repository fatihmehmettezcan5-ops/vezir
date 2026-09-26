// js/ai-coach.js
// AI Koç: analiz verisini Cloudflare Worker'a gönderir, Gemini'nin ürettiği
// Türkçe koç yorumunu alır ve görüntüler.
//
// NOT: API anahtarı asla burada tutulmaz. Anahtar sunucudaki (Worker) env
// değişkenindedir; tarayıcı yalnızca worker adresini bilir.

const WORKER_URL_KEY = 'vezir.workerUrl';
const REQUEST_TIMEOUT_MS = 90000;

export class AiCoachError extends Error {
  constructor(message, code) { super(message); this.name = 'AiCoachError'; this.code = code; }
}

export class AiCoach {
  constructor(storage) {
    this._storage = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
    this.lastUsage = null;
  }

  getWorkerUrl() {
    try { return (this._storage && this._storage.getItem(WORKER_URL_KEY)) || ''; }
    catch (e) { return ''; }
  }

  setWorkerUrl(url) {
    const clean = String(url || '').trim().replace(/\/+$/, '');
    try { this._storage && this._storage.setItem(WORKER_URL_KEY, clean); } catch (e) { /* yoksay */ }
    return clean;
  }

  clearWorkerUrl() {
    try { this._storage && this._storage.removeItem(WORKER_URL_KEY); } catch (e) { /* yoksay */ }
  }

  isConfigured() { return this.getWorkerUrl().length > 0; }

  // Worker ayakta mı, model ve anahtar tanımlı mı?
  async checkHealth() {
    const base = this.getWorkerUrl();
    if (!base) throw new AiCoachError('Worker adresi ayarlanmamış', 'not_configured');
    let resp;
    try {
      resp = await fetchWithTimeout(base + '/health', { method: 'GET' }, 10000);
    } catch (e) {
      throw new AiCoachError('Worker\'a ulaşılamadı. Adres doğru mu ve worker deploy edilmiş mi?', 'unreachable');
    }
    if (!resp.ok) throw new AiCoachError(`Worker /health ${resp.status} döndü`, 'health_' + resp.status);
    return resp.json();
  }

  // payload: buildCoachPayload() çıktısı
  async generate(payload, options = {}) {
    const base = this.getWorkerUrl();
    if (!base) throw new AiCoachError('Önce "AI Koç" sekmesinden worker adresini kaydedin.', 'not_configured');
    if (!payload || !payload.moves || !payload.moves.length) {
      throw new AiCoachError('Analiz verisi yok — önce oyunu analiz edin.', 'no_analysis');
    }

    const signal = options.signal;
    let resp;
    try {
      resp = await fetchWithTimeout(base + '/coach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }, REQUEST_TIMEOUT_MS, signal);
    } catch (e) {
      if (e && e.name === 'AbortError') throw new AiCoachError('İstek iptal edildi', 'aborted');
      throw new AiCoachError('Worker\'a ulaşılamadı (internet bağlantınızı veya adresi kontrol edin).', 'unreachable');
    }

    let data = null;
    try { data = await resp.json(); } catch (e) { /* düz metin olabilir */ }

    if (!resp.ok || !data || data.ok !== true) {
      const msg = (data && data.error) || `Worker ${resp.status} hatası döndü`;
      throw new AiCoachError(msg, (data && data.code) || 'http_' + resp.status);
    }

    this.lastUsage = data.usage || null;
    return data;
  }
}

// Analiz sonucunu worker'ın beklediği kompakt forma çevir
export function buildCoachPayload(analyzer, headers, result) {
  if (!analyzer || !analyzer.moves || !analyzer.moves.length) return null;
  const summary = analyzer.summary() || {};
  const moves = analyzer.moves.slice(0, 80).map((m, i) => ({
    n: i + 1,
    san: m.san,
    best: m.bestSan || '',
    cls: m.class,
    score: Math.round(m.scoreBefore || 0),
    scoreAfter: Math.round(m.scoreAfter || 0),
    loss: Math.round(m.winLoss || 0),
    phase: m.phase,
    color: m.color
  }));
  return {
    white: (headers && headers.White) || 'Beyaz',
    black: (headers && headers.Black) || 'Siyah',
    result: result || '*',
    opening: (analyzer.opening && analyzer.opening.name) || '',
    accuracy: summary.accuracy
      ? { w: Math.round(summary.accuracy.w), b: Math.round(summary.accuracy.b) }
      : null,
    moves
  };
}

// Koç yorumunu HTML'e çevir
export function renderCoachHtml(coach, meta) {
  const esc = (s) => String(s == null ? '' : s)
    .replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const list = (items) => Array.isArray(items) && items.length
    ? `<ul class="ai-list">${items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>`
    : '<p class="ai-muted">—</p>';

  const moments = Array.isArray(coach.keyMoments) && coach.keyMoments.length
    ? coach.keyMoments.map(k => `
        <div class="ai-moment">
          <div class="ai-moment-move">${esc(k.move)}</div>
          <div class="ai-moment-body">
            <p><strong>Ne oldu:</strong> ${esc(k.what)}</p>
            <p><strong>Neden:</strong> ${esc(k.why)}</p>
            <p class="ai-better"><strong>Daha iyisi:</strong> ${esc(k.better)}</p>
          </div>
        </div>`).join('')
    : '<p class="ai-muted">—</p>';

  const foot = meta && meta.model
    ? `<div class="ai-foot">Model: ${esc(meta.model)}${meta.usage ? ` · ${meta.usage.promptTokens} girdi + ${meta.usage.outputTokens} çıktı token` : ''} · Yapay zeka hata yapabilir; motor bulguları esas alınır.</div>`
    : '<div class="ai-foot">Yapay zeka hata yapabilir; motor bulguları esas alınır.</div>';

  return `
    <div class="ai-coach">
      <div class="ai-block">
        <h4>Genel değerlendirme</h4>
        <p>${esc(coach.overall)}</p>
      </div>
      ${coach.estimatedLevel ? `<div class="ai-block"><h4>Tahmini seviye</h4><p>${esc(coach.estimatedLevel)}</p></div>` : ''}
      <div class="ai-cols">
        <div class="ai-block"><h4>Güçlü yönler</h4>${list(coach.strengths)}</div>
        <div class="ai-block"><h4>Geliştirilecek yönler</h4>${list(coach.weaknesses)}</div>
      </div>
      <div class="ai-block"><h4>Kritik anlar</h4>${moments}</div>
      <div class="ai-block"><h4>Çalışma planı</h4>${list(coach.studyPlan)}</div>
      ${foot}
    </div>`;
}

async function fetchWithTimeout(url, options, timeoutMs, signal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', onAbort);
  }
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}
