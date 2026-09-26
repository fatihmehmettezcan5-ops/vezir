// test/ai-coach.test.mjs
// AI Koç: istem oluşturma, hata eşleme ve Cloudflare Worker davranışı
// (sahte global fetch ile Gemini'ye giden istek doğrulanır).
import worker from '../worker/ai-coach-worker.js';
import { buildCoachPayload, renderCoachHtml, AiCoach, AiCoachError } from '../js/ai-coach.js';
import { parsePgn, buildPositions, sampleGames } from '../js/pgn.js';
import { GameAnalyzer } from '../js/analysis.js';
import { searchPosition, clearTT } from '../js/engine-core.js';

let pass = 0, fail = 0;
function ok(cond, label) { if (cond) pass++; else { fail++; console.error('  x BASARISIZ: ' + label); } }

// ---------------------------------------------------------------------------
// 1) İstek gövdesi oluşturma
// ---------------------------------------------------------------------------
const game = sampleGames().find(g => g.id === 'trap');
const parsed = parsePgn(game.pgn);
const fens = buildPositions(parsed);
const analyzer = new GameAnalyzer(parsed, fens);
const tt = new Map();
await analyzer.run({
  engine: { analyze: (fen, mt) => Promise.resolve(searchPosition(fen, { movetime: mt, maxDepth: 12, tt })) },
  movetime: 120
});

const payload = buildCoachPayload(analyzer, parsed.headers, parsed.result);
ok(payload !== null, 'istek govdesi olusturuldu');
ok(payload.moves.length === parsed.moves.length, 'tum hamleler eklendi: ' + payload.moves.length);
ok(payload.moves[0].san.length > 0 && payload.moves[0].color === 'w', 'ilk hamle beyaz');
ok(payload.moves.every(m => m.loss >= 0), 'kazanma kaybi negatif degil');
ok(payload.accuracy !== null, 'dogruluk dahil');
ok(JSON.stringify(payload).length < 20000, 'govde kucuk (' + JSON.stringify(payload).length + ' bayt)');

const html = renderCoachHtml({
  overall: 'İyi oyun.', strengths: ['Açılış bilgisi'], weaknesses: ['Taktik'],
  keyMoments: [{ move: '5. Nxb5', what: 'Feda', why: 'Rok açıldı', better: 'Bc4' }],
  studyPlan: ['Taktik çöz'], estimatedLevel: '1500-1700'
}, { model: 'gemini-2.5-flash', usage: { promptTokens: 1200, outputTokens: 400 } });
ok(html.includes('İyi oyun.') && html.includes('gemini-2.5-flash'), 'HTML ciktisi tam');
ok(html.includes('Daha iyisi') && html.includes('Bc4'), 'kritik an blogu var');
ok(!/<script/i.test(html), 'HTML enjeksiyona karsi temiz');
const evil = renderCoachHtml({ overall: '<img src=x onerror=alert(1)>', strengths: [], weaknesses: [], keyMoments: [], studyPlan: [] }, null);
ok(!evil.includes('<img'), 'kullanici verisi escape edildi');

// ---------------------------------------------------------------------------
// 2) AiCoach sınıfı (sahte storage + fetch)
// ---------------------------------------------------------------------------
const mem = new Map();
const fakeStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k) };
const coach = new AiCoach(fakeStorage);
ok(coach.isConfigured() === false, 'baslangicta yapilandirilmamis');

let threw = false;
try { await coach.generate(payload); } catch (e) {
  threw = true;
  ok(e instanceof AiCoachError && e.code === 'not_configured', 'yapilandirilmamis hata kodu');
}
ok(threw, 'yapilandirilmamissa hata firlatti');

coach.setWorkerUrl('https://ornek.workers.dev/');
ok(coach.getWorkerUrl() === 'https://ornek.workers.dev', 'sondaki slash temizlendi');
ok(coach.isConfigured() === true, 'yapilandirildi');

// ağ hatası
const realFetch = globalThis.fetch;
globalThis.fetch = () => Promise.reject(new TypeError('Failed to fetch'));
threw = false;
try { await coach.generate(payload); } catch (e) {
  threw = true;
  ok(e.code === 'unreachable', 'ag hatasi kodu: ' + e.code);
}
ok(threw, 'ag hatasinda AiCoachError');

// ---------------------------------------------------------------------------
// 3) Cloudflare Worker davranışı
// ---------------------------------------------------------------------------
const ENV = { GEMINI_API_KEY: 'test-key', GEMINI_MODEL: 'gemini-3.8-flash' };
const ORIGIN = 'https://vezir.pages.dev';

