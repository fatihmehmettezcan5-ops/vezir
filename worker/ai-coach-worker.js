// worker/ai-coach-worker.js
// ---------------------------------------------------------------------------
// Vezir "AI Koç" için Cloudflare Worker.
//
// Görevi: Tarayıcıdan gelen YAPILANDIRILMIŞ analiz verisini alıp Google Gemini
// ile koç yorumu üretmek. API anahtarı burada (env.GEMINI_API_KEY) durur;
// tarayıcıya asla gönderilmez.
//
// Deploy:
//   cd worker
//   npm i -D wrangler            # veya: npx wrangler
//   npx wrangler secret put GEMINI_API_KEY
//   npx wrangler deploy
//
// Protokol:
//   GET  /health            -> { ok: true, model }
//   POST /coach             -> { ok: true, coach: {...}, model, usage }
//   OPTIONS /coach          -> CORS preflight
//
// Hata durumları: 400 (bozuk istek), 405, 413 (çok büyük), 429 (limit),
//                 502 (Gemini hatası), 500 (yapılandırma)
// ---------------------------------------------------------------------------

const MAX_BODY_BYTES = 64 * 1024;      // analiz verisi en fazla 64 KB
const MAX_MOVES = 80;                  // en fazla 80 hamle gönderilir
// NOT (2026-09): gemini-2.5-* modelleri yeni kullanıcılara kapatıldı (404).
// Yapay zeka modelleri hızlı değiştiği için bir yedek zinciri tutuyoruz:
// yapılandırılmış model 404/503 verirse sıradakini deneriz.
const DEFAULT_MODEL = 'gemini-3.8-flash';
const MODEL_FALLBACKS = ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.5-flash', 'gemini-flash-latest'];
const MAX_ATTEMPTS = 2;                // model başına deneme (503/429 üzerinden)
const RETRY_DELAY_MS = 2500;
const DAILY_LIMIT = 40;                // IP başına günlük istek

// --- Basit günlük kota (bellek içi; isolate başına yaklaşıktır) ------------
const buckets = new Map();             // ip -> { day, count }

function rateLimit(ip, limit) {
  const day = Math.floor(Date.now() / 86400000);
  let b = buckets.get(ip);
  if (!b || b.day !== day) { b = { day, count: 0 }; buckets.set(ip, b); }
  b.count += 1;
  return { allowed: b.count <= limit, remaining: Math.max(0, limit - b.count) };
}

function originAllowed(origin, list) {
  if (!origin) return false;
  for (const entry of list) {
    if (entry === '*') return true;
    // "https://*.vezir.pages.dev" gibi joker girişler: Cloudflare Pages'in her
    // deploy önizlemesi farklı alt alan adı aldığı için gerekli. Joker hem
    // "vezir.pages.dev" hem "abc123.vezir.pages.dev" ile eşleşir;
    // "vezir.pages.dev.evil.com" ile EŞLEŞMEZ.
    if (entry.includes('*.')) {
      const sep = entry.indexOf('://');
      const scheme = sep === -1 ? '' : entry.slice(0, sep);
      const host = (sep === -1 ? entry : entry.slice(sep + 3)).replace(/^\*\./, '');
      if (scheme && !origin.startsWith(scheme + '://')) continue;
      const originHost = scheme ? origin.slice(scheme.length + 3) : origin;
      if (originHost === host || originHost.endsWith('.' + host)) return true;
      continue;
    }
    if (entry === origin) return true;
  }
  return false;
}

function corsHeaders(origin, env) {
  const allow = (env && env.ALLOWED_ORIGINS) || '*';
  const list = allow.split(',').map(s => s.trim()).filter(Boolean);
  const ok = list.includes('*') || originAllowed(origin, list);
  return {
    // İzinsiz origin'e izinli bir adres döneriz: tarayıcı eşleşmeyince isteği engeller.
    'Access-Control-Allow-Origin': ok ? origin : (list[0] || '*'),
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}

function json(data, status, origin, env) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders(origin, env) }
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// --- Girdi doğrulama -------------------------------------------------------

