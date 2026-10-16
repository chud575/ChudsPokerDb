/* ===========================================================================
   draws.js — draw performance: "when I had this draw at this point, how often
   did I make it, and how did those hands go?"

   A filter has three parts:
     at     the checkpoint — in stud, after so many cards (4 = through 4th
            street); in a draw game, after so many draws (0 = as dealt)
     had    conditions on your cards at that point, all of which must hold
            (4 to a 5 low; 4 to a flush; an open-ended straight draw; 3 to a
            badugi …)
     hit    what counts as making it, judged on the last cards you held —
            any one of them, or all of them

   Every hand that matches the checkpoint lands in one of four piles:
     hit      the cards you ended with make it
     missed   you saw every card and did not make it
     folded   you folded before the last card, without having made it
     ended    the hand was over before the last card (they folded, mostly)
   and each pile gets its win rate and result in big bets / big blinds.

   Low rules follow the game: ace low for razz, stud 8, A-5 and badugi; ace
   high and straights / flushes counting against you for 2-7.
   =========================================================================== */
(function (global) {
  'use strict';
  const $ = s => document.querySelector(s);
  const el = (t, c, x) => { const e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; };
  const SUIT = { c: '♣', d: '♦', h: '♥', s: '♠' };
  const RN = '23456789TJQKA';
  const hiV = c => RN.indexOf(c[0]) + 2;                     // 2..14
  const loV = c => c[0] === 'A' ? 1 : hiV(c);                // ace low
  const name = v => v === 1 || v === 14 ? 'A' : RN[v - 2];
  const aN = v => (v === 8 || v === 1 || v === 14 ? 'an ' : 'a ') + name(v);      // "an 8", "a 7"
  const sgn = v0 => { const d = Math.abs(v0) >= 100 ? 0 : 1, v = +v0.toFixed(d) || 0; return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(d); };
  const pc = (a, b) => b ? Math.round(100 * a / b) + '%' : '—';

  const STUD = { razz: 1, stud: 1, stud8: 1 };
  const DRAWG = { badugi: 1, td27: 1, sd27: 1, a5td: 1, a5sd: 1, fcd: 1, badeucy: 1, badacey: 1 };
  const DEUCE = { td27: 1, sd27: 1, badeucy: 1 };             // 2-7: ace high, straights and flushes count
  const aceLow = g => !DEUCE[g];

  /* ---------- the conditions ---------- */
  const distinctLow = (cards, k, low) => new Set(cards.map(low ? loV : hiV).filter(v => v <= k)).size;
  const suitMax = cards => { const m = {}; cards.forEach(c => { m[c[1]] = (m[c[1]] || 0) + 1; }); return Math.max(0, ...Object.values(m)); };
  function runs(cards) {
    const s = new Set(cards.map(hiV));
    if (s.has(14)) s.add(1);
    return s;
  }
  function badugiBest(cards) {
    const key = sub => sub.map(loV).sort((a, b) => b - a);
    const lower = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i]; return false; };
    let best = [];
    for (let m = 1; m < 1 << cards.length; m++) {
      const sub = cards.filter((_, i) => m >> i & 1);
      if (new Set(sub.map(loV)).size !== sub.length || new Set(sub.map(c => c[1])).size !== sub.length) continue;
      if (sub.length > best.length || (sub.length === best.length && lower(key(sub), key(best)))) best = sub;
    }
    return { n: best.length, top: best.length ? Math.max(...best.map(loV)) : 99 };
  }
  // 2-7: five different cards, none above k, and not a straight or a flush
  function made27(cards, k) {
    if (cards.length !== 5) return false;
    const v = cards.map(hiV).sort((a, b) => a - b);
    if (new Set(v).size !== 5 || v[4] > k) return false;
    if (suitMax(cards) === 5) return false;
    if (v[4] - v[0] === 4 || v.join() === '2,3,4,5,14') return false;
    return true;
  }

  /* every condition: label, its parameters, and test(cards, game) */
  const KINDS = {
    lowDraw: {
      label: (p, g) => p.n + ' to ' + aN(p.k) + (p.n >= 5 ? '' : ' low') + (aceLow(g) ? '' : ' (2-7)'),
      params: [['n', 'cards', [2, 3, 4, 5]], ['k', 'or better', [5, 6, 7, 8, 9, 10]]],
      test: (c, g, p) => distinctLow(c, p.k, aceLow(g)) >= p.n,
    },
    madeLow: {
      label: (p, g) => 'made ' + aN(p.k) + (p.k === 5 ? ' (wheel)' : '') + ' or better' + (aceLow(g) ? '' : ' (2-7)'),
      params: [['k', 'or better', [5, 6, 7, 8, 9, 10, 11]]],
      test: (c, g, p) => DEUCE[g] ? made27(c, p.k) : distinctLow(c, p.k, true) >= 5,
    },
    flushDraw: {
      label: p => p.n + ' to a flush',
      params: [['n', 'cards', [3, 4]]],
      test: (c, g, p) => suitMax(c) >= p.n,
    },
    madeFlush: { label: () => 'made a flush', params: [], test: c => suitMax(c) >= 5 },
    straightDraw: {
      label: p => p.oe ? 'open-ended straight draw' : '4 to a straight (open or gutshot)',
      params: [['oe', 'open-ended only', [1, 0]]],
      test: (c, g, p) => {
        const s = runs(c);
        for (let r = 1; r <= 11; r++) {
          const w = [r, r + 1, r + 2, r + 3, r + 4].filter(x => s.has(x)).length;
          if (!p.oe && w >= 4) return true;
          // open-ended: four in a row with a card free at both ends (not A234, not JQKA)
          if (p.oe && r + 3 <= 14 && [r, r + 1, r + 2, r + 3].every(x => s.has(x)) && r >= 2 && r + 3 <= 13) return true;
        }
        return false;
      },
    },
    madeStraight: {
      label: () => 'made a straight', params: [],
      test: c => { const s = runs(c); for (let r = 1; r <= 10; r++) if ([0, 1, 2, 3, 4].every(i => s.has(r + i))) return true; return false; },
    },
    badugiDraw: {
      label: p => p.n + '-card badugi' + (p.k < 13 ? ', ' + name(p.k) + ' or better' : '') + ' (or better)',
      params: [['n', 'cards', [2, 3, 4]], ['k', 'top card at most', [13, 5, 6, 7, 8, 9, 10]]],
      test: (c, g, p) => { const b = badugiBest(c); return b.n > p.n || (b.n === p.n && b.top <= p.k); },
    },
    madeBadugi: {
      label: p => 'made a badugi' + (p.k < 13 ? ', ' + name(p.k) + ' or better' : ''),
      params: [['k', 'top card at most', [13, 6, 7, 8, 9, 10, 11]]],
      test: (c, g, p) => { const b = badugiBest(c); return b.n === 4 && b.top <= p.k; },
    },
    pair: {
      label: p => p.k ? 'a pair of ' + name(p.k) + 's or better' : 'any pair or better',
      params: [['k', 'pair at least', [0, 10, 11, 12, 13, 14]]],
      test: (c, g, p) => { const m = {}; c.forEach(x => { m[hiV(x)] = (m[hiV(x)] || 0) + 1; }); return Object.keys(m).some(v => m[v] >= 2 && +v >= (p.k || 0)); },
    },
  };
  const defaults = kind => Object.fromEntries(KINDS[kind].params.map(([k, , opts]) => [k, opts[0]]));

  /* which conditions make sense in which games */
  function kindsFor(g) {
    if (g === 'badugi') return ['badugiDraw', 'madeBadugi'];
    if (g === 'badeucy' || g === 'badacey') return ['badugiDraw', 'madeBadugi', 'lowDraw', 'madeLow'];
    if (g === 'td27' || g === 'sd27' || g === 'a5td' || g === 'a5sd') return ['lowDraw', 'madeLow'];
    if (g === 'razz') return ['lowDraw', 'madeLow'];
    if (g === 'fcd') return ['flushDraw', 'madeFlush', 'straightDraw', 'madeStraight', 'pair'];
    if (g === 'stud8') return ['lowDraw', 'madeLow', 'flushDraw', 'madeFlush', 'straightDraw', 'madeStraight', 'pair'];
    return ['flushDraw', 'madeFlush', 'straightDraw', 'madeStraight', 'pair', 'lowDraw', 'madeLow'];
  }

  /* ready-made filters — the examples, and the obvious neighbours */
  const C = (kind, p) => ({ kind: kind, p: Object.assign(defaults(kind), p || {}) });
  const PRESETS = {
    razz: [
      { name: 'Wheel draw in my first 4 cards → made a 6 or better', at: 4, had: [C('lowDraw', { n: 4, k: 5 })], hit: [C('madeLow', { k: 6 })], mode: 'any' },
      { name: 'Three to a 6 on 3rd street → made a 7 or better', at: 3, had: [C('lowDraw', { n: 3, k: 6 })], hit: [C('madeLow', { k: 7 })], mode: 'any' },
      { name: '4 to a 7 on 5th street → made a 7 or better', at: 5, had: [C('lowDraw', { n: 4, k: 7 })], hit: [C('madeLow', { k: 7 })], mode: 'any' },
    ],
    stud8: [
      { name: 'Flush + open-ended + low draw in my first 5 → hit at least one', at: 5,
        had: [C('flushDraw', { n: 4 }), C('straightDraw', { oe: 1 }), C('lowDraw', { n: 4, k: 8 })],
        hit: [C('madeFlush'), C('madeStraight'), C('madeLow', { k: 8 })], mode: 'any' },
      { name: '4 to an 8 low on 5th street → made a low', at: 5, had: [C('lowDraw', { n: 4, k: 8 })], hit: [C('madeLow', { k: 8 })], mode: 'any' },
      { name: 'Three low cards on 3rd street → made a low', at: 3, had: [C('lowDraw', { n: 3, k: 8 })], hit: [C('madeLow', { k: 8 })], mode: 'any' },
    ],
    stud: [
      { name: '4 to a flush on 5th street → made a flush', at: 5, had: [C('flushDraw', { n: 4 })], hit: [C('madeFlush')], mode: 'any' },
      { name: 'Open-ended straight draw on 5th street → made a straight', at: 5, had: [C('straightDraw', { oe: 1 })], hit: [C('madeStraight')], mode: 'any' },
      { name: 'Three to a flush on 3rd street → made a flush', at: 3, had: [C('flushDraw', { n: 3 })], hit: [C('madeFlush')], mode: 'any' },
    ],
    badugi: [
      { name: '3-card badugi after the 2nd draw → made a badugi', at: 2, had: [C('badugiDraw', { n: 3 })], hit: [C('madeBadugi')], mode: 'any' },
      { name: '3-card 5 or better as dealt → badugi 8 or better', at: 0, had: [C('badugiDraw', { n: 3, k: 5 })], hit: [C('madeBadugi', { k: 8 })], mode: 'any' },
    ],
    td27: [
      { name: '4 to a 7 after the 1st draw → made a 7', at: 1, had: [C('lowDraw', { n: 4, k: 7 })], hit: [C('madeLow', { k: 7 })], mode: 'any' },
      { name: '4 to an 8 after the 2nd draw → made an 8 or better', at: 2, had: [C('lowDraw', { n: 4, k: 8 })], hit: [C('madeLow', { k: 8 })], mode: 'any' },
    ],
    badeucy: [
      { name: '3 to a badugi and 4 to a 7 by the 2nd draw → made either', at: 2,
        had: [C('badugiDraw', { n: 3 }), C('lowDraw', { n: 4, k: 7 })], hit: [C('madeBadugi'), C('madeLow', { k: 7 })], mode: 'any' },
      { name: '3 to a badugi and 4 to a 7 by the 2nd draw → made both', at: 2,
        had: [C('badugiDraw', { n: 3 }), C('lowDraw', { n: 4, k: 7 })], hit: [C('madeBadugi'), C('madeLow', { k: 7 })], mode: 'all' },
    ],
  };

  /* ---------- your cards at each point of a hand ---------- */
  // stud: cards[k] = your first k cards;  draw games: cards[j] = your hand after j draws
  function track(h, who) {
    const fam = h.game.fam, out = { at: {}, folded: false, final: null, complete: false };
    if (fam === 'stud') {
      let last = null;
      for (const e of h.events) {
        if (e.t === 'deal' && e.player === who && e.all.length >= 3) last = e.all;
        if (e.t === 'act' && e.player === who && e.verb === 'fold') { out.folded = true; break; }
      }
      // the last deal line holds them all, in order: hole, hole, door, 4th…7th
      const all = (h.revealed && h.revealed[who] && h.revealed[who].length >= (last || []).length) ? h.revealed[who] : last;
      if (!all) return null;
      for (let k = 3; k <= all.length; k++) out.at[k] = all.slice(0, k);
      out.final = all;
      out.complete = all.length === 7;
      return out;
    }
    if (fam === 'draw') {
      let cur = null, round = 0;
      for (const e of h.events) {
        if (e.t === 'deal' && e.player === who) { cur = e.all; out.at[round] = cur; }
        else if ((e.t === 'discard' || e.t === 'pat') && e.player === who) { round++; out.at[round] = cur; }
        else if (e.t === 'act' && e.player === who && e.verb === 'fold') { out.folded = true; break; }
      }
      if (!cur) return null;
      // a few histories (disconnections, mostly) print a short or impossible hand
      // after a draw: those points are unknown rather than wrong
      for (const r in out.at) if (out.at[r].length !== h.game.cards) delete out.at[r];
      const shown = h.revealed && h.revealed[who];
      out.final = shown && shown.length === h.game.cards ? shown : cur.length === h.game.cards ? cur : null;
      if (!out.final) return null;
      out.rounds = round;
      out.complete = !out.folded && round >= (h.game.draws || 1);
      return out;
    }
    return null;
  }

  /* hands: parsed hands; who: whose; f: { game, at, had, hit, mode } */
  function run(hands, who, f) {
    const piles = { hit: [], missed: [], folded: [], ended: [] };
    const test = (cond, cards) => KINDS[cond.kind].test(cards, f.game, cond.p);
    let looked = 0;
    for (const h of hands) {
      if (h.game.key !== f.game || h.hero !== who) continue;
      const t = track(h, who);
      if (!t) continue;
      looked++;
      const cp = t.at[f.at];
      if (!cp) continue;                                               // never got that far
      if (!f.had.every(c => test(c, cp))) continue;
      const hits = f.hit.map(c => test(c, t.final));
      const hit = f.hit.length && (f.mode === 'all' ? hits.every(Boolean) : hits.some(Boolean));
      const money = PSEngine.moneyFor(h), unit = h.bb || h.sb || 1;
      const net = (money.got[who] - money.put[who]) / unit;
      const row = { h: h, at: cp, final: t.final, hits: hits, hit: hit, net: net, won: money.got[who] > 0, sd: h.streets.includes('showdown') && !t.folded, complete: t.complete };
      (hit ? piles.hit : t.folded ? piles.folded : t.complete ? piles.missed : piles.ended).push(row);
    }
    return { piles: piles, looked: looked, matched: piles.hit.length + piles.missed.length + piles.folded.length + piles.ended.length };
  }

  /* ---------- the screen ---------- */
  const KEY = 'psreplayer.draws';
  let st = { hero: '', game: '', f: null };
  let hands = [], last = null;

  const atLabel = (g, k) => STUD[g] ? (k === 3 ? '3rd street (first 3 cards)' : k === 7 ? '7th street (all 7)' : k + 'th street (first ' + k + ' cards)')
    : k === 0 ? 'as dealt' : 'after the ' + ['', '1st', '2nd', '3rd'][k] + ' draw';
  const atsFor = (g, draws) => STUD[g] ? [3, 4, 5, 6] : Array.from({ length: (draws || 3) }, (_, i) => i);

  async function render() {
    const body = $('#drBody');
    if (!PSHome.libOk) { body.innerHTML = '<div class="empty warn">The library is unavailable here.</div>'; return; }
    body.innerHTML = '<div class="empty">reading your hands…</div>';
    const lib = await PSHome.library();
    hands = lib.hands;
    try { const s = JSON.parse(localStorage.getItem(KEY)); if (s) st = Object.assign(st, s); } catch (e) { }
    const heroes = {};
    hands.forEach(h => { if (h.hero) heroes[h.hero] = (heroes[h.hero] || 0) + 1; });
    const names = Object.keys(heroes).sort((a, b) => heroes[b] - heroes[a]);
    if (!names.includes(st.hero)) st.hero = names[0] || '';
    const hs = $('#drHero');
    hs.innerHTML = '';
    names.forEach(n => hs.appendChild(new Option(n + ' — ' + heroes[n].toLocaleString() + ' hands', n)));
    hs.value = st.hero;
    // games with draws worth tracking, that this player has hands in
    const games = {};
    hands.forEach(h => { if (h.hero === st.hero && (STUD[h.game.key] || DRAWG[h.game.key])) { games[h.game.key] = games[h.game.key] || { label: h.game.label, n: 0, draws: h.game.draws }; games[h.game.key].n++; } });
    const gs = $('#drGame');
    gs.innerHTML = '';
    Object.keys(games).sort((a, b) => games[b].n - games[a].n).forEach(k => gs.appendChild(new Option(games[k].label + ' — ' + games[k].n.toLocaleString() + ' hands', k)));
    if (!games[st.game]) { st.game = Object.keys(games).sort((a, b) => games[b].n - games[a].n)[0] || ''; st.f = null; }
    gs.value = st.game;
    if (!st.game) { body.innerHTML = '<div class="empty">No stud or draw-game hands for ' + st.hero + ' in the library.</div>'; return; }
    st.draws = games[st.game].draws;
    if (!st.f || st.f.game !== st.game) usePreset(0);
    draw();
  }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) { } };
  function usePreset(i) {
    const p = (PRESETS[st.game] || [])[i];
    st.f = p ? { game: st.game, at: p.at, had: JSON.parse(JSON.stringify(p.had)), hit: JSON.parse(JSON.stringify(p.hit)), mode: p.mode }
      : { game: st.game, at: STUD[st.game] ? 4 : 1, had: [C(kindsFor(st.game)[0])], hit: [C(kindsFor(st.game)[1])], mode: 'any' };
    save();
  }

  function condRow(list, i, onChange) {
    const c = list[i], g = st.game, row = el('div', 'drCond');
    const ks = document.createElement('select');
    kindsFor(g).forEach(k => ks.appendChild(new Option(KINDS[k].label(defaults(k), g).replace(/^\d+ to an? \w+/, x => x), k)));
    // name the choices by kind, not by their current numbers
    [...ks.options].forEach(o => { o.text = { lowDraw: 'Low draw', madeLow: 'Made low', flushDraw: 'Flush draw', madeFlush: 'Made flush', straightDraw: 'Straight draw',
      madeStraight: 'Made straight', badugiDraw: 'Badugi draw', madeBadugi: 'Made badugi', pair: 'Pair' }[o.value]; });
    ks.value = c.kind;
    ks.onchange = () => { list[i] = C(ks.value); onChange(); };
    row.appendChild(ks);
    KINDS[c.kind].params.forEach(([k, lab, opts]) => {
      const s = document.createElement('select');
      opts.forEach(v => s.appendChild(new Option(k === 'oe' ? (v ? 'open-ended' : 'open or gutshot') : k === 'n' ? v + ' cards'
        : k === 'k' && c.kind === 'pair' ? (v ? name(v) + 's or better' : 'any pair') : k === 'k' && v === 13 && /badugi/i.test(c.kind) ? 'any' : name(v) + ' or better', v)));
      s.value = c.p[k];
      s.onchange = () => { c.p[k] = +s.value; onChange(); };
      s.title = lab;
      row.appendChild(s);
    });
    row.appendChild(el('span', 'dim', KINDS[c.kind].label(c.p, g)));
    if (list.length > 1) { const x = el('button', 'btn', '✕'); x.title = 'Remove'; x.onclick = () => { list.splice(i, 1); onChange(); }; row.appendChild(x); }
    return row;
  }

  function draw() {
    const body = $('#drBody'), f = st.f, g = st.game;
    body.innerHTML = '';
    const changed = () => { save(); draw(); };

    // ---- the filter
    const box = el('div', 'drBox');
    const pre = document.createElement('select');
    pre.appendChild(new Option('Ready-made filters…', ''));
    (PRESETS[g] || []).forEach((p, i) => pre.appendChild(new Option(p.name, i)));
    pre.onchange = () => { if (pre.value !== '') { usePreset(+pre.value); draw(); } };
    box.appendChild(pre);
    const at = el('div', 'drLine');
    at.appendChild(el('b', null, 'Look at my cards '));
    const as = document.createElement('select');
    atsFor(g, st.draws).forEach(k => as.appendChild(new Option(atLabel(g, k), k)));
    as.value = f.at;
    as.onchange = () => { f.at = +as.value; changed(); };
    at.appendChild(as);
    box.appendChild(at);
    box.appendChild(el('div', 'drLine', null)).appendChild(el('b', null, 'where I had all of:'));
    f.had.forEach((c, i) => box.appendChild(condRow(f.had, i, changed)));
    const addH = el('button', 'btn', '+ another condition');
    addH.onclick = () => { f.had.push(C(kindsFor(g)[0])); changed(); };
    box.appendChild(addH);
    const hl = el('div', 'drLine');
    hl.appendChild(el('b', null, 'and count it as made if I ended with '));
    const ms = document.createElement('select');
    ms.appendChild(new Option('any of', 'any')); ms.appendChild(new Option('all of', 'all'));
    ms.value = f.mode; ms.onchange = () => { f.mode = ms.value; changed(); };
    hl.appendChild(ms);
    hl.appendChild(el('b', null, ':'));
    box.appendChild(hl);
    f.hit.forEach((c, i) => box.appendChild(condRow(f.hit, i, changed)));
    const addM = el('button', 'btn', '+ another outcome');
    addM.onclick = () => { f.hit.push(C(kindsFor(g).find(k => /^made/.test(k)) || kindsFor(g)[1])); changed(); };
    box.appendChild(addM);
    body.appendChild(box);

    // ---- the results
    const R = run(hands, st.hero, f);
    last = R;
    const P = R.piles, all = P.hit.concat(P.missed, P.folded, P.ended);
    const unit = all.some(r => /NL|PL/.test(r.h.game.betting || '')) ? 'BB' : 'BB';
    const seen = P.hit.length + P.missed.length;
    const k = el('div', 'trKpis');
    const kpi = (label, v, cls, tip) => { const d = el('div', 'kpi ' + (cls || '')); d.appendChild(el('b', null, v)); d.appendChild(el('small', null, label)); if (tip) d.title = tip; k.appendChild(d); };
    const net = all.reduce((a, r) => a + r.net, 0);
    kpi('hands with the draw', R.matched + ' of ' + R.looked.toLocaleString());
    kpi('made it', P.hit.length + (all.length ? ' (' + pc(P.hit.length, all.length) + ')' : ''), '', 'Of every hand that had the draw');
    kpi('made it, when you saw every card', pc(P.hit.length - P.hit.filter(r => !r.complete).length, P.hit.filter(r => r.complete).length + P.missed.length),
      '', 'Only the hands where you got all your cards — the fair hit rate');
    kpi('won the pot', pc(all.filter(r => r.won).length, all.length));
    kpi('net, ' + unit, sgn(net), net > 0 ? 'up' : net < 0 ? 'dn' : '');
    kpi(unit + ' per hand', all.length ? sgn(net / all.length) : '—', net > 0 ? 'up' : net < 0 ? 'dn' : '');
    body.appendChild(k);
    if (!R.matched) { body.appendChild(el('div', 'empty', 'No hands had that at ' + atLabel(g, f.at) + '.')); return; }

    const t = el('table', 'tbl stats');
    const hr = t.insertRow();
    ['', 'Hands', 'Won the pot', 'Win %', 'Went to showdown', 'Net ' + unit, unit + ' / hand'].forEach(x => { const th = document.createElement('th'); th.textContent = x; hr.appendChild(th); });
    [['Made it', P.hit], ['Saw every card, missed', P.missed], ['Folded before the end', P.folded], ['Hand ended early', P.ended], ['All of them', all]].forEach(([nm, l]) => {
      if (!l.length && nm !== 'All of them') return;
      const n = l.reduce((a, r) => a + r.net, 0), w = l.filter(r => r.won).length;
      const tr = t.insertRow();
      [nm, l.length, w, pc(w, l.length), l.filter(r => r.sd).length, sgn(n), l.length ? sgn(n / l.length) : '—'].forEach((v, i) => {
        const c = tr.insertCell(); c.textContent = v; if (i >= 5) c.className = n > 0 ? 'up' : n < 0 ? 'dn' : '';
      });
    });
    body.appendChild(t);
    if (f.hit.length > 1) {
      // how often each outcome came in on its own
      const parts = f.hit.map((c, i) => KINDS[c.kind].label(c.p, g) + ' ' + all.filter(r => r.hits[i]).length);
      body.appendChild(el('div', 'dim trNote', 'Each outcome on its own: ' + parts.join(' · ') + '.'));
    }
    body.appendChild(el('div', 'dim trNote', '“Made it” is judged on the last cards you held. “Saw every card” means all seven in stud, every draw in a draw game. ' +
      '“Hand ended early” is a pot that was over before your last card — usually because everyone else folded. Net is in big bets (limit) or big blinds, at the level each hand was played.'));

    // ---- the hands
    const bar = el('div', 'lkPick');
    const openAll = el('button', 'btn primary', 'Open these ' + all.length + ' hands in the replayer');
    openAll.onclick = () => { PSApp.replaceHands(all.slice().sort((a, b) => (a.h.dateObj || 0) - (b.h.dateObj || 0)).map(r => r.h.raw).join('\n\n'), 'draw filter', true); PSHome.show('replayer'); };
    bar.appendChild(openAll);
    body.appendChild(bar);
    const lt = el('table', 'tbl stats lkHands');
    const h2 = lt.insertRow();
    ['Date', 'At ' + atLabel(g, f.at).replace(/ \(.*\)/, ''), 'Ended with', 'Made it', 'Result', 'Net ' + unit].forEach(x => { const th = document.createElement('th'); th.textContent = x; h2.appendChild(th); });
    const cardsEl = cs => { const w = el('span', 'lkCards'); (cs || []).forEach(c => w.appendChild(el('span', 'cd su-' + c[1], c[0] + SUIT[c[1]]))); return w; };
    all.slice().sort((a, b) => (b.h.dateObj || 0) - (a.h.dateObj || 0)).slice(0, 500).forEach(r => {
      const tr = lt.insertRow();
      tr.insertCell().textContent = r.h.dateObj ? r.h.dateObj.toLocaleDateString() : '';
      tr.insertCell().appendChild(cardsEl(r.at));
      tr.insertCell().appendChild(cardsEl(r.final));
      const mi = tr.insertCell(); mi.textContent = r.hit ? 'yes' : P.missed.includes(r) ? 'missed' : P.folded.includes(r) ? 'folded' : 'ended early'; mi.className = r.hit ? 'up' : '';
      tr.insertCell().textContent = r.won ? (r.sd ? 'won at showdown' : 'won') : r.sd ? 'lost at showdown' : 'lost';
      const nc = tr.insertCell(); nc.textContent = sgn(r.net); nc.className = r.net > 0 ? 'up' : r.net < 0 ? 'dn' : '';
      tr.style.cursor = 'pointer'; tr.title = 'Open this hand in the replayer';
      tr.onclick = () => { PSApp.replaceHands(r.h.raw, 'draw filter'); PSHome.show('replayer'); };
    });
    body.appendChild(global.PSTourneys ? PSTourneys.sortable(lt) : lt);
  }

  function init() {
    $('#drHero').onchange = e => { st.hero = e.target.value; st.f = null; save(); render(); };
    $('#drGame').onchange = e => { st.game = e.target.value; st.f = null; save(); render(); };
  }

  global.PSDraws = { init, render, run, track, KINDS, PRESETS, badugiBest };
})(typeof window !== 'undefined' ? window : globalThis);
