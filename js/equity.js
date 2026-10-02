/* ===========================================================================
   equity.js — hand evaluators + Monte-Carlo equity for every game family.

   Evaluators
     evalHigh(cards)        best high hand from 5..7 cards        (bigger = better)
     lowA5Best(cards)       ace-to-five lowball, pairs count      (smaller = better)
     low8Best(cards)        8-or-better qualifier, else null      (smaller = better)
     badugiEval(cards)      best badugi from 4 cards              (smaller = better)
     omahaHi / omahaLo8     exactly 2 hole + 3 board

   Monte Carlo
     PSEquity.spec(hand, step, opts) builds a simulation spec for the two
     remaining players; PSEquity.start(spec, sims, cb) runs it in slices so the
     UI stays responsive and the numbers converge on screen.
   =========================================================================== */
(function (global) {
  'use strict';

  const RSTR = '23456789TJQKA', SSTR = 'cdhs';
  const cid = code => {
    if (!code || code.length < 2) return -1;
    const r = RSTR.indexOf(code[0]), s = SSTR.indexOf(code[1]);
    return (r < 0 || s < 0) ? -1 : r * 4 + s;
  };
  const rk = id => id >> 2;              // 0='2' … 12='A'
  const st = id => id & 3;
  const lowv = r => (r === 12 ? 0 : r + 1);   // ace-low value: A=0, 2=1 … K=12

  /* ---------- packing: category + up to five ordered ranks ---------------- */
  function pack(cat, a, b, c, d, e) {
    return ((((cat * 16 + (a + 1)) * 16 + (b == null ? 0 : b + 1)) * 16 +
      (c == null ? 0 : c + 1)) * 16 + (d == null ? 0 : d + 1)) * 16 + (e == null ? 0 : e + 1);
  }

  function straightFrom(mask) {
    for (let hi = 12; hi >= 4; hi--) {
      const need = 0x1F << (hi - 4);
      if ((mask & need) === need) return hi;
    }
    if ((mask & 0x100F) === 0x100F) return 3;   // A-2-3-4-5, five high
    return -1;
  }

  /* ---------- best high hand from 5, 6 or 7 cards ------------------------ */
  const _cnt = new Int8Array(13), _sc = new Int8Array(4), _sm = new Int32Array(4);
  function evalHigh(cards) {
    _cnt.fill(0); _sc.fill(0); _sm.fill(0);
    let mask = 0;
    for (let i = 0; i < cards.length; i++) {
      const id = cards[i], r = rk(id), s = st(id);
      _cnt[r]++; _sc[s]++; _sm[s] |= 1 << r; mask |= 1 << r;
    }
    let best = 0;
    for (let s = 0; s < 4; s++) {
      if (_sc[s] < 5) continue;
      const sh = straightFrom(_sm[s]);
      if (sh >= 0) { const v = pack(8, sh); if (v > best) best = v; }
      else {
        const rs = [];
        for (let r = 12; r >= 0 && rs.length < 5; r--) if (_sm[s] & (1 << r)) rs.push(r);
        const v = pack(5, rs[0], rs[1], rs[2], rs[3], rs[4]); if (v > best) best = v;
      }
    }
    const sh = straightFrom(mask);
    if (sh >= 0) { const v = pack(4, sh); if (v > best) best = v; }

    let q = -1, t1 = -1, t2 = -1, p1 = -1, p2 = -1;
    for (let r = 12; r >= 0; r--) {
      const n = _cnt[r];
      if (n === 4) { if (q < 0) q = r; }
      else if (n === 3) { if (t1 < 0) t1 = r; else if (t2 < 0) t2 = r; }
      else if (n === 2) { if (p1 < 0) p1 = r; else if (p2 < 0) p2 = r; }
    }
    const kick = (skipA, skipB, n) => {
      const out = [];
      for (let r = 12; r >= 0 && out.length < n; r--)
        if (_cnt[r] && r !== skipA && r !== skipB) out.push(r);
      return out;
    };
    let v;
    if (q >= 0) { const k = kick(q, -1, 1); v = pack(7, q, k[0]); if (v > best) best = v; }
    if (t1 >= 0 && (p1 >= 0 || t2 >= 0)) {
      const pr = (t2 > p1) ? t2 : p1;
      v = pack(6, t1, pr); if (v > best) best = v;
    }
    if (t1 >= 0) { const k = kick(t1, -1, 2); v = pack(3, t1, k[0], k[1]); if (v > best) best = v; }
    if (p1 >= 0 && p2 >= 0) { const k = kick(p1, p2, 1); v = pack(2, p1, p2, k[0]); if (v > best) best = v; }
    if (p1 >= 0) { const k = kick(p1, -1, 3); v = pack(1, p1, k[0], k[1], k[2]); if (v > best) best = v; }
    {
      const k = kick(-1, -1, 5);
      v = pack(0, k[0], k[1], k[2], k[3], k[4]); if (v > best) best = v;
    }
    return best;
  }

  /* ---------- ace-to-five lowball (pairs count, straights/flushes don't) --- */
  function lowA5_5(cards) {                 // exactly five cards, smaller = better
    const c = new Int8Array(13);
    for (let i = 0; i < 5; i++) c[lowv(rk(cards[i]))]++;
    let q = -1, t = -1, p1 = -1, p2 = -1;
    for (let r = 12; r >= 0; r--) {
      if (c[r] === 4) q = r; else if (c[r] === 3) t = r;
      else if (c[r] === 2) { if (p1 < 0) p1 = r; else p2 = r; }
    }
    const kick = (a, b, n) => { const o = []; for (let r = 12; r >= 0 && o.length < n; r--) if (c[r] && r !== a && r !== b) o.push(r); return o; };
    if (q >= 0) { const k = kick(q, -1, 1); return pack(5, q, k[0]); }
    if (t >= 0 && p1 >= 0) return pack(4, t, p1);
    if (t >= 0) { const k = kick(t, -1, 2); return pack(3, t, k[0], k[1]); }
    if (p1 >= 0 && p2 >= 0) { const k = kick(p1, p2, 1); return pack(2, p1, p2, k[0]); }
    if (p1 >= 0) { const k = kick(p1, -1, 3); return pack(1, p1, k[0], k[1], k[2]); }
    const k = kick(-1, -1, 5);
    return pack(0, k[0], k[1], k[2], k[3], k[4]);
  }

  function lowA5Best(cards) {               // best five of n, smaller = better
    const seen = new Int8Array(13); let distinct = 0;
    for (let i = 0; i < cards.length; i++) { const v = lowv(rk(cards[i])); if (!seen[v]) { seen[v] = 1; distinct++; } }
    if (distinct >= 5) {                    // no-pair hand: five lowest distinct ranks
      const r = [];
      for (let v = 0; v < 13 && r.length < 5; v++) if (seen[v]) r.push(v);
      return pack(0, r[4], r[3], r[2], r[1], r[0]);
    }
    let best = Infinity;                    // paired: brute force the 5-card subsets
    const n = cards.length, five = new Array(5);
    for (let a = 0; a < n - 4; a++) for (let b = a + 1; b < n - 3; b++)
      for (let c = b + 1; c < n - 2; c++) for (let d = c + 1; d < n - 1; d++)
        for (let e = d + 1; e < n; e++) {
          five[0] = cards[a]; five[1] = cards[b]; five[2] = cards[c]; five[3] = cards[d]; five[4] = cards[e];
          const v = lowA5_5(five); if (v < best) best = v;
        }
    return best;
  }

  function low8Best(cards) {                // 8-or-better, null if it misses
    const seen = new Int8Array(8);
    for (let i = 0; i < cards.length; i++) { const v = lowv(rk(cards[i])); if (v <= 7) seen[v] = 1; }
    const r = [];
    for (let v = 0; v < 8 && r.length < 5; v++) if (seen[v]) r.push(v);
    if (r.length < 5) return null;
    return pack(0, r[4], r[3], r[2], r[1], r[0]);
  }

  /* ---------- badugi ------------------------------------------------------ */
  function badugiEval(cards) {              // smaller = better
    let best = Infinity;
    const n = cards.length;
    for (let m = 1; m < (1 << n); m++) {
      let rmask = 0, smask = 0, ok = true, size = 0;
      const rs = [];
      for (let i = 0; i < n; i++) {
        if (!(m & (1 << i))) continue;
        const id = cards[i], v = lowv(rk(id)), s = st(id);
        if ((rmask & (1 << v)) || (smask & (1 << s))) { ok = false; break; }
        rmask |= 1 << v; smask |= 1 << s; rs.push(v); size++;
      }
      if (!ok) continue;
      rs.sort((x, y) => y - x);
      const v = ((4 - size) * 1048576) + pack(0, rs[0], rs[1], rs[2], rs[3]);
      if (v < best) best = v;
    }
    return best;
  }

  /* ---------- omaha: exactly two hole + three board ----------------------- */
  const H2 = [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]];
  const B3 = [[0, 1, 2], [0, 1, 3], [0, 1, 4], [0, 2, 3], [0, 2, 4], [0, 3, 4], [1, 2, 3], [1, 2, 4], [1, 3, 4], [2, 3, 4]];
  const _five = new Array(5);
  function omahaHi(hole, board) {
    let best = 0;
    const hp = hole.length === 4 ? H2 : allPairs(hole.length);
    for (let i = 0; i < hp.length; i++) for (let j = 0; j < B3.length; j++) {
      _five[0] = hole[hp[i][0]]; _five[1] = hole[hp[i][1]];
      _five[2] = board[B3[j][0]]; _five[3] = board[B3[j][1]]; _five[4] = board[B3[j][2]];
      const v = evalHigh(_five); if (v > best) best = v;
    }
    return best;
  }
  function omahaLo8(hole, board) {
    let best = null;
    const hp = hole.length === 4 ? H2 : allPairs(hole.length);
    for (let i = 0; i < hp.length; i++) for (let j = 0; j < B3.length; j++) {
      _five[0] = hole[hp[i][0]]; _five[1] = hole[hp[i][1]];
      _five[2] = board[B3[j][0]]; _five[3] = board[B3[j][1]]; _five[4] = board[B3[j][2]];
      const v = low8Exact5(_five); if (v != null && (best == null || v < best)) best = v;
    }
    return best;
  }
  function low8Exact5(c) {
    const seen = new Int8Array(8); let n = 0;
    for (let i = 0; i < 5; i++) { const v = lowv(rk(c[i])); if (v > 7) return null; if (seen[v]) return null; seen[v] = 1; n++; }
    const r = []; for (let v = 0; v < 8; v++) if (seen[v]) r.push(v);
    return pack(0, r[4], r[3], r[2], r[1], r[0]);
  }
  function allPairs(n) { const o = []; for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) o.push([i, j]); return o; }

  /* =======================================================================
     hand-strength heuristics — used only to ORDER candidate holdings so a
     "top X%" range can be cut out of them.  The cut itself is empirical: we
     sample the holdings a player could actually have here, sort them by these
     scores and keep the best X%.  So the heuristic only has to get the
     ordering roughly right, not produce a meaningful absolute number.
     ======================================================================= */

  // ace-to-five lowness of any number of cards; smaller = better
  function lowPartial(cards) {
    const seen = new Int8Array(13); let dup = 0;
    for (let i = 0; i < cards.length; i++) {
      const v = lowv(rk(cards[i]));
      if (seen[v]) dup++; else seen[v] = 1;
    }
    const r = [];
    for (let v = 0; v < 13 && r.length < 5; v++) if (seen[v]) r.push(v);
    while (r.length < 5) r.push(12);
    return dup * 1e7 + pack(0, r[4], r[3], r[2], r[1], r[0]);
  }

  // Equity (%) of each of the 169 Hold'em starting hands against one random
  // hand, measured with this file's own evaluator (40k sims each).  Used to
  // order candidate hole cards, so a "top X" range means what a player expects.
  const HOLDEM_EQ = {
    'AA':85.01, 'KK':82.37, 'QQ':79.62, 'JJ':77.68, 'TT':75.41, '99':72.11, '88':69.4,
    'AKs':67.31, 'AQs':66.63, '77':66.58, 'AJs':66.08, 'AKo':65.51, 'ATs':64.81, 'AQo':64.44,
    'AJo':63.65, '66':63.2, 'KQs':63.2, 'A9s':62.91, 'A8s':62.61, 'ATo':62.52, 'KJs':62.06,
    'KQo':62, 'KTs':62, 'A7s':60.87, 'A9o':60.76, '55':60.4, 'KJo':60.34, 'QJs':60.26,
    'A5s':60.15, 'A8o':60.09, 'K9s':59.68, 'KTo':59.63, 'A6s':59.59, 'QTs':59.46, 'A4s':58.93,
    'A7o':58.83, 'K8s':58.2, 'QJo':58.11, 'A3s':57.94, 'A6o':57.87, 'Q9s':57.71, 'K9o':57.62,
    'A5o':57.59, '44':57.57, 'A2s':57.57, 'K7s':57.28, 'JTs':57.24, 'QTo':57.19, 'K6s':56.61,
    'A4o':56.23, 'K8o':56.2, 'A3o':55.95, 'K5s':55.89, 'Q8s':55.84, 'J9s':55.52, 'Q9o':55.33,
    'A2o':55.26, 'JTo':55.19, 'K7o':54.66, 'K4s':54.51, 'K3s':54.33, 'Q7s':54.33, 'J8s':54.24,
    'Q6s':53.87, 'Q8o':53.85, 'K6o':53.74, 'K5o':53.61, 'T9s':53.59, '33':53.57, 'Q5s':52.96,
    'J7s':52.88, 'J9o':52.87, 'K2s':52.74, 'T8s':52.46, 'Q7o':52.37, 'Q4s':52.16, 'K4o':51.94,
    'J8o':51.68, 'K3o':51.55, 'Q6o':51.39, 'T9o':51.34, '98s':51.16, 'T7s':51, 'Q3s':50.92,
    'Q2s':50.54, '22':50.51, 'J6s':50.47, 'K2o':50.41, 'J5s':50.38, 'Q5o':50.24, 'T8o':49.87,
    'J7o':49.67, 'Q4o':49.29, '97s':49.07, 'T6s':49, 'J4s':48.82, '98o':48.35, 'Q3o':48.26,
    'J3s':48.21, '87s':48.18, 'J6o':47.96, 'T7o':47.84, 'Q2o':47.6, 'T5s':47.59, 'J2s':47.46,
    'J5o':47.42, '96s':47.06, '86s':46.52, '97o':46.48, 'T4s':46.41, 'J4o':46.01, 'T6o':45.86,
    'T3s':45.85, '76s':45.47, '95s':45.39, 'J3o':44.94, '87o':44.89, 'T2s':44.83, '85s':44.51,
    'J2o':44.35, '96o':44.27, 'T5o':44.01, '94s':43.81, '75s':43.6, 'T4o':43.47, '86o':43.44,
    '65s':43.23, '93s':43.2, '95o':42.84, 'T3o':42.8, '84s':42.8, '92s':42.25, '76o':42.19,
    '74s':41.77, 'T2o':41.67, '64s':41.5, '85o':41.44, '54s':41.41, '94o':40.92, '83s':40.72,
    '75o':40.72, '82s':40.16, '65o':40.12, '73s':40.05, '93o':39.87, '84o':39.81, '92o':39.53,
    '63s':39.29, '53s':39.06, '43s':38.98, '54o':38.44, '74o':38.39, '64o':38.25, '72s':38.11,
    '52s':37.96, '62s':37.81, '83o':37.66, '82o':36.99, '42s':36.81, '73o':36.8, '53o':36.49,
    '63o':35.98, '32s':35.97, '43o':35.07, '72o':34.7, '52o':34.39, '62o':33.76, '42o':33.08,
    '32o':32.04
  };
  function holdemHole(cards) {
    if (cards.length !== 2) return highPartial(cards);
    const a = rk(cards[0]), b = rk(cards[1]);
    const key = a === b ? RSTR[a] + RSTR[a]
      : RSTR[Math.max(a, b)] + RSTR[Math.min(a, b)] + (st(cards[0]) === st(cards[1]) ? 's' : 'o');
    return HOLDEM_EQ[key] || 0;
  }

  // high-hand strength of 2..7 cards; bigger = better
  function highPartial(cards) {
    const n = cards.length;
    if (n >= 5) return evalHigh(cards) * 100;
    const cnt = new Int8Array(13), sc = new Int8Array(4);
    let mask = 0, top = 0;
    for (let i = 0; i < n; i++) {
      const r = rk(cards[i]); cnt[r]++; sc[st(cards[i])]++; mask |= 1 << r;
      if (r > top) top = r;
    }
    let trip = -1, pair = -1, pair2 = -1;
    for (let r = 12; r >= 0; r--) {
      if (cnt[r] >= 3) { if (trip < 0) trip = r; }
      else if (cnt[r] === 2) { if (pair < 0) pair = r; else if (pair2 < 0) pair2 = r; }
    }
    let v = 0;
    if (trip >= 0) v = 9e6 + trip * 2e4;
    else if (pair >= 0 && pair2 >= 0) v = 7e6 + pair * 2e4 + pair2 * 500;
    else if (pair >= 0) v = 5e6 + pair * 2e4;
    let maxSuit = 0; for (let i = 0; i < 4; i++) if (sc[i] > maxSuit) maxSuit = sc[i];
    if (maxSuit >= 2) v += (maxSuit - 1) * 2.2e5;               // suited / three-flush
    let lo = 12, hi = 0;
    for (let r = 0; r < 13; r++) if (mask & (1 << r)) { if (r < lo) lo = r; if (r > hi) hi = r; }
    const span = hi - lo;
    if (n >= 2 && span <= n + 1) v += (n + 2 - span) * 1.4e5;   // connectedness
    v += top * 6000;
    for (let r = 0; r < 13; r++) if (cnt[r]) v += r * 400 * cnt[r];
    return v;
  }

  // four-card Omaha starting hands; bigger = better (approximate, hi-oriented)
  function omahaHolePartial(cards) {
    const cnt = new Int8Array(13), sc = new Int8Array(4);
    for (let i = 0; i < cards.length; i++) { cnt[rk(cards[i])]++; sc[st(cards[i])]++; }
    let v = 0, pairs = 0;
    for (let r = 12; r >= 0; r--) {
      if (cnt[r] === 2) { pairs++; v += 9e5 + r * 3e4; }
      else if (cnt[r] >= 3) v -= 4e5;                            // trips/quads are dead cards
    }
    if (pairs === 2) v += 5e5;
    let suited = 0;
    for (let i = 0; i < 4; i++) if (sc[i] === 2) suited++; else if (sc[i] >= 3) v -= 2e5;
    v += suited * 5e5;                                           // single- / double-suited
    const rs = [];
    for (let r = 12; r >= 0; r--) for (let k = 0; k < cnt[r]; k++) rs.push(r);
    v += rs.reduce((a, r) => a + r * 9000, 0);
    let gaps = 0;
    for (let i = 1; i < rs.length; i++) gaps += Math.min(4, rs[i - 1] - rs[i]);
    v += (12 - gaps) * 6e4;                                      // connectedness
    return v;
  }

  /* strength of one candidate holding: {hi, lo}, either may be null */
  function strengths(key, hand) {
    switch (key) {
      case 'razz': case 'a5td': case 'a5sd':
                                     return { hi: null, lo: lowPartial(hand) };
      case 'td27': case 'sd27':      return { hi: null, lo: evalHigh(hand) };
      case 'badugi':                 return { hi: null, lo: badugiEval(hand) };
      case 'stud': case 'fcd':       return { hi: highPartial(hand), lo: null };
      case 'stud8':                  return { hi: highPartial(hand), lo: lowPartial(hand) };
      case 'holdem':                 return { hi: holdemHole(hand), lo: null };
      case 'omaha':                  return { hi: omahaHolePartial(hand), lo: null };
      case 'omaha8':                 return { hi: omahaHolePartial(hand), lo: lowPartial(hand) };
      default:                       return { hi: highPartial(hand), lo: null };
    }
  }

  /* =======================================================================
     showdown scoring — fills `out` with each player's share of the pot
     (works for any number of players)
     ======================================================================= */
  const _hi = [], _lo = [];
  function award(scores, best, better, out, weight) {
    let cnt = 0;
    for (let i = 0; i < scores.length; i++) if (scores[i] === best) cnt++;
    if (!cnt) return;
    for (let i = 0; i < scores.length; i++) if (scores[i] === best) out[i] += weight / cnt;
  }
  const bestOf = (a, better) => {
    let b = null;
    for (let i = 0; i < a.length; i++) if (a[i] != null && (b === null || better(a[i], b))) b = a[i];
    return b;
  };
  const GT = (a, b) => a > b, LT = (a, b) => a < b;

  const SPLIT_GAMES = { stud8: 1, omaha8: 1 };
  function sharesInto(key, hands, board, out, outHi, outLo) {
    const n = hands.length;
    for (let i = 0; i < n; i++) out[i] = 0;
    _hi.length = n; _lo.length = n;
    let useHi = true, useLo = false;
    for (let i = 0; i < n; i++) {
      const h = hands[i];
      switch (key) {
        case 'razz':   _lo[i] = lowA5Best(h); useHi = false; useLo = true; break;
        case 'a5td': case 'a5sd':
                       _lo[i] = lowA5_5(h);   useHi = false; useLo = true; break;
        case 'td27': case 'sd27': _lo[i] = evalHigh(h); useHi = false; useLo = true; break;
        case 'badugi': _lo[i] = badugiEval(h); useHi = false; useLo = true; break;
        case 'stud': case 'fcd': _hi[i] = evalHigh(h); break;
        case 'holdem': _hi[i] = evalHigh(h.concat(board)); break;
        case 'omaha':  _hi[i] = omahaHi(h, board); break;
        case 'stud8':  _hi[i] = evalHigh(h); _lo[i] = low8Best(h); useLo = true; break;
        case 'omaha8': _hi[i] = omahaHi(h, board); _lo[i] = omahaLo8(h, board); useLo = true; break;
        default:       _hi[i] = evalHigh(h); break;
      }
    }
    if (useHi && useLo) {                       // split games: half each way
      const bl = bestOf(_lo, LT);
      const bh = bestOf(_hi, GT);
      if (outHi) { for (let i = 0; i < n; i++) outHi[i] = 0; award(_hi, bh, GT, outHi, 1); }
      if (outLo) {
        for (let i = 0; i < n; i++) outLo[i] = 0;
        if (bl != null) award(_lo, bl, LT, outLo, 1);
      }
      if (bl == null) award(_hi, bh, GT, out, 1);
      else { award(_hi, bh, GT, out, 0.5); award(_lo, bl, LT, out, 0.5); }
      return bl != null;                        // did a low qualify?
    }
    if (useLo) award(_lo, bestOf(_lo, LT), LT, out, 1);
    else award(_hi, bestOf(_hi, GT), GT, out, 1);
    return false;
  }

  // two-player convenience wrapper (kept for tests / external callers)
  function shares(key, h0, h1, board) {
    const out = [0, 0];
    sharesInto(key, [h0, h1], board, out);
    return out;
  }

  /* =======================================================================
     discard heuristics for simulating the remaining draws
     ======================================================================= */
  function pickDiscards(gameKey, cards, n) {
    if (n <= 0) return [];
    const idx = cards.map((id, i) => i);
    if (gameKey === 'badugi') {
      // keep the best badugi subset, throw the rest (worst first)
      let keep = 0, bestScore = Infinity;
      for (let m = 1; m < (1 << cards.length); m++) {
        let rmask = 0, smask = 0, ok = true, size = 0; const rs = [];
        for (let i = 0; i < cards.length; i++) {
          if (!(m & (1 << i))) continue;
          const v = lowv(rk(cards[i])), s = st(cards[i]);
          if ((rmask & (1 << v)) || (smask & (1 << s))) { ok = false; break; }
          rmask |= 1 << v; smask |= 1 << s; rs.push(v); size++;
        }
        if (!ok) continue;
        rs.sort((x, y) => y - x);
        const sc = ((4 - size) * 1048576) + pack(0, rs[0], rs[1], rs[2], rs[3]);
        if (sc < bestScore) { bestScore = sc; keep = m; }
      }
      const out = [];
      for (let i = 0; i < cards.length && out.length < n; i++) if (!(keep & (1 << i))) out.push(i);
      for (let i = cards.length - 1; i >= 0 && out.length < n; i--) if (out.indexOf(i) < 0) out.push(i);
      return out;
    }
    if (gameKey === 'fcd') {
      // a HIGH draw: never break a pair or better, keep a four-flush, otherwise
      // hold the big cards — the lowball rule below would throw exactly backwards
      const cnt = {}, suits = {};
      cards.forEach(id => { cnt[rk(id)] = (cnt[rk(id)] || 0) + 1; suits[st(id)] = (suits[st(id)] || 0) + 1; });
      let flushSuit = -1;
      for (const k in suits) if (suits[k] >= 4) flushSuit = +k;
      const keep = id => {
        const c = cnt[rk(id)];
        if (c >= 2) return 1000 + c * 100 + rk(id);
        if (flushSuit >= 0 && st(id) === flushSuit) return 500 + rk(id);
        return rk(id);
      };
      return cards.map((id, i) => i).sort((a, b) => keep(cards[a]) - keep(cards[b])).slice(0, n);
    }
    // lowball draws: dump duplicated ranks first, then the worst cards
    const aceHigh = (gameKey === 'td27' || gameKey === 'sd27');
    const val = id => aceHigh ? rk(id) : lowv(rk(id));
    const seen = {};
    idx.sort((i, j) => val(cards[j]) - val(cards[i]));      // worst (highest) first
    const dupe = {}, order = [];
    for (const i of idx) { const v = val(cards[i]); dupe[i] = seen[v] ? 1 : 0; seen[v] = 1; order.push(i); }
    order.sort((i, j) => (dupe[j] - dupe[i]) || (val(cards[j]) - val(cards[i])));
    return order.slice(0, n);
  }

  /* =======================================================================
     build a simulation spec from the current replay step
     ======================================================================= */
  function spec(hand, step, opts) {
    opts = opts || {};
    const fam = hand.game.fam, key = hand.game.key;
    const live = step.players.filter(p => p.inHand && !p.folded);
    if (live.length < 2 || live.length > 9) return null;
    // nothing to compute before the cards are actually out
    if (live.some(p => p.cards.length === 0)) return null;

    const target = fam === 'stud' ? 7 : hand.game.cards;
    const dead = [];
    const used = new Set();
    const take = c => { const id = cid(c); if (id >= 0 && !used.has(id)) { used.add(id); return id; } return -1; };

    // board (flop games)
    const board = [];
    for (const c of step.board) { const id = take(c); if (id >= 0) board.push(id); }

    // every card the observer can already see belongs to nobody else
    const players = live.map(p => {
      const known = [];
      let hiddenNow = 0;
      const rev = hand.revealed[p.name] || null;
      const drawsLeft = remainingDraws(hand, step)[p.name];
      const mayXray = opts.xray && rev && (fam !== 'draw' || !drawsLeft || drawsLeft.length === 0);
      p.cards.forEach((c, ix) => {
        let code = c.c;
        if (!code && mayXray && rev[ix]) code = rev[ix];
        if (code) { const id = take(code); if (id >= 0) known.push(id); }
        else hiddenNow++;
      });
      return { name: p.name, known: known, hiddenNow: hiddenNow,
               hidden: hiddenNow > 0, need: Math.max(0, target - known.length) };
    });

    // folded players' exposed cards are dead
    for (const p of step.players) {
      if (live.indexOf(p) >= 0) continue;
      for (const c of p.cards) if (c.c) { const id = take(c.c); if (id >= 0) dead.push(id); }
      if (opts.xray && hand.revealed[p.name]) for (const c of hand.revealed[p.name]) { const id = take(c); if (id >= 0) dead.push(id); }
    }

    const deck = [];
    for (let i = 0; i < 52; i++) if (!used.has(i)) deck.push(i);

    const rounds = remainingDraws(hand, step);
    return {
      key: key, fam: fam, target: target,
      players: players, board: board, boardNeed: fam === 'flop' ? 5 - board.length : 0,
      deck: Uint8Array.from(deck),
      draws: fam === 'draw' ? players.map(p => rounds[p.name] || []) : null,
      exact: players.every(p => p.need === 0) &&
        (fam !== 'flop' || board.length === 5) &&
        (fam !== 'draw' || players.every(p => !rounds[p.name] || rounds[p.name].length === 0)),
      known: players.map(p => p.need === 0),
      // every card already dealt is known to us — only the run-out is random
      knownNow: players.every(p => p.hiddenNow === 0),
      // a "top X%" range can only bite on a player whose cards we cannot see
      rangeable: players.map(p => p.hidden && p.need > 0),
    };
  }

  /* remaining discard counts per player, in draw-round order */
  function remainingDraws(hand, step) {
    const out = {};
    if (!hand.drawLog) return out;
    for (const d of hand.drawLog) {
      if (d.ei <= step.ei) continue;
      (out[d.player] || (out[d.player] = [])).push(d.count);
    }
    return out;
  }

  /* =======================================================================
     the simulator
     ======================================================================= */
  function runSlice(sp, n, acc) {
    const deck = sp.deck, len = deck.length, np = sp.players.length;
    const work = acc.work || (acc.work = new Uint8Array(len));
    const cut = acc.cut, tries = acc.tries || 1;
    const hands = acc.hands || (acc.hands = sp.players.map(() => []));
    const board = acc.board || (acc.board = []);
    const out = acc.out || (acc.out = new Array(np).fill(0));
    for (let s = 0; s < n; s++) {
      work.set(deck);
      let di = 0;
      const draw = () => {
        const j = di + ((Math.random() * (len - di)) | 0);
        const v = work[j]; work[j] = work[di]; work[di] = v; di++; return v;
      };
      board.length = 0;
      for (let pi = 0; pi < np; pi++) {
        const p = sp.players[pi], hnd = hands[pi];
        hnd.length = 0;
        for (let k = 0; k < p.known.length; k++) hnd.push(p.known[k]);
        if (!p.need) continue;
        const c = cut && cut[pi];
        if (!c) { for (let i = 0; i < p.need; i++) hnd.push(draw()); continue; }
        // rejection-sample this player until the holding falls inside the range
        const save = di, base = hnd.length;
        for (let a = 0; a < tries; a++) {
          di = save; hnd.length = base;
          for (let i = 0; i < p.need; i++) hnd.push(draw());
          const sc = strengths(sp.key, hnd);
          if ((c.hi != null && sc.hi >= c.hi) || (c.lo != null && sc.lo <= c.lo)) { acc.hit++; break; }
          if (a === tries - 1) acc.miss++;
        }
      }
      for (let i = 0; i < sp.board.length; i++) board.push(sp.board[i]);
      for (let i = 0; i < sp.boardNeed; i++) board.push(draw());
      if (sp.draws) {
        let rounds = 0;
        for (let pi = 0; pi < np; pi++) rounds = Math.max(rounds, sp.draws[pi].length);
        for (let r = 0; r < rounds; r++) {
          for (let pi = 0; pi < np; pi++) {
            const cnt = sp.draws[pi][r] || 0;
            if (!cnt) continue;
            const hnd = hands[pi];
            const kill = pickDiscards(sp.key, hnd, cnt);
            for (const i of kill) hnd[i] = draw();
          }
        }
      }
      const lowMade = sharesInto(sp.key, hands, board, out, acc.oHi, acc.oLo);
      let top = 0;
      for (let pi = 0; pi < np; pi++) { acc.eq[pi] += out[pi]; if (out[pi] > top) top = out[pi]; }
      if (acc.split) {
        for (let pi = 0; pi < np; pi++) {
          acc.hi[pi] += acc.oHi[pi];
          if (lowMade) acc.lo[pi] += acc.oLo[pi];
        }
        if (lowMade) acc.lowN++;
      }
      if (top < 0.999) acc.ties++;
      acc.n++;
    }
  }

  /* ---------- range support: rank the holdings a player could have here ---- */
  function calibrate(sp, N) {
    const np = sp.players.length, out = new Array(np).fill(null);
    const len = sp.deck.length, work = new Uint8Array(len), hnd = [];
    for (let pi = 0; pi < np; pi++) {
      if (!sp.rangeable[pi]) continue;
      const p = sp.players[pi], his = [], los = [];
      for (let s = 0; s < N; s++) {
        work.set(sp.deck);
        let di = 0;
        hnd.length = 0;
        for (let k = 0; k < p.known.length; k++) hnd.push(p.known[k]);
        for (let i = 0; i < p.need; i++) {
          const j = di + ((Math.random() * (len - di)) | 0);
          const v = work[j]; work[j] = work[di]; work[di] = v; di++; hnd.push(v);
        }
        const sc = strengths(sp.key, hnd);
        if (sc.hi != null) his.push(sc.hi);
        if (sc.lo != null) los.push(sc.lo);
      }
      his.sort((a, b) => a - b); los.sort((a, b) => a - b);
      out[pi] = { his: his, los: los };
    }
    return out;
  }

  function cutFor(cal, range) {
    const out = new Array(cal.length).fill(null);
    for (let pi = 0; pi < cal.length; pi++) {
      if (!cal[pi]) continue;
      const c = { hi: null, lo: null }, his = cal[pi].his, los = cal[pi].los;
      if (his.length) c.hi = his[Math.min(his.length - 1, Math.max(0, Math.floor((1 - range) * his.length)))];
      if (los.length) c.lo = los[Math.min(los.length - 1, Math.max(0, Math.ceil(range * los.length) - 1))];
      out[pi] = c;
    }
    return out;
  }

  function start(sp, sims, cb, opts) {
    opts = opts || {};
    const np = sp.players.length;
    const range = opts.range == null ? 1 : Math.max(0.01, Math.min(1, opts.range));
    const split = !!SPLIT_GAMES[sp.key];
    const acc = {
      eq: new Array(np).fill(0), n: 0, ties: 0, split: split, lowN: 0,
      hi: new Array(np).fill(0), lo: new Array(np).fill(0),
      oHi: split ? new Array(np).fill(0) : null, oLo: split ? new Array(np).fill(0) : null,
      work: null, hands: null, board: null, out: null, cut: null, tries: 1, hit: 0, miss: 0,
    };
    let cancelled = false;
    if (sp.exact) {
      runSlice(sp, 1, acc);
      cb({
        eq: acc.eq.slice(), n: 1, ties: acc.ties, done: true, exact: true, ranged: false,
        hi: split ? acc.hi.slice() : null,
        lo: split && acc.lowN ? acc.lo.slice() : null,
        lowFreq: split ? acc.lowN : null,
      });
      return () => { };
    }
    const useRange = range < 0.999 && sp.rangeable.some(Boolean);
    if (useRange) {
      acc.cut = cutFor(calibrate(sp, 20000), range);
      acc.tries = Math.min(900, Math.max(20, Math.ceil(14 / range)));
    }
    // keep each slice near a frame's worth of work whatever the table size
    const heavy = sp.key === 'omaha' || sp.key === 'omaha8';
    const base = (heavy ? 4000 : 16000) / np;
    const SLICE = Math.max(300, Math.round(base * (useRange ? Math.max(range, 0.06) : 1)));
    const tick = () => {
      if (cancelled) return;
      runSlice(sp, Math.min(SLICE, sims - acc.n), acc);
      const done = acc.n >= sims;
      cb({
        eq: acc.eq.map(v => v / acc.n), n: acc.n, ties: acc.ties / acc.n,
        done: done, exact: false, ranged: useRange,
        hi: split ? acc.hi.map(v => v / acc.n) : null,
        lo: split && acc.lowN ? acc.lo.map(v => v / acc.lowN) : null,
        lowFreq: split ? acc.lowN / acc.n : null,
        misses: acc.hit + acc.miss ? acc.miss / (acc.hit + acc.miss) : 0,
      });
      if (!done) setTimeout(tick, 0);
    };
    setTimeout(tick, 0);
    return () => { cancelled = true; };
  }

  global.PSEquity = {
    cid, evalHigh, lowA5Best, lowA5_5, low8Best, badugiEval, omahaHi, omahaLo8,
    shares, sharesInto, spec, start, remainingDraws, pickDiscards, strengths, calibrate, cutFor,
  };
})(window);