function toStr(v, max = 120) {
  if (typeof v !== 'string') return '';
  return v.trim().slice(0, max);
}

function toNum(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

// Tarayıcıdan gelen hamle listesini güvenli hale getir (tip sızıntısı yok)
function sanitizeMoves(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, MAX_MOVES).map((m, i) => ({
    n: i + 1,
    san: toStr(m && m.san, 12),
    best: toStr(m && m.best, 12),
    cls: toStr(m && m.cls, 16),
    score: Math.round(toNum(m && m.score)),
    scoreAfter: Math.round(toNum(m && m.scoreAfter)),
    loss: Math.round(toNum(m && m.loss, 0)),
    phase: toStr(m && m.phase, 16),
    color: m && m.color === 'b' ? 'b' : 'w'
  })).filter(m => m.san);
}

// --- Koç istemi (sunucuda: kişiliği anahtar gerektirmeden güncelleyebiliriz)

const SYSTEM_INSTRUCTION = `Sen deneyimli ve sabırlı bir satranç koçusun. Sana bir oyunun
YAPILANDIRILMIŞ analiz verisi verilecek: her hamle için motorun değerlendirmesi
(centipawn), en iyi hamle, kazanma olasılığı kaybı ve hamlenin sınıfı.

Kurallar:
- Yalnızca VERİLEN analiz verisini kullan. Yeni hamleler, açılışlar veya varyasyonlar UYDURMA.
- Motorun zaten bulduğu hataları yeniden keşfetmeye çalışma; açıkla ve ders çıkar.
- Sayısal değerleri centipawn cinsinden verilmiş gibi kullan; "2.5 piyon" gibi okunur
  biçimlere çevirebilirsin (1 piyon = 100 centipawn).
- Türkçe yaz. Samimi ama profesyonel ol; oyuncuyu küçümseme.
- Somut ol: her noktada hangi hamle, hangi fikir, hangi alıştırma.
- Oyunun sonucunu ve oyuncuların güçlerini göz önünde bulundur.`;

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    overall: { type: 'string', description: '2-4 cümlelik genel değerlendirme' },
    strengths: { type: 'array', items: { type: 'string' }, description: '2-4 madde' },
    weaknesses: { type: 'array', items: { type: 'string' }, description: '2-4 madde' },
    keyMoments: {
      type: 'array',
      description: 'En kritik 3-5 hamle, sıralı',
      items: {
        type: 'object',
        properties: {
          move: { type: 'string', description: 'örn. 15. Bc4' },
          what: { type: 'string', description: 'Ne oldu' },
          why: { type: 'string', description: 'Neden kötü/iyi' },
          better: { type: 'string', description: 'Ne yapmalıydı' }
        },
        required: ['move', 'what', 'why', 'better']
      }
    },
    studyPlan: { type: 'array', items: { type: 'string' }, description: '3-5 somut alıştırma' },
    estimatedLevel: { type: 'string', description: 'örn. 1500-1700' }
  },
  required: ['overall', 'strengths', 'weaknesses', 'keyMoments', 'studyPlan', 'estimatedLevel']
};

