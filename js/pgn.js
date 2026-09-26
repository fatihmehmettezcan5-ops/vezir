// js/pgn.js
// PGN ayrıştırma ve üretme (başlıklar, yorumlar, varyasyonlar, NAG'lar)

import { Chess } from './chess.js';

function tokenize(text) {
  const tokens = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i];
    if (ch === '{') {
      let j = text.indexOf('}', i);
      if (j < 0) j = n;
      tokens.push({ type: 'comment', value: text.slice(i + 1, j) });
      i = j + 1;
    } else if (ch === ';') {
      let j = text.indexOf('\n', i);
      if (j < 0) j = n;
      tokens.push({ type: 'comment', value: text.slice(i + 1, j) });
      i = j + 1;
    } else if (ch === '(') {
      let depth = 1, j = i + 1;
      while (j < n && depth > 0) {
        if (text[j] === '{') { const k = text.indexOf('}', j); j = k < 0 ? n : k + 1; continue; }
        if (text[j] === '(') depth++;
        else if (text[j] === ')') depth--;
        j++;
      }
      tokens.push({ type: 'variation', value: text.slice(i + 1, Math.max(i + 1, j - 1)) });
      i = j;
    } else if (ch === '<') {
      // RAV varyasyonları <1. e4 e5>
      let j = text.indexOf('>', i);
      if (j < 0) j = n;
      tokens.push({ type: 'variation', value: text.slice(i + 1, j) });
      i = j + 1;
    } else if (/\s/.test(ch)) {
      i++;
    } else {
      let j = i;
      while (j < n && !/[\s{}(;<>]/.test(text[j])) j++;
      tokens.push({ type: 'token', value: text.slice(i, j) });
      i = j;
    }
  }
  return tokens;
}

export function parsePgn(text) {
  const headers = {};
  const headerRe = /\[\s*(\w+)\s*"([^"]*)"\s*\]/g;
  let m, lastEnd = 0;
  while ((m = headerRe.exec(text))) { headers[m[1]] = m[2]; lastEnd = m.index + m[0].length; }

  let movetext = text.slice(lastEnd).replace(/\[\s*\w+\s*"[^"]*"\s*\]/g, ' ');
  const tokens = tokenize(movetext);

  const chess = new Chess(headers.FEN || undefined);
  const moves = [];
  const errors = [];
  let result = headers.Result || '*';
  let pendingComment = null;
  let pendingNags = [];

  for (const tok of tokens) {
    if (tok.type === 'comment') {
      // PGN'de bir hamleden sonra gelen yorum o hamleye aittir
      if (moves.length) {
        const prev = moves[moves.length - 1];
        prev.comment = prev.comment ? prev.comment + ' ' + tok.value.trim() : tok.value.trim();
      } else pendingComment = tok.value.trim();
      continue;
    }
    if (tok.type === 'variation') continue;
    const t = tok.value.trim();
    if (!t) continue;
    if (/^\d+\.*$/.test(t)) continue;                       // "12." veya "12"
    if (/^\d+\.\.\.?$/.test(t)) continue;                   // "12..."
    if (t === '1-0' || t === '0-1' || t === '1/2-1/2' || t === '*') { result = t; continue; }
    if (/^\$\d+$/.test(t)) {
      if (moves.length) moves[moves.length - 1].nags.push(parseInt(t.slice(1), 10));
      else pendingNags.push(parseInt(t.slice(1), 10));
      continue;
    }

    let mv = chess.move(t);
    if (!mv) {
      // Yedek 1: UCI biçimi (e2e4, e7e8q)
      if (/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(t)) {
        mv = chess.move({ from: t.slice(0, 2), to: t.slice(2, 4), promotion: t[4] || undefined });
      }
    }
    if (!mv) {
      // Yedek 2: işaretsiz ve "e.p." içermeyen tekrar
      const clean = t.replace(/[!?]+$/, '').replace(/e\.p\.?$/i, '').trim();
      if (clean !== t) mv = chess.move(clean);
    }
    if (!mv) {
      errors.push({ ply: moves.length, token: t, fen: chess.fen() });
      break;
    }
    moves.push({
      san: mv.san, move: mv, ply: moves.length,
      moveNumber: Math.floor(moves.length / 2) + 1,
      color: moves.length % 2 === 0 ? 'w' : 'b',
      comment: pendingComment, nags: pendingNags
    });
    pendingComment = null;
    pendingNags = [];
  }

  // Oyun gerçekten bittiyse sonucu düzelt
  const over = chess.isGameOver();
  if (over.over && result === '*') result = over.result;

  return { headers, moves, result, errors, chess, startFen: headers.FEN || Chess.START_FEN };
}

