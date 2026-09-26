// js/coach.js
// Yerel (çevrimdışı) koç: motor analizinden kural tabanlı öneriler üretir.
// Hiçbir API anahtarı gerekmez.

import { hangingPieces } from './analysis.js';
import { CLASSES } from './analysis.js';

function levelBand(accuracy) {
  if (accuracy >= 97) return '2400+ (usta düzey)';
  if (accuracy >= 95) return '2000-2400 (güçlü kulüp oyuncusu)';
  if (accuracy >= 92) return '1700-2000 (ileri düzey)';
  if (accuracy >= 88) return '1400-1700 (orta-ileri)';
  if (accuracy >= 82) return '1100-1400 (orta düzey)';
  if (accuracy >= 75) return '800-1100 (başlangıç-orta)';
  return '800 altı (yeni başlayan)';
}

function pieceName(letter) {
  return { P: 'piyon', N: 'at', B: 'fil', R: 'kale', Q: 'vezir', K: 'şah' }[letter] || letter;
}

// Bir hamle için neden-sonuç açıklaması üret
function explainMove(m) {
  const reasons = [];
  const mover = m.color === 'w' ? 'Beyaz' : 'Siyah';

  // 1) Hamle sonrası kendi taşı savunmasız mı kaldı?
  const hanging = hangingPieces(m.fenAfter, m.color);
  if (hanging.length) {
    const worst = hanging.sort((a, b) => b.value - a.value)[0];
    reasons.push(`${m.san} sonrası ${worst.square} karesindeki ${pieceName(worst.piece)} taşınız savunmasız kaldı (rakip alabilir).`);
  }

  // 2) Rakibin savunmasız taşı kaçırıldı mı?
  if (m.bestSan) {
    const replay = m.pvSan || [];
    const bestIsCapture = /x/.test(m.bestSan);
    if (bestIsCapture) {
      const oppHanging = hangingPieces(m.fenBefore, m.color === 'w' ? 'b' : 'w');
      if (oppHanging.length) {
        const worst = oppHanging.sort((a, b) => b.value - a.value)[0];
        reasons.push(`En iyi hamle ${m.bestSan} idi: ${worst.square} karesindeki ${pieceName(worst.piece)} taşını alarak avantaj elde edebilirdiniz.`);
      } else {
        reasons.push(`En iyi hamle ${m.bestSan} idi; bu alış avantajlıydı.`);
      }
    }
  }

  // 3) Mat fırsatı kaçırıldı mı?
  if (m.mateBefore !== null && m.mateBefore !== undefined && m.mateBefore > 0 && m.class !== 'mate') {
    reasons.push(`Pozisyonda sizin için ${m.mateBefore} hamlede mat vardı (${m.bestSan || '?'}), ama farklı oynadınız.`);
  }

  // 4) Kazanan pozisyon bırakıldı mı?
  if (m.scoreBefore !== null && m.scoreBefore >= 200 && m.scoreAfter !== null && m.scoreAfter <= 0) {
    reasons.push('Kazanan bir pozisyondan çıktınız; oyun beraberliğe ya da rakibin lehine döndü.');
  }

  // 5) Materyal kaybı
  if (m.scoreAfter !== null && m.scoreAfter <= -250) {
    reasons.push(`Hamleden sonra değerlendirme ${(m.scoreAfter / 100).toFixed(1)} piyona düştü.`);
  }

  if (!reasons.length) {
    reasons.push(`En iyi hamle ${m.bestSan || '—'} idi. Oynadığınız ${m.san} hamlesi pozisyonu ${m.winLoss.toFixed(1)} kazanma puanı kaybettirdi.`);
  }
  return reasons;
}

