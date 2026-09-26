# ♞ Vezir — Tarayıcıda Satranç Oyun Analizi

Vezir, satranç oyunlarınızı (PGN) analiz eden tamamen tarayıcıda çalışan ücretsiz bir
web uygulamasıdır. Analiz motoru, satranç kuralları, açılış veritabanı ve koç notları
üreten yardımcı sistemin hepsi JavaScript ile sıfırdan yazılmıştır; hiçbir dış kütüphane,
API anahtarı veya sunucu gerekmez.

> **Sunucu yok, kayıt yok.** Oyununuz cihazınızdan hiçbir yere gönderilmez. Yalnızca
> siz isterseniz chess.com / lichess kamu arşivinden kendi oyunlarınız çekilir.

---

## Özellikler

| Alan | Ne yapıyor |
|---|---|
| **Oyun girişi** | PGN yapıştırma, `.pgn` sürükle-bırak, 5 ünlü örnek oyun, chess.com / lichess arşivinden çekme |
| **Analiz motoru** | Negamax + alfa-beta (PVS), quiescence araması, null-move pruning, late move reduction, transposition tablosu, iterative deepening, hamle süresi sınırı |
| **Hamle sınıflandırma** | Vahim hata / hata / şüpheli / iyi / mükemmel / en iyi / parlak / mat / zorunlu |
| **Doğruluk oranı** | lichess benzeri kazanma olasılığı ve doğruluk formülleri; oyuncu ve faz (açılış/orta oyun/son oyun) bazında |
| **Değerlendirme grafiği** | Oyun boyunca beyaz açısından skor eğrisi, hatalar işaretlenir, tıklayarak o hamleye gitme |
| **Tahta** | SVG tahta; son hamle, şah, yasal hedefler, en iyi hamle oku; tıklayarak keşif modunda hamle deneme, "motor hamlesi oyna" |
| **Koç notları** | Kural tabanlı Türkçe rapor: kritik anlar, ilk açılış sapması, kaybedilen kazanma pozisyonları, asılı taşlar, çalışma planı |
| **Dışa aktarma** | PGN indirme ve Markdown analiz raporu indirme |
| **Arayüz** | Koyu/açık tema, klavye kısayolları (← →, Boşluk, Home/End, F, Esc), mobil uyumlu tek kolon düzeni |

---

## Çalıştırma

Tarayıcılar `file://` üzerinde ES modüllerini ve worker'ları çalıştırmaya izin vermez;
uygulamayı bir statik sunucu ile açın:

```bash
cd vezir
python3 -m http.server 8080
# sonra tarayıcıda: http://localhost:8080
```

veya

```bash
npx serve .
```

**Kullanım:**
1. Bir PGN yapıştır / dosya bırak / örnek oyun seç (ya da kullanıcı adı gir).
2. **Tüm oyunu analiz et** — hızı 150 / 400 / 900 ms arasından seçebilirsiniz.
3. Hamle listesinde bir hamleye tıkla; sağdaki kartta değerlendirme, en iyi hamle,
   kazanma kaybı ve devam çizgisi görünür.
4. **Koç notları** sekmesinde Türkçe rapor, **Grafik** sekmesinde oyunun iniş çıkışları.

---

## Mimari

```
index.html               tek sayfa, iki görünüm (giriş / analiz)
styles/main.css          tema değişkenleri, düzen, SVG tahta ve grafik stilleri
js/
  chess.js               satranç kuralları: hamle üretimi, yap/geri al, SAN, FEN,
                         şah/mat/pat, rok, alma geçme, terfi, Zobrist, artımlı mat+PST
  pst.js                 taş değerleri ve konum kareleri tabloları (a8 = 0 indeksleme)
  engine-core.js         değerlendirme fonksiyonu + arama (negamax/quiesce/sıralama)
  engine-worker.js       aramayı ana iş parçacığından izole eden worker
  engine.js              ana iş parçacığındaki Engine sarmalayıcı (id'li söz kuyruğu,
                         worker çökerse ana iş parçacığına düşme)
  analysis.js            GameAnalyzer: her konumu analiz eder, sınıflandırır,
                         kazanma olasılığı / doğruluk hesaplar, fazları ayırır
  openings.js            ~130 ECO açılış kaydı + en uzun önek eşleşmesiyle tespit
  coach.js               kural tabanlı koç notları + Markdown rapor
  ai-coach.js            AI koç istemcisi (worker adresi, istek, HTML çıktı)
worker/
  ai-coach-worker.js     Cloudflare Worker: Gemini çağrısı, kota, CORS, doğrulama
  wrangler.toml          worker yapılandırması
scripts/
  setup-domain.mjs       kendi alan adını Pages + Workers'a bağlar, ALLOWED_ORIGINS günceller
  board.js               SVG tahta görünümü (vurgu, ok, hedef noktaları, etkileşim)
  chart.js               SVG değerlendirme grafiği
  app.js                 durum yönetimi, görünüm bağlama, analiz akışı, dışa aktarma
test/                    Node tabanlı testler (aşağıya bakın)
```