function req(path, options = {}) {
  return new Request('https://w.example.com' + path, {
    method: options.method || 'GET',
    headers: { Origin: ORIGIN, ...(options.headers || {}) },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
}

// /health
let r = await worker.fetch(req('/health'), ENV);
let j = await r.json();
ok(r.status === 200 && j.ok === true && j.keyConfigured === true, '/health yanit veriyor');
ok(j.model === 'gemini-3.8-flash', 'health model adini bildirir');

// CORS preflight
r = await worker.fetch(req('/coach', { method: 'OPTIONS' }), ENV);
ok(r.status === 204 && r.headers.get('Access-Control-Allow-Origin') === ORIGIN, 'CORS preflight');

// joker origin: *.vezir.pages.dev hem uretim hem onizleme adresine izin verir
const wildEnv = { ...ENV, ALLOWED_ORIGINS: 'https://*.vezir.pages.dev,http://localhost:8080' };
r = await worker.fetch(req('/coach', { method: 'OPTIONS' }), wildEnv);
ok(r.headers.get('Access-Control-Allow-Origin') === ORIGIN, 'joker: tam eslesen origin izinli');
r = await worker.fetch(new Request('https://w.example.com/coach', {
  method: 'OPTIONS', headers: { Origin: 'https://abc123.vezir.pages.dev' }
}), wildEnv);
ok(r.headers.get('Access-Control-Allow-Origin') === 'https://abc123.vezir.pages.dev', 'joker: onizleme alt alani izinli');
r = await worker.fetch(new Request('https://w.example.com/coach', {
  method: 'OPTIONS', headers: { Origin: 'https://vezir.pages.dev.evil.com' }
}), wildEnv);
ok(r.headers.get('Access-Control-Allow-Origin') !== 'https://vezir.pages.dev.evil.com', 'joker: sahte suffix ENGELLENDI');
r = await worker.fetch(new Request('https://w.example.com/coach', {
  method: 'OPTIONS', headers: { Origin: 'https://kotu.example' }
}), wildEnv);
ok(r.headers.get('Access-Control-Allow-Origin') === 'https://*.vezir.pages.dev', 'yabanci origin izinli adres dondurur (tarayici engeller)');

// kötü yol
r = await worker.fetch(req('/yok'), ENV);
ok(r.status === 404, 'bilinmeyen yol 404');

// GET /coach
r = await worker.fetch(req('/coach'), ENV);
ok(r.status === 405, 'GET /coach 405');

// bozuk JSON
r = await worker.fetch(new Request('https://w.example.com/coach', {
  method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, body: 'degil{'
}), ENV);
ok(r.status === 400, 'bozuk JSON 400');

// hamlesiz istek
r = await worker.fetch(req('/coach', { method: 'POST', body: { moves: [] } }), ENV);
ok(r.status === 400, 'hamlesiz istek 400');

// anahtar yok
r = await worker.fetch(req('/coach', { method: 'POST', body: { moves: [{ san: 'e4' }] } }), {});
j = await r.json();
ok(r.status === 500 && j.code === 'no_key', 'anahtar yoksa 500 + no_key');

// başarılı Gemini çağrısı: gönderilen isteğin doğru şekle sahip olduğunu doğrula
let captured = null;
globalThis.fetch = (url, opts) => {
  captured = { url: String(url), opts };
  return Promise.resolve(new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text: JSON.stringify({
      overall: 'Güzel oyun.', strengths: ['Merkez kontrolü'], weaknesses: ['Taktik'],
      keyMoments: [{ move: '5. Nxb5', what: 'Feda', why: 'Rok zayıf', better: 'Bc4' }],
      studyPlan: ['Günlük taktik'], estimatedLevel: '1500-1700'
    }) }] }, finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 250 }
  }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
};

r = await worker.fetch(req('/coach', { method: 'POST', body: payload }), ENV);
j = await r.json();
ok(r.status === 200 && j.ok === true, 'basariili coach yaniti');
ok(j.coach.overall === 'Güzel oyun.', 'coach icerigi gecti');
ok(j.usage.promptTokens === 900, 'kullanım bilgisi gecti');
ok(captured && captured.url.includes('gemini-3.8-flash:generateContent'), 'Gemini endpoint dogru: ' + (captured && captured.url));
ok(captured.url.includes('key=test-key'), 'anahtar sorgu parametresinde');
const sentBody = JSON.parse(captured.opts.body);
ok(sentBody.generationConfig.responseMimeType === 'application/json', 'JSON cikti istendi');
ok(sentBody.generationConfig.temperature === 0.35, 'dusuk sicaklik');
ok(sentBody.generationConfig.maxOutputTokens === 8192, 'cikti butcesi 8192 (dusunen modeller icin)');
ok(sentBody.generationConfig.thinkingConfig.thinkingBudget === 1024, 'dusunme butcesi sinirli');
ok(sentBody.systemInstruction.parts[0].text.includes('satranç koçusun'), 'sistem istemi var');
ok(sentBody.contents[0].parts[0].text.includes('OYUNCULAR'), 'kullanici istemi olusuturuldu');
ok(sentBody.contents[0].parts[0].text.includes('TÜM HAMLELER'), 'hamle listesi gonderildi');
ok(sentBody.contents[0].parts[0].text.length < 12000, 'istem makul boyutta: ' + sentBody.contents[0].parts[0].text.length);

// Gemini hata durumu
globalThis.fetch = () => Promise.resolve(new Response(JSON.stringify({
  error: { message: 'API key not valid' }
}), { status: 400, headers: { 'Content-Type': 'application/json' } }));
r = await worker.fetch(req('/coach', { method: 'POST', body: payload }), ENV);
j = await r.json();
ok(r.status === 502 && j.error.includes('API key not valid'), 'Gemini hatasi 502 + mesaj');

