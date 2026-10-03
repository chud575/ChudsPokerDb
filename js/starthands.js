/* ===========================================================================
   starthands.js — every starting hand you have been dealt, and how it did.

   A starting hand is what you held when the first betting round began: two
   hole cards in hold'em, four or five in Omaha, the three on third street in
   stud, the first five (four in badugi) in a draw game.  Each one gets two
   names:

     exact  — the hand itself, suits reduced to what matters ("AKs", "(A2)3",
              "2-3-4-7-9", "A-2-K-Q ds")
     group  — the kind of hand it is ("Suited broadway", "Three to a 7",
              "1-card draw to a 7", "A2 with a suited ace")

   Results are in big bets (limit) / big blinds (no-limit, pot-limit) so that
   level 1 and level 12 of a tournament can be added together.
   =========================================================================== */
(function (global) {
  'use strict';
  const $ = s => document.querySelector(s);
  const el = (t, c, x) => { const e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; };

  /* ---------- cards ---------- */
  const RN = '23456789TJQKA';
  const hi = c => RN.indexOf(c[0]) + 2;                 // 2..14, ace high
  const lo = c => c[0] === 'A' ? 1 : hi(c);             // ace low
  const su = c => c[1];
  const ch = v => v === 1 ? 'A' : RN[v - 2];
  const counts = vals => { const m = {}; vals.forEach(v => { m[v] = (m[v] || 0) + 1; }); return m; };
  const suitShape = cards => {                          // ds / ss / rainbow
    const n = Object.values(counts(cards.map(su))).filter(x => x >= 2).sort((a, b) => b - a);
    return n.length >= 2 ? 'ds' : n.length === 1 ? 'ss' : 'r';
  };

  /* ---------- one classifier per kind of game: cards -> { exact, group } ---------- */
  function holdem(c) {
    const [a, b] = c.slice().sort((x, y) => hi(y) - hi(x));
    const A = hi(a), B = hi(b), s = su(a) === su(b);
    if (A === B) return { exact: a[0] + b[0], group: A >= 10 ? 'Pocket pairs, TT+' : 'Pocket pairs, 22–99' };
    const exact = a[0] + b[0] + (s ? 's' : 'o');
    let group;
    if (s) group = B >= 10 ? 'Suited broadway' : A === 14 ? 'Suited aces' : A - B <= 2 ? 'Suited connectors and one-gappers' : 'Other suited';
    else group = B >= 10 ? 'Offsuit broadway' : A === 14 ? 'Offsuit aces' : A - B <= 1 ? 'Offsuit connectors' : 'Other offsuit';
    return { exact, group };
  }

  // stud: two in the hole, then the door card
  function studShape(c, val) {
    const hole = c.slice(0, 2).sort((x, y) => val(y) - val(x)), door = c[2];
    const v = c.map(val), cnt = counts(v), mx = Math.max(...Object.values(cnt));
    const flush3 = su(c[0]) === su(c[1]) && su(c[1]) === su(c[2]);
    return { hole, door, v, mx, flush3, buried: val(c[0]) === val(c[1]), pairRank: +Object.keys(cnt).find(k => cnt[k] >= 2) || 0 };
  }
  function studHi(c) {
    const s = studShape(c, hi);
    const exact = '(' + s.hole.map(x => x[0]).join('') + ')' + s.door[0] + (s.flush3 ? ' s' : '');
    const sorted = s.v.slice().sort((a, b) => a - b);
    const straight3 = s.mx === 1 && (sorted[2] - sorted[0] === 2 || (sorted[2] === 14 && sorted[0] === 2 && sorted[1] === 3));
    let group;
    if (s.mx === 3) group = 'Rolled up';
    else if (s.mx === 2) group = (s.buried ? 'Buried pair' : 'Split pair') + (s.pairRank >= 10 ? ', T or bigger' : ', 9 or smaller');
    else if (s.flush3) group = 'Three-flush';
    else if (straight3) group = 'Three-straight';
    else if (sorted[0] >= 10) group = 'Three big cards';
    else group = 'No pair, no draw';
    return { exact, group };
  }
  function stud8(c) {
    const s = studShape(c, hi);
    const exact = '(' + s.hole.map(x => x[0]).join('') + ')' + s.door[0] + (s.flush3 ? ' s' : '');
    const low = c.filter(x => lo(x) <= 8), nLow = new Set(low.map(lo)).size;
    const hasA = c.some(x => x[0] === 'A');
    let group;
    if (s.mx === 3) group = 'Rolled up';
    else if (s.mx === 2) {
      const kicker = c.find(x => hi(x) !== s.pairRank);
      if (s.pairRank === 14) group = 'Pair of aces';
      else if (s.pairRank >= 9) group = 'High pair (9–K)';
      else group = lo(kicker) <= 8 ? 'Low pair with a low card' : 'Low pair with a high card';
    } else if (nLow === 3) {
      group = Math.max(...c.map(lo)) <= 5 ? 'Three wheel cards (A–5)' : hasA ? 'Three low cards with an ace' : 'Three low cards, no ace';
    } else if (s.flush3) group = 'Three-flush, not three low';
    else if (nLow === 2) group = 'Two low cards and a high one';
    else if (nLow === 1) group = 'One low card and two high';
    else group = 'Three high cards';
    return { exact, group };
  }
  function razz(c) {
    const s = studShape(c, lo);
    const hole = c.slice(0, 2).sort((x, y) => lo(x) - lo(y));
    const exact = '(' + hole.map(x => x[0]).join('') + ')' + s.door[0];
    const top = Math.max(...s.v);
    let group;
    if (s.mx > 1) group = 'Paired';
    else if (top <= 5) group = 'Three to a wheel (5 or better)';
    else if (top <= 8) group = 'Three to ' + (top === 8 ? 'an 8' : 'a ' + top);
    else if (top === 9) group = 'Three to a 9';
    else group = 'Rough (T or higher showing in the three)';
    return { exact, group };
  }

  // lowball draw: 2-7 (ace high, straights and flushes count against you) or A-5 (ace low, they don't)
  function lowDraw(c, deuce) {
    const val = deuce ? hi : lo;
    const v = c.map(val).sort((a, b) => a - b);
    const exact = v.map(ch).join('-');
    const keep = [...new Set(v)].filter(x => x <= 8);                 // distinct cards 8 or lower
    const distinct = new Set(v).size === 5;
    const flush = new Set(c.map(su)).size === 1;
    const straight = distinct && (v[4] - v[0] === 4 || (deuce && v.join() === '2,3,4,5,14'));
    const madeBad = deuce && (flush || straight);
    let group;
    if (distinct && !madeBad && v[4] <= 9) group = 'Pat ' + ch(v[4]);
    else if (keep.length >= 4) {
      const top = keep[3];                                            // the worst of the four you would keep
      group = '1-card draw to ' + (top === 8 ? 'an 8' : deuce ? 'a 7' : top <= 5 ? 'a wheel' : 'a ' + ch(top));
    } else if (keep.length === 3) group = '2-card draw' + (deuce ? (keep.includes(2) ? ', with a deuce' : ', no deuce') : (keep.includes(1) ? ', with an ace' : ', no ace'));
    else if (keep.length === 2) group = '3-card draw';
    else group = '4 or 5 card draw';
    return { exact, group };
  }
  function badugi(c) {
    // best badugi: the most cards with all ranks and all suits different, then the lowest
    const key = sub => sub.map(lo).sort((x, y) => y - x);            // highest card first
    const lower = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i]; return false; };
    let best = [];
    for (let m = 1; m < 1 << c.length; m++) {
      const sub = c.filter((_, i) => m >> i & 1);
      if (new Set(sub.map(lo)).size !== sub.length || new Set(sub.map(su)).size !== sub.length) continue;
      if (sub.length > best.length || (sub.length === best.length && lower(key(sub), key(best)))) best = sub;
    }
    const v = best.map(lo).sort((x, y) => x - y), top = v[v.length - 1], n = v.length;
    const exact = v.map(ch).join('-') + (n === 4 ? '' : '  (' + n + '-card)');
    let group;
    if (n === 4) group = top <= 7 ? 'Pat badugi, 7 or better' : 'Pat badugi, 8 to K';
    else if (n === 3) group = top <= 5 ? '3-card badugi, 5 or better' : top <= 7 ? '3-card badugi, 6 or 7' : '3-card badugi, 8 or worse';
    else group = n + '-card badugi';
    return { exact, group };
  }
  function fiveDraw(c) {
    const v = c.map(hi).sort((a, b) => b - a), cnt = Object.values(counts(v)).sort((a, b) => b - a);
    const flush = new Set(c.map(su)).size === 1;
    const straight = new Set(v).size === 5 && (v[0] - v[4] === 4 || v.join() === '14,5,4,3,2');
    const pr = +Object.keys(counts(v)).filter(k => counts(v)[k] === 2).sort((a, b) => b - a)[0] || 0;
    const exact = v.map(ch).join('');
    let group;
    if (flush || straight || cnt[0] === 4 || (cnt[0] === 3 && cnt[1] === 2)) group = 'Pat hand (straight or better)';
    else if (cnt[0] === 3) group = 'Three of a kind';
    else if (cnt[0] === 2 && cnt[1] === 2) group = 'Two pair';
    else if (cnt[0] === 2) group = pr >= 11 ? 'Big pair (JJ+)' : 'Small pair (TT or lower)';
    else group = Math.max(...Object.values(counts(c.map(su)))) === 4 ? 'Four-flush' : 'No pair';
    return { exact, group };
  }
  const omahaExact = c => c.slice().sort((x, y) => hi(y) - hi(x)).map(x => x[0]).join('') + ' ' + suitShape(c);
  function omaha8(c) {
    const r = new Set(c.map(lo));
    const aces = c.filter(x => x[0] === 'A');
    const suitedAce = aces.some(a => c.some(x => x !== a && su(x) === su(a)));
    const lows = [...r].filter(x => x <= 8).length;
    let group;
    if (r.has(1) && r.has(2)) group = suitedAce ? 'A2 with a suited ace' : 'A2, ace not suited';
    else if (r.has(1) && r.has(3)) group = 'A3';
    else if (aces.length >= 2) group = 'AA without a 2 or 3';
    else if (r.has(1) && (r.has(4) || r.has(5))) group = 'A4 / A5';
    else if (r.has(1)) group = 'Ace with no wheel card';
    else if ([...r].filter(x => x <= 5).length >= 3) group = 'No ace, three wheel cards';
    else if (lows === 0 || c.every(x => hi(x) >= 9)) group = 'Four high cards (9+)';
    else group = lows >= 2 ? 'No ace, two or more low cards' : 'Mostly high, one low card';
    return { exact: omahaExact(c), group };
  }
  function omahaHi(c) {
    const v = c.map(hi), cnt = counts(v), pairs = Object.keys(cnt).filter(k => cnt[k] >= 2).map(Number);
    const d = [...new Set(v)].sort((a, b) => a - b), shape = suitShape(c);
    let group;
    if (pairs.includes(14)) group = 'Aces';
    else if (pairs.length >= 2) group = 'Double paired';
    else if (pairs.some(p => p >= 12)) group = 'KK / QQ';
    else if (d.length === c.length && d[d.length - 1] - d[0] <= c.length) group = 'Rundown';
    else if (v.every(x => x >= 10)) group = 'Broadway cards';
    else if (pairs.length) group = 'Other pair';
    else group = shape === 'ds' ? 'Double suited, unconnected' : 'Other';
    return { exact: omahaExact(c), group };
  }

  const BY_GAME = {
    holdem: holdem, omaha8: omaha8, omaha: omahaHi, o5: omahaHi,
    stud: studHi, stud8: stud8, razz: razz,
    td27: c => lowDraw(c, true), sd27: c => lowDraw(c, true), a5td: c => lowDraw(c, false), a5sd: c => lowDraw(c, false),
    badugi: badugi, fcd: fiveDraw,
  };
  const NEED = { holdem: 2, omaha8: 4, omaha: 4, o5: 5, stud: 3, stud8: 3, razz: 3, td27: 5, sd27: 5, a5td: 5, a5sd: 5, badugi: 4, fcd: 5 };

  function classify(h) {
    const fn = BY_GAME[h.game.key];
    if (!fn || !h.hero) return null;
    const d = h.events.find(e => e.t === 'deal' && e.player === h.hero);
    if (!d) return null;
    const cards = d.all.slice(0, NEED[h.game.key]);
    if (cards.length < NEED[h.game.key] || cards.some(c => !/^[2-9TJQKA][cdhs]$/.test(c))) return null;
    const r = fn(cards);
    r.cards = cards;
    return r;
  }

  /* how often each kind of hand is dealt, from 20,000 random deals (the same
     ones every time) — the yardstick for "was I dealt my share of good hands" */
  const freqCache = {};
  function frequencies(gameKey) {
    if (freqCache[gameKey]) return freqCache[gameKey];
    const fn = BY_GAME[gameKey], need = NEED[gameKey];
    if (!fn) return null;
    const deck = [];
    for (const r of RN) for (const u of 'cdhs') deck.push(r + u);
    let a = 0x9e3779b9 ^ gameKey.length * 7919;
    for (const ch2 of gameKey) a = Math.imul(a ^ ch2.charCodeAt(0), 2654435761);
    const rnd = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    const N = 20000, out = {};
    for (let n = 0; n < N; n++) {
      for (let k = 0; k < need; k++) { const j = k + Math.floor(rnd() * (52 - k)); const t = deck[k]; deck[k] = deck[j]; deck[j] = t; }
      const g = fn(deck.slice(0, need)).group;
      out[g] = (out[g] || 0) + 1 / N;
    }
    return (freqCache[gameKey] = out);
  }

  /* ---------- the numbers ---------- */
  const blank = () => ({ dealt: 0, played: 0, won: 0, wonPlayed: 0, sd: 0, sdWon: 0, bb: 0, bbPlayed: 0, best: 0, worst: 0, hands: [] });

  /* hands for one hero -> { gameKey: { label, exact: {name: stat}, group: {name: stat}, all: stat } } */
  function collect(hands, hero) {
    const out = {};
    for (const h of hands) {
      if (h.hero !== hero) continue;
      const c = classify(h);
      if (!c) continue;
      const row = PSStats.rowsFor(h)[hero];
      if (!row || !row.dealt) continue;
      const unit = h.bb || h.sb || 1;
      const bb = row.net / unit;
      const g = out[h.game.key] || (out[h.game.key] = { label: h.game.label, exact: {}, group: {}, tkey: {}, all: blank(), groupOf: {}, sizes: {} });
      g.groupOf[c.exact] = c.group;
      // the name the HORSE+ EV table uses for these cards, and how many were dealt in
      const tk = global.PSEV ? PSEV.tableKey(h.game.key, c.cards) : null;
      const n = h.seats.filter(z => z.inHand).length;
      g.sizes[n] = (g.sizes[n] || 0) + 1;
      const into = [g.exact[c.exact] || (g.exact[c.exact] = blank()), g.group[c.group] || (g.group[c.group] = blank()), g.all];
      if (tk) into.push(g.tkey[tk] || (g.tkey[tk] = blank()));
      for (const s of into) {
        s.dealt++;
        if (row.vpip) { s.played++; s.bbPlayed += bb; if (row.net > 0) s.wonPlayed++; }
        if (row.net > 0) s.won++;
        if (row.showdown) { s.sd++; if (row.showdownWon) s.sdWon++; }
        s.bb += bb;
        if (bb > s.best) s.best = bb;
        if (bb < s.worst) s.worst = bb;
        s.hands.push({ h: h, bb: bb, played: !!row.vpip, sd: !!row.showdown, folded: row.folds > 0, cards: c.cards, exact: c.exact, tkey: tk, n: n });
      }
    }
    return out;
  }

  const pct = (a, b) => b ? Math.round(100 * a / b) + '%' : '—';
  const sgn = v0 => {
    const d = Math.abs(v0) >= 100 ? 0 : 1, v = +v0.toFixed(d) || 0;      // no "−0.0"
    return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(d);
  };
  const MIN_SAMPLE = 8;
  function verdict(s) {
    if (s.dealt < MIN_SAMPLE) return ['Too few to say', 'thin'];
    const per = s.bb / s.dealt;
    if (per > 0.05) return ['Profitable', 'up'];
    if (per < -0.05) return ['Losing', 'dn'];
    return ['Break-even', ''];
  }

  /* the write-up for one hand or group */
  function notesFor(name, s, unit) {
    const out = [];
    const v = verdict(s);
    out.push(v[0] === 'Too few to say'
      ? 'Dealt ' + s.dealt + ' time' + (s.dealt === 1 ? '' : 's') + ' — too few to judge (the verdict needs ' + MIN_SAMPLE + ').'
      : v[0] + ': ' + sgn(s.bb) + ' ' + unit + ' over ' + s.dealt + ' deals, ' + sgn(s.bb / s.dealt) + ' per deal.');
    out.push('You played it ' + s.played + ' of ' + s.dealt + ' times (' + pct(s.played, s.dealt) + ')' +
      (s.played ? ' and won ' + s.wonPlayed + ' of those (' + pct(s.wonPlayed, s.played) + '), for ' + sgn(s.bbPlayed) + ' ' + unit +
        ' — ' + sgn(s.bbPlayed / s.played) + ' each time you played.' : '.'));
    const folded = s.dealt - s.played, lostFold = s.bb - s.bbPlayed;
    if (folded) out.push('The other ' + folded + ' time' + (folded === 1 ? '' : 's') + ' you did not put money in voluntarily: ' + sgn(lostFold) + ' ' + unit +
      ' (antes, blinds, bring-ins, and blinds that held up).');
    if (s.sd) out.push('It reached showdown ' + s.sd + ' time' + (s.sd === 1 ? '' : 's') + ' and won ' + s.sdWon + ' (' + pct(s.sdWon, s.sd) + ').');
    else if (s.played) out.push('It never reached showdown.');
    if (s.played) out.push('Best result ' + sgn(s.best) + ' ' + unit + ', worst ' + sgn(s.worst) + ' ' + unit + '.');
    if (s.played >= 5 && s.wonPlayed / s.played >= 0.5 && s.bbPlayed / s.played < -0.05) out.push('It wins more often than not but still loses when played — the losses are bigger than the wins.');
    if (s.played >= 5 && s.wonPlayed / s.played < 0.4 && s.bbPlayed / s.played > 0.05) out.push('It loses more often than it wins but makes money — the wins are bigger than the losses.');
    return out;
  }

  /* ---------- the screen ---------- */
  let data = null, hero = '', game = '', mode = 'group', picked = '', evN = 0, evSort = 'eq';

  /* what the EV table says about a set of deals: average equity at the table size
     each was dealt at, against the fair share (1 ÷ players) at that size */
  function evOf(st) {
    let e = 0, f = 0, n = 0;
    for (const x of st.hands) {
      const v = PSEV.eq(game, x.tkey, x.n);
      if (v == null) continue;
      e += v; f += 1 / PSEV.clampN(game, x.n); n++;
    }
    return n ? { eq: e / n, fair: f / n, n: n } : null;
  }
  const evReady = () => global.PSEV && PSEV.table(game);
  const KEY = 'psreplayer.starthands';

  async function render() {
    const body = $('#shBody');
    if (!PSHome.libOk) { body.innerHTML = '<div class="empty warn">The library is unavailable here.</div>'; return; }
    body.innerHTML = '<div class="empty">reading your hands…</div>';
    const lib = await PSHome.library();
    const heroes = {};
    lib.hands.forEach(h => { if (h.hero) heroes[h.hero] = (heroes[h.hero] || 0) + 1; });
    const names = Object.keys(heroes).sort((a, b) => heroes[b] - heroes[a]);
    try { const st = JSON.parse(localStorage.getItem(KEY)) || {}; hero = hero || st.hero || ''; game = game || st.game || ''; mode = st.mode || mode; evSort = st.evSort || evSort; } catch (e) { }
    if (!names.includes(hero)) hero = names[0] || '';
    const hs = $('#shHero');
    hs.innerHTML = '';
    names.forEach(n => hs.appendChild(new Option(n + ' — ' + heroes[n].toLocaleString() + ' hands', n)));
    hs.value = hero;
    if (!hero) { body.innerHTML = '<div class="empty">No hands in the library yet — import hand histories first.</div>'; $('#shDetail').innerHTML = ''; return; }
    data = collect(lib.hands, hero);
    const keys = Object.keys(data).sort((a, b) => data[b].all.dealt - data[a].all.dealt);
    if (!keys.includes(game)) game = keys[0] || '';
    const gs = $('#shGame');
    gs.innerHTML = '';
    keys.forEach(k => gs.appendChild(new Option(data[k].label + ' — ' + data[k].all.dealt.toLocaleString() + ' hands', k)));
    gs.value = game;
    $('#shMode').value = mode;
    $('#shSort').value = evSort;
    draw();
  }

  const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ hero, game, mode, evSort })); } catch (e) { } };
  // limit games are measured in big bets, no-limit and pot-limit in big blinds
  function unitOf() {
    const hs = (data[game] && data[game].all.hands) || [];
    const big = hs.filter(x => /NL|PL/.test(x.h.game.betting || '')).length;
    return big * 2 > hs.length ? 'big blinds' : 'big bets';
  }

  function draw() {
    const body = $('#shBody');
    body.innerHTML = '';
    const g = data && data[game];
    if (!g) { body.appendChild(el('div', 'empty', 'No starting hands for ' + hero + ' in this game.')); $('#shDetail').innerHTML = ''; return; }
    // the HORSE+ EV table for this game, loaded the first time it is needed
    if (global.PSEV && PSEV.has(game) && !PSEV.table(game)) { PSEV.load(game).then(t => { if (t) draw(); }); }
    const evNow = evReady();
    const pl = $('#shPlayers');
    pl.style.display = (mode === 'grid' || mode === 'list') ? '' : 'none';
    $('#shSortL').style.display = pl.style.display;
    if (evNow) {
      const cs = PSEV.counts(game);
      const usual = +Object.keys(g.sizes).sort((a, b) => g.sizes[b] - g.sizes[a])[0] || cs[0];
      if (!cs.includes(evN)) evN = PSEV.clampN(game, usual);
      pl.innerHTML = '';
      cs.forEach(n => pl.appendChild(new Option(n + ' players' + (n === PSEV.clampN(game, usual) ? ' (your usual)' : ''), n)));
      pl.value = evN;
    }
    if (mode === 'grid' || mode === 'list') { evView(body, g, evNow); return; }
    const unit = unitOf(), u = unit === 'big blinds' ? 'BB' : 'BB';
    const min = Math.max(1, +$('#shMin').value || 1);
    const q = ($('#shFind').value || '').trim().toLowerCase();
    const src = mode === 'group' ? g.group : g.exact;
    const names = Object.keys(src).filter(n => src[n].dealt >= min &&
      (!q || n.toLowerCase().includes(q) || (mode === 'exact' && (g.groupOf[n] || '').toLowerCase().includes(q))));

    // totals for the game
    const a = g.all, k = el('div', 'trKpis');
    const kpi = (label, v, cls) => { const d = el('div', 'kpi ' + (cls || '')); d.appendChild(el('b', null, v)); d.appendChild(el('small', null, label)); k.appendChild(d); };
    kpi('hands dealt', a.dealt.toLocaleString());
    kpi('played', pct(a.played, a.dealt));
    kpi('won when played', pct(a.wonPlayed, a.played));
    kpi('won at showdown', pct(a.sdWon, a.sd));
    kpi('net, ' + unit, sgn(a.bb), a.bb > 0 ? 'up' : a.bb < 0 ? 'dn' : '');
    kpi('per 100 hands', sgn(100 * a.bb / a.dealt), a.bb > 0 ? 'up' : a.bb < 0 ? 'dn' : '');
    kpi(mode === 'group' ? 'kinds of hand' : 'different hands', String(Object.keys(src).length));
    body.appendChild(k);
    body.appendChild(el('div', 'dim trNote', 'Net is in ' + unit + ' at the level each hand was played, so early and late levels add up fairly. ' +
      '“Played” means you put money in by choice on the first round (a call or a raise) — blinds, antes and bring-ins alone do not count. Click a row for the write-up and the hands.' +
      (evNow ? ' “Table equity” is the HORSE+ EV table: the share of the pot these cards win all-in to the end against random hands, at the number of players each was dealt with; “vs fair share” compares it with 1 ÷ players.' : '')));

    const t = el('table', 'tbl stats shTbl');
    const hr = t.insertRow();
    const cols = [mode === 'group' ? 'Kind of hand' : 'Hand'];
    if (mode === 'exact') cols.push('Kind');
    cols.push('Dealt');
    if (evNow) cols.push('Table equity', 'vs fair share');
    cols.push('Played', 'Played %', 'Won', 'Win % (played)', 'Showdowns', 'Won at SD', 'Net ' + u, u + ' / deal', u + ' / played', 'Verdict');
    cols.forEach(h => { const th = document.createElement('th'); th.textContent = h; hr.appendChild(th); });
    names.sort((x, y) => src[y].dealt - src[x].dealt || x.localeCompare(y)).forEach(n => {
      const s = src[n], v = verdict(s), r = t.insertRow();
      const cells = [n];
      if (mode === 'exact') cells.push(g.groupOf[n] || '');
      cells.push(s.dealt);
      const ev = evNow ? evOf(s) : null;
      if (evNow) cells.push(ev ? (100 * ev.eq).toFixed(1) + '%' : '—', ev ? sgn(100 * (ev.eq - ev.fair)) + ' pts' : '—');
      cells.push(s.played, pct(s.played, s.dealt), s.wonPlayed, pct(s.wonPlayed, s.played), s.sd, pct(s.sdWon, s.sd),
        sgn(s.bb), sgn(s.bb / s.dealt), s.played ? sgn(s.bbPlayed / s.played) : '—', v[0]);
      cells.forEach((x, i) => {
        const c = r.insertCell(); c.textContent = x;
        const name = cols[i];
        if (name === 'Net ' + u) c.className = s.bb > 0 ? 'up' : s.bb < 0 ? 'dn' : '';
        if (name === 'Verdict') c.className = v[1];
        if (name === 'vs fair share' && ev) c.className = ev.eq > ev.fair ? 'up' : 'dn';
      });
      r.cells[0].className = 'pl';
      r.dataset.name = n;
      r.style.cursor = 'pointer';
      if (n === picked) r.classList.add('me');
      r.onclick = () => { picked = n; t.querySelectorAll('tr.me').forEach(x => x.classList.remove('me')); r.classList.add('me'); detail(n, s, unit); };
    });
    body.appendChild(el('div', 'plMeta', names.length + ' of ' + Object.keys(src).length + (mode === 'group' ? ' kinds of hand' : ' hands') +
      (min > 1 ? ' dealt ' + min + '+ times' : '')));
    body.appendChild(global.PSTourneys ? PSTourneys.sortable(t) : t);
    if (picked && src[picked]) detail(picked, src[picked], unit); else { picked = ''; $('#shDetail').innerHTML = '<div class="empty">Click a hand for its write-up and every time you held it.</div>'; }
  }

  /* ---------- the HORSE+ EV table, with your results laid over it ---------- */
  function evView(body, g, evNow) {
    if (!global.PSEV || !PSEV.has(game)) { body.appendChild(el('div', 'empty', 'HORSE+ has no EV table for ' + g.label + ' — the tables cover Razz, Stud, Stud Hi/Lo, Omaha Hi/Lo and Hold’em.')); $('#shDetail').innerHTML = ''; return; }
    if (!evNow) { body.appendChild(el('div', 'empty', 'loading the ' + g.label + ' EV table…')); return; }
    const T = PSEV.table(game), row = T.players[String(evN)], fair = 1 / evN;
    const unit = unitOf();
    const q = ($('#shFind').value || '').trim().toLowerCase();
    let keys = Object.keys(row).filter(k => !q || PSEV.pretty(game, k).toLowerCase().includes(q) || k.toLowerCase().includes(q));
    const st = k => g.tkey[k];
    const by = {
      eq: (a, b) => row[b] - row[a],
      dealt: (a, b) => ((st(b) || {}).dealt || 0) - ((st(a) || {}).dealt || 0) || row[b] - row[a],
      net: (a, b) => ((st(b) || {}).bb || 0) - ((st(a) || {}).bb || 0) || row[b] - row[a],
      per: (a, b) => { const x = st(a), y = st(b); return (y && y.dealt >= 3 ? y.bb / y.dealt : -1e9) - (x && x.dealt >= 3 ? x.bb / x.dealt : -1e9) || row[b] - row[a]; },
    }[evSort] || ((a, b) => row[b] - row[a]);
    keys.sort(by);
    const rankOf = {};
    Object.keys(row).sort((a, b) => row[b] - row[a]).forEach((k, i) => { rankOf[k] = i + 1; });
    const dealtKeys = Object.keys(g.tkey).filter(k => row[k] != null);
    const yours = dealtKeys.reduce((a, k) => a + g.tkey[k].dealt, 0);

    const head = el('div', 'evHead');
    head.appendChild(el('span', null, Object.keys(row).length.toLocaleString() + ' hands'));
    head.appendChild(el('span', null, 'fair share ' + (100 * fair).toFixed(1) + '%'));
    head.appendChild(el('span', null, 'you were dealt ' + dealtKeys.length + ' of them, ' + yours + ' times'));
    head.appendChild(el('span', 'dim', 'HORSE+ EV table · ' + T.note));
    body.appendChild(head);
    body.appendChild(el('div', 'dim trNote', 'Colour = the table’s equity against the fair share at ' + evN + ' players (greener above, redder below). Your results sit on top: times dealt and net ' + unit +
      ' across every table size, with a bar on the left — green if the hand has made you money, red if it has cost you, none if you have held it under 3 times. Dimmed = never dealt to you.'));

    const shown = keys.slice(0, 600);
    if (mode === 'grid') {
      const grid = el('div', 'evGrid');
      shown.forEach(k => {
        const e = row[k], s2 = st(k), t = el('div', 'evTile');
        const d = Math.max(-1, Math.min(1, (e - fair) / (e >= fair ? 1 - fair : fair)));
        t.style.setProperty('--h', d >= 0 ? 140 : 0);
        t.style.setProperty('--a', (0.18 + 0.62 * Math.abs(d)).toFixed(2));
        if (!s2) t.classList.add('never');
        else if (s2.dealt >= 3) t.classList.add(s2.bb > 0 ? 'won' : s2.bb < 0 ? 'lost' : 'even');
        t.appendChild(el('b', null, PSEV.pretty(game, k)));
        t.appendChild(el('span', 'eq', (100 * e).toFixed(1) + '%'));
        t.appendChild(el('span', 'you', s2 ? '×' + s2.dealt + ' · ' + sgn(s2.bb) : '—'));
        t.title = '#' + rankOf[k] + ' of ' + Object.keys(row).length + (s2 ? ' · dealt ' + s2.dealt + ', played ' + s2.played + ', won ' + s2.wonPlayed + ', net ' + sgn(s2.bb) + ' ' + unit : ' · never dealt to you');
        t.onclick = () => { picked = k; grid.querySelectorAll('.sel').forEach(x => x.classList.remove('sel')); t.classList.add('sel'); detail(PSEV.pretty(game, k), s2 || blank(), unit, k); };
        if (k === picked) t.classList.add('sel');
        grid.appendChild(t);
      });
      body.appendChild(grid);
    } else {
      const t = el('table', 'tbl stats shTbl evList');
      const hr = t.insertRow();
      ['#', 'Hand', 'Table equity', '', 'vs fair', 'Dealt to you', 'Played', 'Win % (played)', 'Net ' + 'BB', 'BB / deal', 'Verdict'].forEach(h => { const th = document.createElement('th'); th.textContent = h; hr.appendChild(th); });
      shown.forEach(k => {
        const e = row[k], s2 = st(k), r = t.insertRow();
        r.insertCell().textContent = rankOf[k];
        r.insertCell().textContent = PSEV.pretty(game, k);
        r.insertCell().textContent = (100 * e).toFixed(1) + '%';
        const bc = r.insertCell(), bar = el('div', 'evBar'), fill = el('i');
        fill.style.width = (100 * Math.min(1, e / Math.max(...Object.values(row)))).toFixed(1) + '%';
        fill.className = e >= fair ? 'up' : 'dn';
        bar.appendChild(fill); bc.appendChild(bar);
        const vf = r.insertCell(); vf.textContent = sgn(100 * (e - fair)) + ' pts'; vf.className = e >= fair ? 'up' : 'dn';
        if (s2) {
          const v = verdict(s2);
          [s2.dealt, pct(s2.played, s2.dealt), pct(s2.wonPlayed, s2.played)].forEach(x => { r.insertCell().textContent = x; });
          const nc = r.insertCell(); nc.textContent = sgn(s2.bb); nc.className = s2.bb > 0 ? 'up' : s2.bb < 0 ? 'dn' : '';
          r.insertCell().textContent = sgn(s2.bb / s2.dealt);
          const vc = r.insertCell(); vc.textContent = v[0]; vc.className = v[1];
        } else { for (let i = 0; i < 6; i++) r.insertCell().textContent = i ? '' : '—'; r.classList.add('never'); }
        r.cells[1].className = 'pl';
        r.style.cursor = 'pointer';
        if (k === picked) r.classList.add('me');
        r.onclick = () => { picked = k; t.querySelectorAll('tr.me').forEach(x => x.classList.remove('me')); r.classList.add('me'); detail(PSEV.pretty(game, k), s2 || blank(), unit, k); };
      });
      body.appendChild(global.PSTourneys ? PSTourneys.sortable(t) : t);
    }
    if (keys.length > shown.length) body.appendChild(el('div', 'plMeta', 'showing ' + shown.length + ' of ' + keys.length.toLocaleString() + ' — use the find box to narrow it'));
    if (picked && row[picked] != null) detail(PSEV.pretty(game, picked), st(picked) || blank(), unit, picked);
    else $('#shDetail').innerHTML = '<div class="empty">Click a hand for its EV at every table size, your write-up, and every time you held it.</div>';
  }

  const SUIT = { c: '♣', d: '♦', h: '♥', s: '♠' };
  function detail(name, s, unit, tkey) {
    const pane = $('#shDetail');
    pane.innerHTML = '';
    pane.scrollTop = 0;
    pane.appendChild(el('h3', null, name));
    const g = data[game];
    if (mode === 'exact' && g.groupOf[name]) pane.appendChild(el('div', 'dim trNote', g.groupOf[name] + ' · ' + g.label));
    else pane.appendChild(el('div', 'dim trNote', g.label));
    const ul = el('div', 'shNotes');
    (s.dealt ? notesFor(name, s, unit) : ['Never dealt to you in ' + g.label + '.'])
      .forEach((x, i) => ul.appendChild(el('p', i === 0 ? 'lead ' + (s.dealt ? verdict(s)[1] : '') : null, x)));
    pane.appendChild(ul);
    if (evReady()) {
      const T = PSEV.table(game);
      if (tkey) {
        // this one hand at every table size the EV table covers
        pane.appendChild(el('h4', 'sec', 'HORSE+ EV table'));
        const w = el('div', 'shChips');
        PSEV.counts(game).forEach(n => {
          const e = PSEV.eq(game, tkey, n);
          if (e == null) return;
          w.appendChild(el('span', 'chip ' + (e >= 1 / n ? 'up' : 'dn'), n + 'p ' + (100 * e).toFixed(1) + '%'));
        });
        pane.appendChild(w);
        pane.appendChild(el('div', 'dim trNote', 'Share of the pot all-in to the end against random hands, by number of players (fair share is 1 ÷ players). ' + T.note + '.'));
      }
      if (s.dealt) {
        const ev = evOf(s);
        if (ev) {
          const won = s.dealt ? s.won / s.dealt : 0;
          pane.appendChild(el('p', 'dim', 'Against the table: at the table sizes you were dealt it, these cards average ' + (100 * ev.eq).toFixed(1) + '% equity against a fair share of ' +
            (100 * ev.fair).toFixed(1) + '% — ' + (ev.eq > ev.fair ? 'a hand worth playing on its cards' : 'below its share on raw cards') + '. You won ' + pct(s.won, s.dealt) +
            ' of the deals (' + pct(s.wonPlayed, s.played) + ' of the ones you played) for ' + sgn(s.bb) + ' ' + unit + '.' +
            (ev.eq > ev.fair && s.bb < 0 && s.dealt >= 8 ? ' Strong on paper but losing in practice — worth a look at how you play it.' : '') +
            (ev.eq < ev.fair && s.bb > 0 && s.dealt >= 8 ? ' Below its share on paper but making you money — you are outplaying the cards.' : '')));
        }
      }
    }
    if (mode === 'group') {
      // the exact hands inside this kind, most-dealt first
      const inside = {};
      s.hands.forEach(x => { const o = inside[x.exact] || (inside[x.exact] = { n: 0, bb: 0 }); o.n++; o.bb += x.bb; });
      const keys = Object.keys(inside).sort((a, b) => inside[b].n - inside[a].n).slice(0, 14);
      pane.appendChild(el('h4', 'sec', 'Hands of this kind'));
      const w = el('div', 'shChips');
      keys.forEach(kx => { const c = el('span', 'chip ' + (inside[kx].bb > 0 ? 'up' : inside[kx].bb < 0 ? 'dn' : ''), kx + ' ×' + inside[kx].n + '  ' + sgn(inside[kx].bb)); w.appendChild(c); });
      pane.appendChild(w);
    }
    pane.appendChild(el('h4', 'sec', 'Every time you held it'));
    const list = el('div', 'plHands');
    s.hands.slice().sort((a, b) => (b.h.dateObj || 0) - (a.h.dateObj || 0)).slice(0, 300).forEach(x => {
      const row = el('div', 'plHand');
      const cards = el('span', 'g');
      x.cards.forEach(c => { const sp = el('span', 'cd su-' + c[1], c[0] + SUIT[c[1]]); cards.appendChild(sp); });
      cards.appendChild(el('span', 'dim', '  ' + (x.sd ? 'showdown' : x.played ? 'played' : x.folded ? 'folded' : 'free look (blind / bring-in)')));
      row.appendChild(cards);
      row.appendChild(el('span', 'd', x.h.dateObj ? x.h.dateObj.toLocaleDateString() : ''));
      row.appendChild(el('span', 'amt ' + (x.bb > 0 ? 'up' : x.bb < 0 ? 'dn' : 'flat'), sgn(x.bb)));
      row.title = 'Open this hand in the replayer';
      row.onclick = () => { PSApp.replaceHands(x.h.raw, name); PSHome.show('replayer'); };
      list.appendChild(row);
    });
    if (s.hands.length > 300) list.appendChild(el('div', 'plMeta', 'showing the latest 300 of ' + s.hands.length));
    pane.appendChild(list);
  }

  function init() {
    $('#shHero').onchange = e => { hero = e.target.value; game = ''; picked = ''; save(); render(); };
    $('#shGame').onchange = e => { game = e.target.value; picked = ''; evN = 0; save(); draw(); };
    $('#shMode').onchange = e => { mode = e.target.value; picked = ''; save(); draw(); };
    $('#shMin').onchange = () => draw();
    $('#shFind').oninput = () => draw();
    $('#shPlayers').onchange = e => { evN = +e.target.value; draw(); };
    $('#shSort').onchange = e => { evSort = e.target.value; save(); draw(); };
  }

  global.PSStart = { init, render, classify, collect, notesFor, verdict, frequencies };
})(typeof window !== 'undefined' ? window : globalThis);