### Analiz nasıl çalışır?

Her konum için `searchPosition` iki kez çalıştırılır: hamleden önce ve sonra.
Fark **kazanma olasılığı yüzdesine** çevrilir ve eşiklere göre sınıflanır:

```
win% = 50 + 50 * (2 / (1 + e^(-0,00368208 * centipawn)) - 1)
doğruluk% = 103,1668 * e^(-0,04354 * kazanmaKaybı) - 3,1669
```

| Sınıf | Eşik (kazanma kaybı) |
|---|---|
| En iyi | < %1,5 |
| Mükemmel | < %4 |
| İyi | < %9 |
| Şüpheli | < %16 |
| Hata | < %30 |
| Vahim hata | ≥ %30 |
| Parlak | en iyi hamle + ≥ 200 cp materyal feda + kazanma ≥ %40 |
| Mat | rakip mat edildi |
| Zorunlu | tek yasal hamle (doğruluktan hariç tutulur) |

---

## Testler

```bash
npm test
```

| Suite | Kapsam |
|---|---|
| `test/chess.test.mjs` | 54 doğrulama: hamle üretimi, SAN, FEN, rok, terfi, mat/pat, artımlı durum |
| `test/engine.test.mjs` | 8 doğrulama: arama derinliği/süre, PV, taktik bulma |
| `test/pgn.test.mjs` | 35 doğrulama: başlıklar, yorum/$NAG, RAV, FEN, hata toparlama, gidiş-dönüş |
| `test/analysis.test.mjs` | 17 doğrulama: gerçek motorun üzerinden sınıflandırma, doğruluk, açılış tespiti |
| `test/coach.test.mjs` | 7 doğrulama: bölümler, markdown rapor, istatistikler |
| `test/ai-coach.test.mjs` | 56 doğrulama: istek gövdesi, HTML kaçış, worker protokolü, CORS, IP kotası, model adı temizleme |
| `test/ui.test.mjs` | 50 doğrulama: jsdom ile tüm arayüz akışı (yükleme → analiz → sekmeler → klavye → keşif modu → tema → indirme) |
| `test/matpst.test.mjs` | 13.911 konumda artımlı materyal + PST tutarlılığı (1.719 alma, 24 terfi, 12 rok) |

Toplam: **227 doğrulama + 13.911 konum kontrolü, 0 hata.**

`test/divide.mjs` perft dağıtım aracıdır (`python-chess` ile karşılaştırma için).

> `test/ui.test.mjs` geliştirme bağımlılığı olan `jsdom` ister (uygulamanın kendisi
> hiçbir bağımlılık kullanmaz). Kurulu değilse bu test bir uyarıyla atlanır:
> `npm install`.

---

## AI Koç (isteğe bağlı)

Vezir'in kural tabanlı koç notları her zaman çalışır. İsteğe bağlı olarak
**AI Koç** sekmesi, motorun bulgularını Google Gemini'ye göndererek daha uzun,
kişiselleştirilmiş bir yorum üretir.

**Neden bir Cloudflare Worker?** API anahtarını tarayıcıya koymak anahtarınızın
başkaları tarafından kullanılmasına yol açar. Worker anahtarı sunucuda tutar,
IP başına günlük limit uygular ve yalnızca beklenen biçimdeki istekleri geçirir.