export function generateCoachNotes(analyzer, headers = {}, result = '*') {
  const summary = analyzer.summary();
  if (!summary) return null;

  const whiteName = headers.White || 'Beyaz';
  const blackName = headers.Black || 'Siyah';
  const sections = [];
  const criticals = analyzer.moves
    .filter(m => !m.forced && (m.class === 'blunder' || m.class === 'mistake' || m.class === 'inaccuracy'))
    .sort((a, b) => b.winLoss - a.winLoss)
    .slice(0, 5);

  // 1) Genel değerlendirme
  const overallAcc = (summary.accuracy.w + summary.accuracy.b) / 2;
  const genel = [
    `${whiteName}: %${summary.accuracy.w.toFixed(1)} doğruluk · ${blackName}: %${summary.accuracy.b.toFixed(1)} doğruluk`,
    `Tahmini seviye aralığı: ${levelBand(overallAcc)}`,
    `Vahim hatalar: ${summary.blunders.w} (beyaz) / ${summary.blunders.b} (siyah) · Hatalar: ${summary.mistakes.w} / ${summary.mistakes.b}`
  ];
  if (summary.opening) genel.push(`Açılış: ${summary.opening.name} (${summary.opening.eco})`);
  sections.push({ title: 'Genel değerlendirme', items: genel });

  // 2) Kritik anlar
  if (criticals.length) {
    const items = criticals.map(m => {
      const who = m.color === 'w' ? whiteName : blackName;
      const cls = CLASSES[m.class];
      const why = explainMove(m).join(' ');
      return `${m.moveNumber}.${m.color === 'b' ? '…' : ''} ${m.san} (${cls.label}, -${m.winLoss.toFixed(0)} puan) — ${who}: ${why}`;
    });
    sections.push({ title: 'Kritik anlar', items });
  } else {
    sections.push({ title: 'Kritik anlar', items: ['Belirgin bir hata yok — temiz bir oyun oynadınız.'] });
  }

  // 3) Açılış
  const openingMoves = analyzer.moves.filter(m => m.phase === 'opening' && !m.forced);
  const openingBad = openingMoves.filter(m => m.class === 'inaccuracy' || m.class === 'mistake' || m.class === 'blunder');
  const openingItems = [];
  if (summary.opening) openingItems.push(`Oyun ${summary.opening.name} (${summary.opening.eco}) ile başladı.`);
  openingItems.push(`Açılış doğruluğu: %${summary.phaseAccuracy.opening.w.toFixed(1)} / %${summary.phaseAccuracy.opening.b.toFixed(1)}`);
  if (openingBad.length) {
    const first = openingBad[0];
    openingItems.push(`İlk açılış sapması ${first.moveNumber}. hamlede (${first.san}) oluştu; en iyi hamle ${first.bestSan || '—'} idi.`);
  } else if (openingMoves.length) {
    openingItems.push('Açılışta belirgin bir hata yapılmadı.');
  }
  sections.push({ title: 'Açılış', items: openingItems });

  // 4) Orta oyun ve son oyun
  const midItems = [
    `Orta oyun doğruluğu: %${summary.phaseAccuracy.middlegame.w.toFixed(1)} / %${summary.phaseAccuracy.middlegame.b.toFixed(1)}`,
    `Son oyun doğruluğu: %${summary.phaseAccuracy.endgame.w.toFixed(1)} / %${summary.phaseAccuracy.endgame.b.toFixed(1)}`
  ];
  const endBad = analyzer.moves.filter(m => m.phase === 'endgame' && !m.forced && (m.class === 'blunder' || m.class === 'mistake'));
  if (endBad.length) midItems.push(`Son oyunda ${endBad.length} hata var — temel son oyun teknikleri çalışılmalı.`);
  sections.push({ title: 'Orta oyun ve son oyun', items: midItems });

  // 5) Çalışma planı
  const plan = [];
  const missedTactics = analyzer.moves.filter(m => !m.forced && m.bestSan && /x/.test(m.bestSan) && (m.class === 'blunder' || m.class === 'mistake'));
  const missedMates = analyzer.moves.filter(m => m.mateBefore !== null && m.mateBefore !== undefined && m.mateBefore > 0 && m.class !== 'mate');
  const earlyErrors = analyzer.moves.filter(m => m.phase === 'opening' && (m.class === 'inaccuracy' || m.class === 'mistake' || m.class === 'blunder'));
  const positional = analyzer.moves.filter(m => m.class === 'inaccuracy' && !(m.bestSan && /x/.test(m.bestSan)));

  if (missedTactics.length >= 2) plan.push(`Taktik: ${missedTactics.length} hamlede rakibin savunmasız taşını kaçırdınız. Günde 15-20 dakika taktik bulmaca (chesstempo.com, lichess puzzle) çözün.`);
  if (missedMates.length >= 1) plan.push(`Mat görme: ${missedMates.length} hamlede mat serisini kaçırdınız. Basit mat kalıplarını (arka sıra, boğma, çapraz) tekrar edin.`);
  if (earlyErrors.length >= 3) plan.push(`Açılış: ${earlyErrors.length} açılış hatası var. Repertuarınızı 2-3 sisteme indirip ilk 10 hamleyi ezberleyin.`);
  if (positional.length >= 3) plan.push(`Strateji: ${positional.length} konumsal şüpheli hamle var. Piyon yapısı, zayıf kareler ve piyon zincirleri üzerine çalışın.`);
  if (endBad.length >= 2) plan.push(`Son oyun: ${endBad.length} son oyun hatası var. İkili son oyunları (piyon son oyunu, R+K vs K) ve geçiş tekniklerini çalışın.`);
  if (!plan.length) plan.push('Oyununuz oldukça temiz. Daha güçlü rakiplerle oynayarak ve hamle hamle analiz yaparak seviyenizi koruyun.');
  if (summary.blunders.w + summary.blunders.b >= 3) plan.push('Her hamleden önce 10 saniye durup "rakibin tehdidi ne?" sorusunu sorun — vahim hataların çoğu tek hamlelik tehditleri görmemekten kaynaklanır.');
  sections.push({ title: 'Çalışma planı', items: plan });

  // 3) Markdown rapor
  let md = `# Oyun Analiz Raporu\n\n`;
  md += `**${whiteName} – ${blackName}** · Sonuç: ${result}\n\n`;
  if (summary.opening) md += `Açılış: ${summary.opening.name} (${summary.opening.eco})\n\n`;
  md += `## Özet\n\n`;
  md += `- ${whiteName}: %${summary.accuracy.w.toFixed(1)} doğruluk\n- ${blackName}: %${summary.accuracy.b.toFixed(1)} doğruluk\n`;
  md += `- Vahim hata: ${summary.blunders.w} / ${summary.blunders.b} · Hata: ${summary.mistakes.w} / ${summary.mistakes.b} · Şüpheli: ${summary.inaccuracies.w} / ${summary.inaccuracies.b}\n`;
  md += `- Tahmini seviye: ${levelBand(overallAcc)}\n\n`;
  for (const s of sections.slice(1)) {
    md += `## ${s.title}\n\n`;
    for (const item of s.items) md += `- ${item}\n`;
    md += '\n';
  }
  md += `## Hamle hamle notlar\n\n`;
  md += `| # | Hamle | Sınıf | Doğruluk | En iyi | Değerlendirme |\n|---|---|---|---|---|---|\n`;
  for (const m of analyzer.moves) {
    const cls = CLASSES[m.class];
    md += `| ${m.moveNumber}${m.color === 'b' ? '…' : ''} | ${m.san} | ${cls.label} | %${m.accuracy.toFixed(1)} | ${m.bestSan || '—'} | ${formatEval(m)} |\n`;
  }

  return { sections, summary, markdown: md, overallAccuracy: overallAcc };
}

function formatEval(m) {
  if (m.mateWhiteBefore !== null && m.mateWhiteBefore !== undefined) {
    return m.mateWhiteBefore > 0 ? `#${m.mateWhiteBefore}` : `-#${Math.abs(m.mateWhiteBefore)}`;
  }
  const v = m.evalWhiteBefore;
  return (v > 0 ? '+' : '') + (v / 100).toFixed(2);
}