// Her hamle ÖNCESİNDEKİ konumlar + oyun sonu konumu
export function buildPositions(parsed) {
  const fens = [parsed.startFen];
  const chess = new Chess(parsed.startFen);
  for (const m of parsed.moves) {
    if (!chess.move(m.san)) break;
    fens.push(chess.fen());
  }
  return fens;
}

export function serializePgn({ headers = {}, moves = [], result = '*' }) {
  const order = ['Event', 'Site', 'Date', 'Round', 'White', 'Black', 'Result', 'WhiteElo', 'BlackElo', 'ECO', 'TimeControl'];
  const keys = [...order.filter(k => headers[k] !== undefined), ...Object.keys(headers).filter(k => !order.includes(k))];
  let out = keys.map(k => `[${k} "${headers[k]}"]`).join('\n');
  out += '\n\n';
  let line = '';
  for (let i = 0; i < moves.length; i++) {
    const num = i % 2 === 0 ? `${i / 2 + 1}. ` : '';
    const san = typeof moves[i] === 'string' ? moves[i] : moves[i].san;
    line += num + san + ' ';
    if (line.length > 72) { out += line.trim() + '\n'; line = ''; }
  }
  out += line.trim() + ' ' + (result || '*');
  return out.trim() + '\n';
}

// --- Örnek oyunlar -----------------------------------------------------------

