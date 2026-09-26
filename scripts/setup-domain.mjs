#!/usr/bin/env node
// scripts/setup-domain.mjs
// Kendi alan adını Cloudflare Pages + Workers'a bağlar ve worker'ın origin
// kilidini günceller. Kullanım:
//
//   CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... node scripts/setup-domain.mjs alanadiniz.qzz.io
//
// Ön koşullar:
//   1) Alan adını DigitalPlat'ten (ücretsiz) almış olmanız
//   2) Alan adının nameserver'larını Cloudflare'a yönlendirmiş olmanız
//
// Script şunları yapar:
//   - Pages projesine (vezir) özel alan adı ekler
//   - Worker'a "api.<alanadi>" özel alan adı ekler
//   - worker/wrangler.toml içindeki ALLOWED_ORIGINS listesini güncelleyip worker'ı yeniden deploy eder

const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;
const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const DOMAIN = (process.argv[2] || '').trim().toLowerCase();
const PAGES_PROJECT = 'vezir';
const WORKER_SERVICE = 'vezir-ai-coach';
const WORKER_HOST = `api.${DOMAIN}`;

if (!ACCOUNT || !TOKEN) {
  console.error('CLOUDFLARE_API_TOKEN ve CLOUDFLARE_ACCOUNT_ID ortam degiskenlerini verin.');
  process.exit(1);
}
if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(DOMAIN)) {
  console.error('Gecerli bir alan adi verin: node scripts/setup-domain.mjs ornek.qzz.io');
  process.exit(1);
}

async function cf(path, method, body) {
  const r = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.success === false) {
    const msg = (j.errors && j.errors.map(e => `${e.code}: ${e.message}`).join(', ')) || `HTTP ${r.status}`;
    throw new Error(`${method} ${path} -> ${msg}`);
  }
  return j.result;
}

console.log(`\n1/3  Pages'e ozel alan adi ekleniyor: ${DOMAIN}`);
try {
  await cf(`/accounts/${ACCOUNT}/pages/projects/${PAGES_PROJECT}/domains`, 'POST', { name: DOMAIN });
  console.log('     OK eklendi');
} catch (e) {
  console.log('     UYARI: ' + e.message + ' (zaten ekli olabilir)');
}

console.log(`2/3  Worker'a ozel alan adi ekleniyor: ${WORKER_HOST}`);
try {
  await cf(`/accounts/${ACCOUNT}/workers/domains`, 'POST', {
    zone_name: DOMAIN, hostname: WORKER_HOST, service: WORKER_SERVICE, environment: 'production'
  });
  console.log('     OK eklendi');
} catch (e) {
  console.log('     UYARI: ' + e.message + ' (zaten ekli olabilir)');
}

console.log('3/3  ALLOWED_ORIGINS guncelleniyor ve worker yeniden deploy ediliyor...');
const { readFileSync, writeFileSync } = await import('node:fs');
const { execSync } = await import('node:child_process');
const tomlPath = new URL('../worker/wrangler.toml', import.meta.url);
let toml = readFileSync(tomlPath, 'utf8');
const entry = `https://${DOMAIN},https://www.${DOMAIN},https://*.${DOMAIN}`;
const m = toml.match(/^ALLOWED_ORIGINS = .*$/m);
if (m) {
  const existing = m[0].split('=')[1].trim().replace(/^"|"$/g, '').split(',').map(s => s.trim()).filter(Boolean);
  for (const e of entry.split(',')) if (!existing.includes(e)) existing.push(e);
  toml = toml.replace(m[0], `ALLOWED_ORIGINS = "${existing.join(',')}"`);
} else {
  toml = toml.replace('[vars]', `[vars]\nALLOWED_ORIGINS = "${entry}"`);
}
writeFileSync(tomlPath, toml);
console.log('     ' + toml.match(/^ALLOWED_ORIGINS = .*$/m)[0]);
execSync('npx wrangler deploy', { cwd: new URL('../worker/', import.meta.url), stdio: 'inherit' });

console.log(`
OK Tamam. Artık su adresler calisiyor (DNS yayilimi birkac dakika surebilir):
   Site:    https://${DOMAIN}
   Worker:  https://${WORKER_HOST}

Uygulamadaki "AI Koç" sekmesine yapistirilacak adres:
   https://${WORKER_HOST}
`);