// kota aşımı (429)
globalThis.fetch = () => Promise.resolve(new Response('{}', { status: 429 }));
r = await worker.fetch(req('/coach', { method: 'POST', body: payload }), ENV);
ok(r.status === 429, 'Gemini 429 -> 429');

// IP başına günlük limit
const tightEnv = { GEMINI_API_KEY: 'k', RATE_LIMIT: '2' };
globalThis.fetch = () => Promise.resolve(new Response(JSON.stringify({
  candidates: [{ content: { parts: [{ text: '{"overall":"x","strengths":[],"weaknesses":[],"keyMoments":[],"studyPlan":[]}' }] } }]
}), { status: 200, headers: { 'Content-Type': 'application/json' } }));
const ipReq = (ip) => new Request('https://w.example.com/coach', {
  method: 'POST',
  headers: { Origin: ORIGIN, 'CF-Connecting-IP': ip, 'Content-Type': 'application/json' },
  body: JSON.stringify(payload)
});
let blocked = null;
for (let i = 0; i < 4; i++) {
  const rr = await worker.fetch(ipReq('9.9.9.9'), tightEnv);
  if (rr.status === 429) { blocked = rr; break; }
}
ok(blocked !== null, 'IP kotasi asildiginda 429');
j = blocked ? await blocked.json() : {};
ok(j.code === 'rate_limited', 'limit kodu rate_limited');
// farklı IP etkilenmemeli
r = await worker.fetch(ipReq('8.8.8.8'), tightEnv);
ok(r.status === 200, 'baska IP etkilenmedi');

// geçici yoğunluk (503) -> yeniden dene ve başar
let calls = 0;
globalThis.fetch = (url, opts) => {
  calls += 1;
  if (calls === 1) {
    return Promise.resolve(new Response(JSON.stringify({ error: { message: 'high demand' } }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }));
  }
  return Promise.resolve(new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text: '{"overall":"Tamam."}' }] } }]
  }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
};
r = await worker.fetch(req('/coach', { method: 'POST', body: payload }), ENV);
j = await r.json();
ok(r.status === 200 && j.ok === true, '503 sonrasi yeniden deneme basarili');
ok(calls === 2, 'iki cagri yapildi: ' + calls);

// model kullanılamıyor (404) -> sonraki modele düş
calls = 0;
let usedUrls = [];
globalThis.fetch = (url) => {
  calls += 1;
  usedUrls.push(String(url));
  if (calls === 1) {
    return Promise.resolve(new Response(JSON.stringify({ error: { message: 'models/gemini-2.5-flash is no longer available to new users' } }),
      { status: 404, headers: { 'Content-Type': 'application/json' } }));
  }
  return Promise.resolve(new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text: '{"overall":"Yedek modelden."}' }] } }]
  }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
};
r = await worker.fetch(req('/coach', { method: 'POST', body: payload }), { ...ENV, GEMINI_MODEL: 'gemini-2.5-flash' });
j = await r.json();
ok(r.status === 200 && j.model === 'gemini-3.8-flash', '404 sonrasi yedek modele dusuldu: ' + j.model);
ok(usedUrls.length === 2 && usedUrls[1].includes('gemini-3.8-flash'), 'ikinci cagri yedek modele gitti');

// kalıcı 503 -> anlaşılır hata
globalThis.fetch = () => Promise.resolve(new Response(JSON.stringify({ error: { message: 'This model is currently experiencing high demand' } }),
  { status: 503, headers: { 'Content-Type': 'application/json' } }));
r = await worker.fetch(req('/coach', { method: 'POST', body: payload }), ENV);
j = await r.json();
ok(r.status === 502 && j.code === 'gemini_error', 'kalici 503 -> 502');
ok(j.error.includes('yoğun'), 'kullaniciya yoğunluk ipucu verildi');

// kota -> 429 + quota kodu (yeniden deneme YAPILMAZ)
calls = 0;
globalThis.fetch = () => { calls += 1; return Promise.resolve(new Response(JSON.stringify({ error: { message: 'Quota exceeded' } }), { status: 429, headers: { 'Content-Type': 'application/json' } })); };
r = await worker.fetch(req('/coach', { method: 'POST', body: payload }), ENV);
j = await r.json();
ok(r.status === 429 && j.code === 'quota', 'kota 429 + quota kodu');
ok(calls === 1, 'kotada yeniden deneme yapilmadi: ' + calls);

// model adı enjeksiyonu
globalThis.fetch = () => Promise.resolve(new Response('{}', { status: 200 }));
r = await worker.fetch(req('/coach', { method: 'POST', body: payload }), { ...ENV, GEMINI_MODEL: 'gemini-3.8-flash?key=evil' });
ok(captured && !captured.url.includes('evil'), 'model adi temizlendi: ' + (captured && captured.url));

globalThis.fetch = realFetch;
clearTT();
console.log(`\n${pass} gecti, ${fail} basarisiz`);
process.exit(fail ? 1 : 0);