const SAMPLE_GAMES = [
  {
    id: 'opera',
    title: 'Morphy – Brunswick/Isouard, Paris 1858 ("Opera Oyunu")',
    note: 'Kısa ve gösterişli bir kombinasyon örneği.',
    pgn: `[Event "Paris"]
[Site "Paris FRA"]
[Date "1858.11.02"]
[Round "8"]
[White "Paul Morphy"]
[Black "Duke Karl / Count Isouard"]
[Result "1-0"]

1. e4 e5 2. Nf3 d6 3. d4 Bg4 4. dxe5 Bxf3 5. Qxf3 dxe5 6. Bc4 Nf6 7. Qb3 Qe7
8. Nc3 c6 9. Bg5 b5 10. Nxb5 cxb5 11. Bxb5+ Nbd7 12. O-O-O Rd8 13. Rxd7 Rxd7
14. Rd1 Qe6 15. Bxd7+ Nxd7 16. Qb8+ Nxb8 17. Rd8# 1-0`
  },
  {
    id: 'century',
    title: 'Byrne – Fischer, New York 1956 ("Yüzyılın Oyunu")',
    note: 'Genç Fischer\'in ünlü vezir kurbanı.',
    pgn: `[Event "Third Rosenwald Trophy"]
[Site "New York NY USA"]
[Date "1956.10.17"]
[Round "8"]
[White "Donald Byrne"]
[Black "Robert James Fischer"]
[Result "0-1"]

1. Nf3 Nf6 2. c4 g6 3. Nc3 Bg7 4. d4 O-O 5. Bf4 d5 6. Qb3 dxc4 7. Qxc4 c6
8. e4 Nbd7 9. Rd1 Nb6 10. Qc5 Bg4 11. Bg5 Na4 12. Qa3 Nxc3 13. bxc3 Nxe4
14. Bxe7 Qb6 15. Bc4 Nxc3 16. Bc5 Rfe8+ 17. Kf1 Be6 18. Bxb6 Bxc4+ 19. Kg1
Ne2+ 20. Kf1 Nxd4+ 21. Kg1 Ne2+ 22. Kf1 Nc3+ 23. Kg1 axb6 24. Qb4 Ra4
25. Qxb6 Nxd1 26. h3 Rxa2 27. Kh2 Nxf2 28. Re1 Rxe1 29. Qd8+ Bf8 30. Nxe1
Bd5 31. Nf3 Ne4 32. Qb8 b5 33. h4 h5 34. Ne5 Kg7 35. Kg1 Bc5+ 36. Kf1 Ng3+
37. Ke1 Bb4+ 38. Kd1 Bb3+ 39. Kc1 Ne2+ 40. Kb1 Nc3+ 41. Kc1 Rc2# 0-1`
  },
  {
    id: 'evergreen',
    title: 'Anderssen – Dufresne, Berlin 1852 ("Ölümsüz Oyun")',
    note: '19. yüzyıl romantizmi: tas kurbanları üzerine mat.',
    pgn: `[Event "Berlin"]
[Site "Berlin GER"]
[Date "1852.07.01"]
[White "Adolf Anderssen"]
[Black "Jean Dufresne"]
[Result "1-0"]

1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. b4 Bxb4 5. c3 Ba5 6. d4 exd4 7. O-O d3
8. Qb3 Qf6 9. e5 Qg6 10. Re1 Nge7 11. Ba3 b5 12. Qxb5 Rb8 13. Qa4 Bb6
14. Nbd2 Bb7 15. Ne4 Qf5 16. Bxd3 Qh5 17. Nf6+ gxf6 18. exf6 Rg8 19. Rad1
Qxf3 20. Rxe7+ Nxe7 21. Qxd7+ Kxd7 22. Bf5+ Ke8 23. Bd7+ Kf8 24. Bxe7# 1-0`
  },
  {
    id: 'kasparov',
    title: 'Kasparov – Topalov, Wijk aan Zee 1999',
    note: 'Tarihin en ünlü kombinasyonlarından biri.',
    pgn: `[Event "Hoogovens A Tournament"]
[Site "Wijk aan Zee NED"]
[Date "1999.01.20"]
[Round "4"]
[White "Garry Kasparov"]
[Black "Veselin Topalov"]
[Result "1-0"]

1. e4 d6 2. d4 Nf6 3. Nc3 g6 4. Be3 Bg7 5. Qd2 c6 6. f3 b5 7. Nge2 Nbd7
8. Bh6 Bxh6 9. Qxh6 Bb7 10. a3 e5 11. O-O-O Qe7 12. Kb1 a6 13. Nc1 O-O-O
14. Nb3 exd4 15. Rxd4 c5 16. Rd1 Nb6 17. g3 Kb8 18. Na5 Ba8 19. Bh3 d5
20. Qf4+ Ka7 21. Rhe1 d4 22. Nd5 Nbxd5 23. exd5 Qd6 24. Rxd4 cxd4 25. Re7+
Kb6 26. Qxd4+ Kxa5 27. b4+ Ka4 28. Qc3 Qxd5 29. Ra7 Bb7 30. Rxb7 Qc4
31. Qxf6 Kxa3 32. Qxa6+ Kxb4 33. c3+ Kxc3 34. Qa1+ Kd2 35. Qb2+ Kd1
36. Bf1 Rd2 37. Rd7 Rxd7 38. Bxc4 bxc4 39. Qxh8 Rd3 40. Qa8 c3 41. Qa4+
Ke1 42. f4 f5 43. Kc1 Rd2 44. Qa7 1-0`
  },
  {
    id: 'trap',
    title: 'Blackburne Shilling tuzağı',
    note: 'Kısa ama ders dolu: hızlı geliştirme ve unutulan şah.',
    pgn: `[Event "Casual Game"]
[Site "Online"]
[Date "2023.05.11"]
[Round "-"]
[White "White"]
[Black "Black"]
[Result "0-1"]

1. e4 e5 2. Nf3 Nc6 3. Bc4 Nd4 4. Nxe5 Qg5 5. Nxf7 Qxg2 6. Rf1 Qe4+ 7. Be2 Nf3#
0-1`
  }
];

export function sampleGames() { return SAMPLE_GAMES; }

export function samplePgnText() { return SAMPLE_GAMES[0].pgn; }