```bash
# 1) Google AI Studio'dan ücretsiz API anahtarı al: https://aistudio.google.com/apikey
# 2) Worker'ı deploy et
cd worker
npm install -D wrangler          # veya: npx wrangler deploy
npx wrangler secret put GEMINI_API_KEY
npx wrangler deploy
# 3) Çıkan adresi uygulamadaki "AI Koç" sekmesine yapıştır
```

İsteğe bağlı ayarlar (`wrangler.toml` içinde `[vars]`):

| Değişken | Varsayılan | Açıklama |
|---|---|---|
| `GEMINI_MODEL` | `gemini-3.8-flash` | Kullanılacak model |
| `RATE_LIMIT` | `40` | IP başına günlük istek sayısı |
| `ALLOWED_ORIGINS` | `*` | Virgülle ayrılmış izinli site adresleri (örn. `https://vezir.pages.dev`) |

**Gerçek dünya notları (Eylül 2026'da canlı test edildi):**

- Google AI Studio artık `AIza…` yerine **`AQ.…`** ön ekli anahtarlar veriyor; bu anahtarlar
  da `generativelanguage.googleapis.com` üzerinden çalışır, ek ayar gerekmez.
- `gemini-2.5-flash` ve `gemini-2.5-flash-lite` **yeni kullanıcılara kapatıldı** (HTTP 404
  "no longer available to new users"). Worker bunu görünce otomatik olarak
  `gemini-3.8-flash → gemini-3.7-flash → gemini-3.5-flash → gemini-flash-latest`
  zincirine düşer.
- Gemini 3.x modelleri "düşünen" modellerdir: `maxOutputTokens` 2048 iken JSON yerine
  "Here is the JSON…" gibi bir cümle dönüyordu (düşünme token'ları bütçeyi yiyordu).
  Worker şimdi `maxOutputTokens: 8192` + `thinkingBudget: 1024` kullanıyor.
- Google modelleri sık sık **503 "high demand"** döndürüyor; worker model başına 2 kez,
  kısa bekleyerek yeniden deniyor ve başarısız olursa Türkçe açıklama gösteriyor.
- 33 hamlelik bir oyun için ölçülen maliyet: **631 girdi + 888 çıktı token**, ~11 saniye.
  Ücretsiz kotada bu birkaç yüz rapora tekabül eder.

Worker'ın gönderdiği veri yalnızca hamle listesi, skorlar ve hamle sınıflarıdır;
kişisel veri gönderilmez. Gemini yanıtı JSON şemasına zorlanır, bu yüzden arayüz
her zaman düzgün biçimlendirilebilir.

**Maliyet:** Ücretsiz kotada oyun başına birkaç bin token — bir analiz raporu
ücretimesaj başına çok düşüktür. Kota aşımında arayüz anlaşılır Türkçe hata gösterir.

---

## Geliştirici notu

Bu proje — satranç kuralları motoru, arama, PGN ayrıştırıcı, açılış veritabanı,
arayüz ve tüm testler dahil — **Arena.ai Agent Mode** kullanılarak sıfırdan
yazılmıştır. Hiçbir dış satranç kütüphanesi (chess.js, stockfish.js vb.) veya
çatı kütüphanesi kullanılmamıştır; tek geliştirme bağımlılığı testlerde kullanılan
`jsdom`'dur.

---

## Yayınlama (ücretsiz) — CANLI

Proje şu anda yayında:

| Ne | Adres |
|---|---|
| **Uygulama (Türkiye'den açılır)** | **https://fatihmehmettezcan5-ops.github.io/vezir/** |
| Uygulama (Cloudflare Pages) | https://vezir.pages.dev |
| **AI Koç worker** | https://vezir-ai-coach.fatihmehmettezcan5.workers.dev |
| Kaynak kod | https://github.com/fatihmehmettezcan5-ops/vezir |

> **Türkiye notu:** `pages.dev` domaini Türkiye'den erişime kapalı olduğu için site
> ayrıca GitHub Pages üzerinden de yayınlanmıştır (`github.io` engelli değildir).
> İki adres de aynı kodu servis eder; AI Koç worker'ı her iki origin'den de
> çağrılabilir (`ALLOWED_ORIGINS` listesine ikisi de eklenmiştir).

### Komutlarla yeniden yayınlama

```bash
# Site (statik dosyalar -> Cloudflare Pages)
npm run deploy
#   = npm run build  (dist/ oluşturur: index.html, styles/, js/, worker/, README)
#   + npx wrangler pages deploy dist --project-name vezir

# Worker (Gemini proxy)
cd worker && npx wrangler deploy
npx wrangler secret put GEMINI_API_KEY     # anahtarı değiştirmek gerekirse
```

İki ayrı şey deploy edilir: **Pages** siteyi, **Worker** AI koç proxy'sini barındırır.
Worker'da bir `[vars]` değişikliği (ör. `ALLOWED_ORIGINS`) her zaman `npx wrangler deploy`
ile yeniden yayınlanmalıdır.

### ⚠️ Türkiye'den erişim: `pages.dev` engelli

**25 Kasım 2025'ten bu yana `pages.dev` alan adının tamamı Türkiye'den erişime
kapatılmıştır** (TFF'nin kaçak maç yayını gerekçesiyle aldığı karar, BTK uygulaması).
Yani `vezir.pages.dev` adresi yurt dışından çalışırken Türkiye'deki bir ISP'den
**"ana makinesinin yanıt vermesi çok uzun sürdü"** hatası verir.

Hızlı teşhis (1 dakika):
1. DNS'i `1.1.1.1` veya `8.8.8.8` yapıp dene — açılıyorsa engel DNS zehirlenmesidir.
2. Mobil veri (4G/5G) veya VPN ile dene — açılıyorsa engel ISP düzeyindedir.

Kalıcı çözüm **kendi alan adını bağlamaktır** (ücretsiz, ~15 dakika):

```bash
# 1) DigitalPlat'ten ücretsiz domain al (GitHub ile giriş): https://domain.digitalplat.org
#    Uzantılar: .dpdns.org .us.kg .qzz.io .xx.kg   (hesap başına 1, repo'ya star atarsan 2)
# 2) Cloudflare panelinde "Add a site" ile domain'i ekle (Free plan) -> verilen 2 nameserver'ı
#    DigitalPlat panelindeki NS kayıtlarına yaz
# 3) Bu depodaki komut gerisini halleder:
CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... npm run setup-domain -- alanadiniz.qzz.io
```

Script Pages'e özel alan adı ekler, worker'a `api.<alanadiniz>` adresini bağlar,
`ALLOWED_ORIGINS` listesini güncelleyip worker'ı yeniden deploy eder. Sonuçta
Türkiye'den erişilebilen iki adres olur:

```
https://<alanadiniz>          -> uygulama
https://api.<alanadiniz>      -> AI Koç worker (AI Koç sekmesine bunu yapıştır)
```

Not: `workers.dev` engelli değildir, yalnızca `pages.dev` engellidir. Yine de her
iki adresi de kendi domain'ine taşımak en temiz çözümdür.

### Origin kilidi

Worker yalnızca kendi sitelerinizden gelen istekleri kabul eder:

```
ALLOWED_ORIGINS = "https://*.vezir.pages.dev,http://localhost:8080,http://127.0.0.1:8080"
```

`*.` jokeri hem `vezir.pages.dev` hem de her deploy önizlemesi
(`450dd8d9.vezir.pages.dev` gibi) ile eşleşir; `vezir.pages.dev.evil.com` ile
**eşleşmez**. Yeni bir alan adı eklerken bu listeyi güncellemeyi unutmayın.

---

## Ücretsiz domain ekleme (isteğe bağlı)

`vezir.pages.dev` zaten çalışıyor; kendi alan adını istersen:

1. **DigitalPlat FreeDomain** (https://domain.digitalplat.org) → GitHub ile giriş,
   `.dpdns.org` / `.us.kg` / `.qzz.io` / `.xx.kg` uzantılarından ücretsiz domain al
   (hesap başına 1, repo'ya star atarsan 2; $3'lük key ile +2).
2. DigitalPlat panelinde **DNS kaydı** ekle: `CNAME  @  vezir.pages.dev`
   (ve istersen `CNAME  www  vezir.pages.dev`).
3. Cloudflare paneli → **Workers & Pages → vezir → Custom domains → Set up a custom domain**
   → alan adını yaz → Cloudflare sertifikayı otomatik oluşturur (birkaç dakika).
4. `worker/wrangler.toml` içindeki `ALLOWED_ORIGINS` listesine yeni adresi ekle
   ve `npx wrangler deploy` ile worker'ı yeniden yayınla.

Notlar: DigitalPlat gönüllüler tarafından işletilir (SLA yok), yenileme manueldir.
Ciddi bir marka için Cloudflare Registrar'dan ~$10/yıl `.com` almak daha sağlamdır.

---

## Gereken anahtarlar

| Anahtar | Nerede durur | Zorunlu mu? |
|---|---|---|
| `GEMINI_API_KEY` | Cloudflare Worker'da (`wrangler secret put`) | AI Koç için evet |
| Cloudflare API token | Yalnızca senin bilgisayarında (`wrangler login` önerilir) | Deploy için evet |
| DigitalPlat hesabı | — | Domain istersen |

Tarayıcıda hiçbir anahtar tutulmaz; anahtarlar asla depoya yazılmaz
(`.gitignore`: `node_modules/`, `.wrangler/`, `.dev.vars`).

---

## Eski yayınlama notları (referans)

Uygulama tamamen statiktir (AI Koç worker'ı hariç) ve herhangi bir statik hostta
çalışır. Önerilen kombinasyon **Cloudflare Pages + ücretsiz domain**:

| Adım | Nasıl |
|---|---|
| 1. Host | `vezir.pages.dev` — Cloudflare Pages (sınırsız bant genişliği, en hızlı CDN). Alternatifler: `kullanici.github.io`, `vezir.netlify.app`, `vezir.vercel.app` |
| 2. Domain | DigitalPlat FreeDomain ile ücretsiz gerçek domain (`.dpdns.org`, `.us.kg`, `.qzz.io`, `.xx.kg`, `.qd.je`) → Cloudflare DNS'e yönlendir. Manuel yenileme gerekir, SLA yoktur; ciddi bir marka için Cloudflare Registrar'dan ~$10/yıl `.com` alınabilir |
| 3. AI Koç | `worker/` klasörünü Cloudflare'a deploy et (`npx wrangler deploy`), `ALLOWED_ORIGINS` değişkenine yeni alan adını yaz |
| 4. Kontrol | `https://<worker>.workers.dev/health` → `{ ok: true, keyConfigured: true }` dönmeli |

**Güvenlik kontrol listesi:**
- [ ] API anahtarı yalnızca `wrangler secret` ile saklanıyor (koda veya Git'e girilmedi)
- [ ] `ALLOWED_ORIGINS` yalnızca kendi alan adlarını içeriyor
- [ ] `RATE_LIMIT` makul bir değerde (varsayılan 40 istek/gün/IP)
- [ ] `wrangler.toml` ve `worker/` `.gitignore`'a alınmıyor (kod herkese açık olabilir, anahtar asla)

---

## Bilinen sınırlar

- **Analiz hızı:** motor saf JavaScript'tir; "Normal (400 ms)" ayarında 40 hamlelik bir oyun
  yaklaşık 30–40 saniye sürer. Daha hızlı sonuç için "Hızlı (150 ms)" seçilebilir.
- **chess.com / lichess çekme:** çevrimiçi ve erişilebilir API gerektirir; tarayıcı bu
  istekleri engellerse (reklam engelleyici / kurumsal ağ) çalışmaz. PGN yapıştırmak her
  zaman işe yarar.
- **Mevcut konum değerlendirmesi:** "🤖" düğmesi tahtadaki konum için motor hamlesi oynar
  (keşif modunda).
- **AI Koç:** Cloudflare Worker deploy edilmeden çalışmaz (anahtar güvenliği için
  gerekli). Kurulmadığında arayüz adım adım talimat gösterir; kural tabanlı koç
  notları her zaman çalışır.
- **file:// protokolü:** modüller ve worker nedeniyle çalışmaz; yukarıdaki sunucu komutunu
  kullanın.

---

## Uygunluk notu

chess.com ve lichess verileri, ilgili hizmetlerin herkese açık API'leri üzerinden
kullanılır. Bu uygulama bu hizmetlerle bağlantılı değildir ve onaylanmamıştır.
Analiz tamamen kullanıcının cihazında yapılır.

Lisans: MIT (öğrenme amaçlı yazılmıştır).