function buildUserPrompt(data) {
  const parts = [];
  parts.push(`OYUNCULAR: ${data.white} (beyaz) — ${data.black} (siyah)`);
  parts.push(`SONUÇ: ${data.result}${data.opening ? ` · AÇILIŞ: ${data.opening}` : ''}`);
  if (data.accuracy) {
    parts.push(`DOĞRULUK: beyaz %${data.accuracy.w} · siyah %${data.accuracy.b}`);
  }
  const bad = data.moves.filter(m => m.cls === 'blunder' || m.cls === 'mistake' || m.cls === 'inaccuracy');
  if (bad.length) {
    parts.push(`\nHATALI/ŞÜPHELİ HAMLELER (${bad.length} adet):`);
    for (const m of bad) {
      const num = m.color === 'w' ? `${Math.ceil(m.n / 2)}.` : `${Math.ceil(m.n / 2)}...`;
      parts.push(`- ${num} ${m.san} [${m.cls}] değerlendirme ${(m.score / 100).toFixed(2)} → ${(m.scoreAfter / 100).toFixed(2)} piyon, kazanma kaybı ${m.loss} puan, en iyi: ${m.best || '?'} (${m.phase})`);
    }
  }
  parts.push(`\nTÜM HAMLELER (${data.moves.length}):`);
  const line = data.moves.map((m) => {
    const num = m.color === 'w' ? `${Math.ceil(m.n / 2)}.` : `${Math.ceil(m.n / 2)}...`;
    return `${num}${m.san}`;
  }).join(' ');
  parts.push(line);
  parts.push('\nLütfen yukarıdaki şemaya uygun JSON üret.');
  return parts.join('\n');
}

