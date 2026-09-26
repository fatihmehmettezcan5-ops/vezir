// test/pgn.test.mjs - PGN ayristirma testleri
import { parsePgn, buildPositions, serializePgn, sampleGames } from '../js/pgn.js';

let pass = 0, fail = 0;
function ok(cond, label) { if (cond) pass++; else { fail++; console.error('  x BASARISIZ: ' + label); } }
function eq(a, b, label) { ok(a === b, `${label} (beklenen ${JSON.stringify(b)}, bulunan ${JSON.stringify(a)})`); }

console.log('Ornek oyunlar...');
for (const g of sampleGames()) {
  const parsed = parsePgn(g.pgn);
  eq(parsed.errors.length, 0, `${g.id}: hatasiz ayristirildi`);
  eq(parsed.result, g.pgn.match(/\[Result "([^"]+)"\]/)[1], `${g.id}: sonuc dogru`);
  ok(parsed.moves.length > 5, `${g.id}: hamle sayisi ${parsed.moves.length}`);
  eq(parsed.headers.White !== undefined, true, `${g.id}: baslik okundu`);
}

console.log('Yorum / varyasyon / NAG...');
{
  const pgn = `[Event "T"]
[White "A"]
[Black "B"]
[Result "*"]

1. e4 {iyi hamle} e5 $1 2. Nf3 (2. f4 exf4 3. Nf3) Nc6 3. Bb5 a6 ; satir yorumu
4. Ba4 Nf6 *`;
  const parsed = parsePgn(pgn);
  eq(parsed.errors.length, 0, 'yorumlu PGN hatasiz');
  eq(parsed.moves.length, 8, '8 hamle ayristirildi');
  eq(parsed.moves[0].comment, 'iyi hamle', 'yorum kendi hamlesine baglandi');
  eq(parsed.moves[1].nags[0], 1, 'NAG kendi hamlesine baglandi');
  eq(parsed.moves[7].san, 'Nf6', 'son hamle');
  eq(parsed.moves[0].san, 'e4', 'ilk hamle');
}

console.log('FEN basligi...');
{
  const pgn = `[SetUp "1"]
[FEN "4k3/8/8/8/8/8/4P3/4K3 w - - 0 1"]

1. e4 Kd7 2. e5 Ke6 *`;
  const parsed = parsePgn(pgn);
  eq(parsed.errors.length, 0, 'FEN basligindan basladi');
  eq(parsed.moves.length, 4, '4 hamle');
  eq(buildPositions(parsed).length, 5, '5 konum');
}

console.log('Serilestirme...');
{
  const pgn = `[Event "T"]
[White "A"]
[Black "B"]
[Result "1-0"]

1. e4 e5 2. Nf3 Nc6 1-0`;
  const parsed = parsePgn(pgn);
  const out = serializePgn(parsed);
  const reparsed = parsePgn(out);
  eq(reparsed.errors.length, 0, 'yeniden ayristirma hatasiz');
  eq(reparsed.moves.map(m => m.san).join(' '), 'e4 e5 Nf3 Nc6', 'hamleler korundu');
  eq(reparsed.headers.White, 'A', 'baslik korundu');
}

console.log('Hatali PGN...');
{
  const parsed = parsePgn('[Event "T"]\n\n1. e4 e5 2. Kzi3 Nc6');
  eq(parsed.errors.length, 1, 'gecersiz hamle hata olarak kaydedildi');
  eq(parsed.moves.length, 2, 'hatadan onceki hamleler korundu');
}

console.log('Bos / eksik...');
{
  const parsed = parsePgn('');
  eq(parsed.moves.length, 0, 'bos PGN -> 0 hamle');
}

console.log(`\n${pass} gecti, ${fail} basarisiz`);
process.exit(fail ? 1 : 0);