// --- Ana işleyici ----------------------------------------------------------

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin');
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin, env) });
    }

    if (url.pathname === '/health' || url.pathname === '/') {
      return json({
        ok: true,
        model: (env && env.GEMINI_MODEL) || DEFAULT_MODEL,
        keyConfigured: Boolean(env && env.GEMINI_API_KEY)
      }, 200, origin, env);
    }

    if (url.pathname !== '/coach') {
      return json({ ok: false, error: 'Bilinmeyen yol: ' + url.pathname }, 404, origin, env);
    }

    if (request.method !== 'POST') {
      return json({ ok: false, error: 'POST gerekli' }, 405, origin, env);
    }

    const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('x-forwarded-for') || '0.0.0.0';
    const limit = Number(env && env.RATE_LIMIT) > 0 ? Number(env.RATE_LIMIT) : DAILY_LIMIT;
    const rl = rateLimit(ip, limit);
    if (!rl.allowed) {
      return json({ ok: false, error: `Günlük kullanım limitine ulaştınız (${limit} istek/gün). Yarın tekrar deneyin.`, code: 'rate_limited' }, 429, origin, env);
    }

    if (!env || !env.GEMINI_API_KEY) {
      return json({ ok: false, error: 'Sunucuda GEMINI_API_KEY tanımlı değil. wrangler secret put GEMINI_API_KEY', code: 'no_key' }, 500, origin, env);
    }

    let body;
    try {
      body = await request.json();
    } catch (e) {
      return json({ ok: false, error: 'Geçersiz JSON gövdesi', code: 'bad_json' }, 400, origin, env);
    }

    if (!body || typeof body !== 'object') {
      return json({ ok: false, error: 'Boş istek' }, 400, origin, env);
    }

    const data = {
      white: toStr(body.white, 80) || 'Beyaz',
      black: toStr(body.black, 80) || 'Siyah',
      result: toStr(body.result, 24) || '*',
      opening: toStr(body.opening, 120),
      accuracy: body.accuracy && typeof body.accuracy === 'object'
        ? { w: Math.round(toNum(body.accuracy.w, 0)), b: Math.round(toNum(body.accuracy.b, 0)) }
        : null,
      moves: sanitizeMoves(body.moves)
    };

    if (!data.moves.length) {
      return json({ ok: false, error: 'Hamle verisi yok' }, 400, origin, env);
    }

    const geminiBody = {
      systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
      contents: [{ role: 'user', parts: [{ text: buildUserPrompt(data) }] }],
      generationConfig: {
        temperature: 0.35,
        topP: 0.9,
        // Gemini 3.x "düşünen" modellerdir: düşünme token'ları çıktı bütçesini
        // yiyordu ve JSON yerine "Here is the JSON..." gibi bir cümle dönüyordu.
        // 8K bütçe + 1K düşünme ile şemaya uygun tam JSON üretiyor.
        maxOutputTokens: 8192,
        thinkingConfig: { thinkingBudget: 1024 },
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA
      }
    };

    // --- Gemini çağrısı: yeniden deneme + model yedeği ----------------------
    const wanted = (env.GEMINI_MODEL || DEFAULT_MODEL).replace(/[^a-z0-9.\-]/gi, '');
    const chain = [wanted, ...MODEL_FALLBACKS.filter(m => m !== wanted)];

    let resp = null;
    let text = '';
    let lastErr = '';
    let usedModel = wanted;
    let tried = [];

    for (const model of chain) {
      tried.push(model);
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
          resp = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(geminiBody)
          });
        } catch (e) {
          lastErr = 'Gemini API erişilemedi: ' + String(e && e.message || e);
          resp = null;
          if (attempt < MAX_ATTEMPTS) await sleep(RETRY_DELAY_MS);
          continue;
        }
        text = await resp.text();
        if (resp.ok) { usedModel = model; break; }

        let detail = text.slice(0, 300);
        try {
          const j = JSON.parse(text);
          detail = (j && j.error && j.error.message) || detail;
        } catch (e) { /* düz metin */ }
        lastErr = detail;

        // Model kullanılamıyor (yeni kullanıcılara kapalı vb.) -> sonraki modele geç
        if (resp.status === 404 || /no longer available|not found|is not supported/i.test(detail)) {
          resp = null;
          break;
        }
        // Kota -> hemen pes et (yeniden denemek işe yaramaz)
        if (resp.status === 429 || /quota|rate limit|resource_exhausted/i.test(detail)) {
          return json({
            ok: false,
            error: `Gemini kotası doldu: ${detail}`,
            code: 'quota'
          }, 429, origin, env);
        }
        // Geçici yoğunluk (503) -> kısa bekleyip tekrar dene
        if ((resp.status === 503 || resp.status === 500 || /high demand|overloaded|internal/i.test(detail)) && attempt < MAX_ATTEMPTS) {
          await sleep(RETRY_DELAY_MS * attempt);
          continue;
        }
        // Diğer hatalar (400/403 ...) -> tekrar denemenin faydası yok
        resp = null;
        break;
      }
      if (resp && resp.ok) break;
    }

    if (!resp || !resp.ok) {
      const code = /quota/i.test(lastErr) ? 'quota' : 'gemini_error';
      const status = code === 'quota' ? 429 : 502;
      const hint = /high demand|overloaded|internal|503/.test(lastErr)
        ? ' (Google modelleri şu an yoğun; birkaç saniye sonra tekrar deneyin)'
        : '';
      return json({
        ok: false,
        error: `Gemini hatası: ${lastErr || 'bilinmeyen hata'}${hint} · denenene modeller: ${tried.join(', ')}`,
        code
      }, status, origin, env);
    }

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      return json({ ok: false, error: 'Gemini yanıtı ayrıştırılamadı', code: 'bad_response' }, 502, origin, env);
    }

    const raw = parsed &&
      parsed.candidates && parsed.candidates[0] &&
      parsed.candidates[0].content && parsed.candidates[0].content.parts &&
      parsed.candidates[0].content.parts.map(p => p.text).join('') || '';

    let coach;
    try {
      coach = JSON.parse(raw);
    } catch (e) {
      // Model şemaya uymadıysa düz metni kurtar
      coach = {
        overall: raw.slice(0, 2000) || '(boş yanıt)',
        strengths: [], weaknesses: [], keyMoments: [], studyPlan: [], estimatedLevel: ''
      };
      coach._raw = true;
    }

    return json({
      ok: true,
      coach,
      model: usedModel,
      usage: parsed && parsed.usageMetadata ? {
        promptTokens: parsed.usageMetadata.promptTokenCount || 0,
        outputTokens: parsed.usageMetadata.candidatesTokenCount || 0
      } : null
    }, 200, origin, env);
  }
};
