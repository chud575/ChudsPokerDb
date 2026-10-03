/* ===========================================================================
   luck.js — skill vs luck, measured on the hands where the cards are known.

   Only showdowns where every remaining player's cards are in the history can
   be measured.  Each one is put in one of two families:

   ALL-IN BEFORE THE LAST CARD
     The betting was over with cards still to come (you were all-in, or every
     opponent was).  Your equity at that moment is computed from the actual
     hands; equity x pot is what you "should" have won.
         luck = what you actually won − what your equity was worth
     Side pots are honoured: each layer of the pot is contested only by the
     players who paid into it.

   SHOWDOWN, NO ALL-IN BEFORE THE LAST CARD
     Your equity with one card to come (the river; seventh street; the last
     draw) against the hands that reached showdown, then what happened.
         luck = (share you ended with − equity before the card) x pot before it
       ahead, then lost   -> sucked out on
       behind, then won   -> you sucked out
     An all-in ON the last street lands here: no cards were left to come.

   What counts as skill is what is left: how often the money went in good,
   how often you reached the last card ahead, and the result with the luck
   taken back out.

   Draw games: your own cards are known at every draw; an opponent's are only
   known at the end, so the cards they kept before the last draw are taken to
   be the best of what they showed (flagged "approx").  An all-in with two or
   more draws still to come cannot be reconstructed and is left out.

   Equity is exact when one or two cards are to come and a seeded Monte Carlo
   otherwise — the same hand always gives the same number.
   =========================================================================== */
(function (global) {
  'use strict';

  const VER = 5;
  const FLOP_ORDER = ['preflop', 'flop', 'turn', 'river'];
  const STUD_ORDER = ['3rd', '4th', '5th', '6th', '7th'];
  const SIMS = 3000;

  function rngFor(str) {
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = h << 13 | h >>> 19; }
    let a = h >>> 0;
    return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }

  /* average pot shares over every way the missing cards can fall.
     sp: { key, hands:[[ids]], need:[n], board:[ids], boardNeed, deck:[ids], subsets:[[player indexes]], seed }
     -> one array of shares per subset, in that subset's order */
  function equity(sp) {
    const E = global.PSEquity;
    const slots = [];                                   // which player each missing card goes to; -1 = board
    sp.need.forEach((n, p) => { for (let i = 0; i < n; i++) slots.push(p); });
    for (let i = 0; i < sp.boardNeed; i++) slots.push(-1);
    const acc = sp.subsets.map(s => new Float64Array(s.length));
    const alive = sp.subsets.map(s => new Float64Array(s.length));     // how often each player gets anything back
    const out = [];
    let runs = 0;
    const base = sp.hands.map(h => h.slice()), nb = sp.board.length;
    const board = sp.board.slice();
    const play = cards => {
      for (let p = 0; p < base.length; p++) base[p].length = sp.hands[p].length;
      board.length = nb;
      for (let k = 0; k < slots.length; k++) (slots[k] < 0 ? board : base[slots[k]]).push(cards[k]);
      for (let s = 0; s < sp.subsets.length; s++) {
        const sub = sp.subsets[s];
        out.length = sub.length;
        E.sharesInto(sp.key, sub.map(i => base[i]), board, out);
        for (let i = 0; i < sub.length; i++) { acc[s][i] += out[i]; if (out[i] > 0) alive[s][i]++; }
      }
      runs++;
    };
    const d = sp.deck, T = slots.length;
    if (T === 0) play([]);
    else if (T === 1) for (let i = 0; i < d.length; i++) play([d[i]]);
    else if (T === 2) { for (let i = 0; i < d.length; i++) for (let j = 0; j < d.length; j++) if (i !== j) play([d[i], d[j]]); }
    else {
      const rnd = rngFor(sp.seed), w = d.slice(), pick = new Array(T);
      for (let n = 0, N = sp.sims || SIMS; n < N; n++) {
        for (let k = 0; k < T; k++) {                    // partial shuffle
          const j = k + Math.floor(rnd() * (w.length - k));
          const t = w[k]; w[k] = w[j]; w[j] = t;
          pick[k] = w[k];
        }
        play(pick);
      }
    }
    return { shares: acc.map(a => Array.from(a, v => v / runs)), alive: alive.map(a => Array.from(a, v => v / runs)), exact: T <= 2 };
  }

  /* one hand, seen from one player's seat -> a record, { skip: reason }, or
     null when that player did not reach the showdown.  `pov` defaults to the
     hero; any player whose cards were shown can be measured the same way.
     Cards only the hero's history knows (the hero's own, even when folded or
     discarded) are still taken out of the deck. */
  function analyze(h, pov) {
    const E = global.PSEquity;
    const real = h.hero, hero = pov || h.hero, fam = h.game.fam;
    const key = h.game.key === 'o5' ? 'omaha' : h.game.key;
    if (!hero || !h.streets.includes('showdown')) return null;

    // ---- walk the hand: who folded, who was all-in and when, the draw rounds, visible cards, your bets
    const folded = new Set(), allin = {}, heroDeals = [], upcards = {}, rounds = [], acts = [];
    let street = 'setup', inDraw = false;
    h.events.forEach((e, i) => {
      if (e.t === 'street') { street = e.id; inDraw = false; return; }
      if (e.t === 'discard' || e.t === 'pat') {
        if (!inDraw) rounds.push({ ei: i, by: {} });
        inDraw = true;
        rounds[rounds.length - 1].by[e.player] = { count: e.t === 'pat' ? 0 : e.count, cards: e.cards || null };
        return;
      }
      if (e.t === 'deal') {
        if (e.player === real) heroDeals.push({ i: i, groups: e.groups, all: e.all });
        else upcards[e.player] = e.all;
        return;
      }
      if (e.t === 'act') {
        inDraw = false;
        if (e.verb === 'fold') folded.add(e.player);
        if (e.player === hero && (e.verb === 'call' || e.verb === 'bet' || e.verb === 'raise')) acts.push({ i: i, street: street, verb: e.verb });
      }
      if ((e.t === 'act' || e.t === 'post') && e.allin && !allin[e.player]) allin[e.player] = { street: street, i: i };
    });

    const live = h.seats.filter(s => s.inHand && !folded.has(s.name)).map(s => s.name);
    if (!live.includes(hero) || live.length < 2) return null;
    const want = fam === 'stud' ? 7 : h.game.cards;
    const ids = {};
    for (const n of live) {
      const c = h.revealed[n];
      if (!c || c.length !== want) return { skip: 'cards' };
      ids[n] = c.map(E.cid);
      if (ids[n].some(x => x < 0)) return { skip: 'cards' };
    }
    const board = (h.board || []).map(E.cid);
    if (fam === 'flop' && board.length !== 5) return null;          // never reached the river card
    const hi = live.indexOf(hero);
    const everyone = live.map((_, i) => i);

    // ---- how it ended
    const fin = [];
    E.sharesInto(key, live.map(n => ids[n]), board, fin);
    const share = fin[hi];
    const money = global.PSEngine.moneyFor(h);
    const net = money.got[hero] - money.put[hero];
    const unit = h.bb || h.sb || 1;

    // ---- was the betting over with cards still to come?
    const others = live.filter(n => n !== hero);
    let ai = allin[hero] || null;
    if (!ai && others.every(n => allin[n])) ai = others.map(n => allin[n]).sort((a, b) => b.i - a.i)[0];
    const lastRound = rounds[rounds.length - 1] || null;
    if (fam === 'draw' && !lastRound) return null;                    // no draw ever happened
    const toCome = at => {
      if (fam === 'flop') return 5 - [0, 3, 4, 5][Math.max(0, FLOP_ORDER.indexOf(at.street))];
      if (fam === 'stud') return 7 - (3 + Math.max(0, STUD_ORDER.indexOf(at.street)));
      return rounds.filter(r => r.ei > at.i).length;                 // draws still to come
    };
    const left = ai ? toCome(ai) : 0;
    if (left === 0) ai = null;
    if (ai && fam === 'draw' && left > 1) return { skip: 'draw-early' };

    /* the cards as they stood at a stage of the hand.
       flop games: stage = board cards out (0, 3, 4);  stud: cards each (3..6);  draw: 'last' = before the last draw */
    let approx = false;
    const specAt = stage => {
      const sp = { key: key, hands: [], need: [], board: [], boardNeed: 0, deck: [], subsets: [everyone], seed: h.id + '|' + stage };
      const used = new Set();
      if (fam === 'flop') {
        sp.board = board.slice(0, stage); sp.boardNeed = 5 - stage;
        live.forEach(n => { sp.hands.push(ids[n]); sp.need.push(0); });
      } else if (fam === 'stud') {
        live.forEach(n => { sp.hands.push(ids[n].slice(0, stage)); sp.need.push(7 - stage); });
        for (const n in upcards) if (!live.includes(n)) upcards[n].forEach(c => { const x = E.cid(c); if (x >= 0) used.add(x); });
      } else {
        heroDeals.forEach(d => d.all.forEach(c => { const x = E.cid(c); if (x >= 0) used.add(x); }));   // everything you ever held
        for (const n of live) {
          const r = lastRound.by[n] || { count: 0 };
          let kept;
          if (n === real && heroDeals.length) {                          // the one player whose draws are on record
            const after = heroDeals.find(d => d.i > lastRound.ei);
            kept = r.count === 0 ? ids[n] : after && after.groups.length > 1 ? after.groups[0].map(E.cid)
              : ids[n].filter(c => !(r.cards || []).map(E.cid).includes(c)).slice(0, want - r.count);
            if (kept.length !== want - r.count) return null;
          } else {
            const drop = r.count ? E.pickDiscards(h.game.key, ids[n], r.count) : [];
            kept = ids[n].filter((_, i) => !drop.includes(i));
            if (r.count) approx = true;
          }
          sp.hands.push(kept); sp.need.push(r.count);
        }
      }
      sp.hands.forEach(c => c.forEach(x => used.add(x)));
      sp.board.forEach(x => used.add(x));
      // the hero's own cards are known even when the hero is out of the hand
      if (real && !live.includes(real)) heroDeals.forEach(d => d.all.forEach(c => { const x = E.cid(c); if (x >= 0) used.add(x); }));
      for (let c = 0; c < 52; c++) if (!used.has(c)) sp.deck.push(c);
      return sp;
    };

    const stageOf = st => fam === 'flop' ? [0, 3, 4, 5][Math.max(0, FLOP_ORDER.indexOf(st))] : 3 + Math.max(0, STUD_ORDER.indexOf(st));
    const mainStage = fam === 'draw' ? 'last' : ai ? stageOf(ai.street) : fam === 'flop' ? 4 : 6;
    const sp = specAt(mainStage);
    if (!sp) return { skip: 'cards' };
    const label = fam === 'draw' ? 'last draw'
      : !ai ? (fam === 'flop' ? 'river' : '7th street')
      : fam === 'flop' ? (mainStage === 0 ? 'before the flop' : mainStage === 3 ? 'on the flop' : 'on the turn') : 'on ' + STUD_ORDER[mainStage - 3] + ' street';

    const seat = h.seats.find(z => z.name === hero) || {};
    const stack = seat.startStack || 0;
    const rec = {
      id: h.id, pov: hero, tid: h.tourney || '', game: h.game.key, label: h.game.label, date: h.dateObj ? h.dateObj.getTime() : 0,
      unit: unit, opp: others, share: share, net: net / unit, approx: false, where: label,
      cards: h.revealed[hero], oppCards: others.map(n => h.revealed[n]), board: h.board || [],
      stack: stack / unit, risk: stack ? Math.min(1, money.put[hero] / stack) : 0,
    };

    if (ai) {
      // side pots: each layer of the pot belongs to the players who paid into it
      const levels = [...new Set(live.map(n => money.put[n]))].sort((a, b) => a - b);
      const layers = [];
      let prev = 0;
      for (const L of levels) {
        let pot = 0;
        for (const n in money.put) pot += Math.max(0, Math.min(money.put[n], L) - Math.min(money.put[n], prev));
        const who = everyone.filter(i => money.put[live[i]] >= L);
        if (pot > 0) layers.push({ pot: pot, who: who });
        prev = L;
      }
      sp.subsets = layers.map(l => l.who);
      if (!layers.length) return null;
      const r = equity(sp);
      const total = layers.reduce((a, l) => a + l.pot, 0);
      const paidOut = Object.values(money.got).reduce((a, b) => a + b, 0);
      let ev = 0;
      layers.forEach((l, k) => { const at = l.who.indexOf(hi); if (at >= 0) ev += r.shares[k][at] * l.pot; });
      ev *= total ? paidOut / total : 1;                              // rake, if any
      const mainAt = layers[0].who.indexOf(hi);
      rec.kind = 'allin';
      rec.eq = mainAt >= 0 ? r.shares[0][mainAt] : 0;
      rec.exact = r.exact;
      rec.pot = total / unit;
      rec.won = money.got[hero] / unit;
      rec.ev = ev / unit;
      rec.luck = (money.got[hero] - ev) / unit;
      rec.cat = rec.eq >= 0.5 ? 'fav' : 'dog';
      // your tournament on the line: every chip in, and the chance of getting anything back
      rec.life = !!h.tourney && stack > 0 && money.put[hero] >= stack - 0.5;
      rec.surv = mainAt >= 0 ? r.alive[0][mainAt] : 0;
      rec.lived = money.got[hero] > 0;
    } else {
      const pointEi = fam === 'draw' ? lastRound.ei : h.events.findIndex(e => e.t === 'street' && e.id === (fam === 'flop' ? 'river' : '7th'));
      if (pointEi < 0) return null;
      const before = global.PSEngine.moneyFor(h, pointEi);
      const pot = Object.values(before.put).reduce((a, b) => a + b, 0);
      const r = equity(sp);
      rec.kind = 'river';
      rec.eq = r.shares[0][hi];
      rec.exact = r.exact;
      rec.pot = pot / unit;
      rec.luck = (share - rec.eq) * pot / unit;
      const d = share - rec.eq;
      rec.cat = rec.eq > 0.5 ? (d <= -0.3 ? 'beat' : 'held') : rec.eq < 0.5 ? (d >= 0.3 ? 'lucky' : 'missed') : 'held';
    }
    rec.approx = approx;
    rec.sl = stack ? rec.luck * unit / stack : 0;                     // luck, in starting stacks

    /* every time you put money in: your equity against the hands that turned
       out to be there, the size of the bet and the pot it went into.
       g: 0 first round · 1 middle · 2 one card to come · 3 nothing to come */
    const memo = {};
    memo[mainStage] = rec.eq;
    const eqAt = stage => {
      if (memo[stage] !== undefined) return memo[stage];
      const s2 = specAt(stage);
      if (!s2) return (memo[stage] = null);
      s2.sims = 700;
      return (memo[stage] = equity(s2).shares[0][hi]);
    };
    rec.dec = [];
    for (const a of acts) {
      let stage, g;
      if (fam === 'draw') {
        if (a.i > lastRound.ei) { stage = 'end'; g = 3; }
        else if (rounds.filter(r => r.ei > a.i).length === 1) { stage = 'last'; g = 2; }
        else continue;                                               // earlier rounds: their cards then are unknown
      } else {
        stage = stageOf(a.street);
        g = fam === 'flop' ? [0, 1, 2, 3][FLOP_ORDER.indexOf(a.street)] : stage === 3 ? 0 : stage <= 5 ? 1 : stage === 6 ? 2 : 3;
        if (g === undefined) g = 0;
      }
      const nothingLeft = stage === 'end' || stage === 5 || stage === 7;
      const e = nothingLeft ? share : eqAt(stage);
      if (e == null) continue;
      const m0 = global.PSEngine.moneyFor(h, a.i), m1 = global.PSEngine.moneyFor(h, a.i + 1);
      const amt = m1.put[hero] - m0.put[hero];
      if (!(amt > 0)) continue;
      const pot = Object.values(m0.put).reduce((x, y) => x + y, 0);
      // k: the part of a raise that only matched what was already bet
      const k = a.verb === 'raise' ? Math.max(0, Math.min(amt, Math.max(...Object.values(m0.put)) - m0.put[hero])) : 0;
      rec.dec.push({ g: g, v: a.verb[0], a: amt / unit, p: pot / unit, e: e, k: k / unit });
    }
    rec.np = live.length;
    return rec;
  }

  /* ---------- everything for one hero, cached ---------- */
  let cache = null;
  async function loadCache() {
    if (cache) return cache;
    cache = {};
    try { const c = await PSDB.getMeta('luck'); if (c && c.v === VER) cache = c.map || {}; } catch (e) { }
    return cache;
  }

  /* -> { recs, skipped: {reason: n}, hands, netAll, netShown, netFolded } ; onProgress(done, total) */
  async function forHands(hands, hero, onProgress) {
    await loadCache();
    // every hand this player was dealt into — the hero's, or anyone's
    const mine = hands.filter(h => h.hero === hero || h.seats.some(z => z.name === hero && z.inHand));
    const out = { recs: [], skipped: { cards: 0, 'draw-early': 0 }, hands: mine.length, netAll: 0, netShown: 0, netQuiet: 0, showdowns: 0, shownIds: new Set() };
    let dirty = false, t0 = Date.now();
    for (let i = 0; i < mine.length; i++) {
      const h = mine[i];
      const unit = h.bb || h.sb || 1;
      const net = (global.PSEngine.netFor(h)[hero] || 0) / unit;
      out.netAll += net;
      const ck = h.id + '|' + hero;
      let r = cache[ck];
      if (r === undefined) {
        // most hands are not a showdown for this player at all — do not pay for those
        const maybe = h.revealed && h.revealed[hero] && h.streets.includes('showdown');
        try { r = maybe ? analyze(h, hero) : null; } catch (e) { console.warn('luck: hand ' + h.id, e); r = null; }
        if (maybe) { cache[ck] = r || 0; dirty = true; }
      }
      if (r && r.skip) { out.skipped[r.skip] = (out.skipped[r.skip] || 0) + 1; out.showdowns++; out.netShown += net; out.shownIds.add(h.id); }
      else if (r) { out.recs.push(r); out.showdowns++; out.netShown += net; out.shownIds.add(h.id); }
      else out.netQuiet += net;
      if (Date.now() - t0 > 40) { if (onProgress) onProgress(i + 1, mine.length); await new Promise(res => setTimeout(res, 0)); t0 = Date.now(); }
    }
    if (dirty) { try { await PSDB.setMeta('luck', { v: VER, map: cache }); } catch (e) { } }
    out.recs.sort((a, b) => a.date - b.date);
    out.mine = mine;
    return out;
  }

  /* ---------- the numbers ---------- */
  function summarize(recs) {
    const s = {
      n: recs.length, luck: 0, net: 0,
      ai: { n: 0, fav: 0, favWon: 0, dog: 0, dogWon: 0, eq: 0, exp: 0, got: 0, luck: 0 },
      rv: { n: 0, ahead: 0, behind: 0, beat: 0, lucky: 0, held: 0, missed: 0, eq: 0, exp: 0, got: 0, luck: 0, beatLuck: 0, luckyLuck: 0 },
      approx: 0, sd: 0,
      // the two sides of the net: every hand where the result beat its equity, and every one where it fell short
      good: 0, nGood: 0, bad: 0, nBad: 0, bigGood: null, bigBad: null,
    };
    let sq = 0;
    for (const r of recs) {
      s.luck += r.luck; s.net += r.net; sq += r.luck * r.luck;
      if (r.luck >= 0.05) { s.good += r.luck; s.nGood++; if (!s.bigGood || r.luck > s.bigGood.luck) s.bigGood = r; }
      else if (r.luck <= -0.05) { s.bad += r.luck; s.nBad++; if (!s.bigBad || r.luck < s.bigBad.luck) s.bigBad = r; }
      if (r.approx) s.approx++;
      if (r.kind === 'allin') {
        const a = s.ai; a.n++; a.eq += r.eq; a.exp += r.eq; a.got += r.share; a.luck += r.luck;
        if (r.cat === 'fav') { a.fav++; a.favWon += r.share; if (r.share < 0.5) { a.favLost = (a.favLost || 0) + 1; a.favLostLuck = (a.favLostLuck || 0) + r.luck; } }
        else { a.dog++; a.dogWon += r.share; if (r.share > 0.5) { a.dogBeat = (a.dogBeat || 0) + 1; a.dogBeatLuck = (a.dogBeatLuck || 0) + r.luck; } }
      } else {
        const v = s.rv; v.n++; v.eq += r.eq; v.exp += r.eq; v.got += r.share; v.luck += r.luck;
        if (r.eq > 0.5) v.ahead++; else if (r.eq < 0.5) v.behind++;
        v[r.cat]++;
        if (r.cat === 'beat') v.beatLuck += r.luck;
        if (r.cat === 'lucky') v.luckyLuck += r.luck;
      }
    }
    // how far luck alone typically swings a sample this size (one standard deviation)
    s.sd = s.n ? Math.sqrt(Math.max(0, sq - s.luck * s.luck / s.n)) : 0;
    return s;
  }

  /* ---------- deal luck: were you dealt your share of the hands that pay? ----------
     For each game: how often each kind of starting hand should come (random
     deals) against how often it did, weighted by what that kind is worth to
     you per deal compared with your average deal.  A kind's worth is pulled
     toward your average when you have held it only a few times, so one big
     pot cannot masquerade as a pattern. */
  const SHRINK = 10;
  function dealLuck(hands, hero) {
    const S = global.PSStart;
    if (!S) return {};
    const D = S.collect(hands, hero), out = {};
    for (const g in D) {
      const freq = S.frequencies(g);
      if (!freq) continue;
      const N = D[g].all.dealt, avg = D[g].all.bb / N;
      const rows = [];
      let total = 0;
      const kinds = new Set(Object.keys(freq).concat(Object.keys(D[g].group)));
      kinds.forEach(k => {
        const st = D[g].group[k], n = st ? st.dealt : 0, exp = N * (freq[k] || 0);
        const worth = st ? (st.bb + SHRINK * avg) / (n + SHRINK) - avg : 0;      // BB per deal, above your average deal
        const luck = (n - exp) * worth;
        total += luck;
        rows.push({ kind: k, exp: exp, got: n, worth: worth, luck: luck });
      });
      out[g] = { label: D[g].label, deals: N, luck: total, rows: rows.sort((a, b) => Math.abs(b.luck) - Math.abs(a.luck)) };
    }
    return out;
  }

  /* ---------- coolers: a strong hand that ran into a stronger one ----------
     How strong a finished hand is: the share of the pot it takes, heads-up,
     against the field — in stud and draw games the hands people actually
     showed down in this game; in flop games random hole cards on the same
     board (so the bar is higher there).  A cooler is a hand in the top slice
     that lost without being outdrawn at the end: you were already behind. */
  const COOL_POOL = 0.8, COOL_BOARD = 0.92;
  function strengths(recs) {
    const E = global.PSEquity, out = {}, pools = {};
    const board = r => r.board.length === 5;
    for (const r of recs) {
      if (board(r)) continue;
      const p = pools[r.game] || (pools[r.game] = []);
      p.push(r.cards.map(E.cid));
      r.oppCards.forEach(c => p.push(c.map(E.cid)));
    }
    const two = [0, 0];
    for (const r of recs) {
      const key = r.game === 'o5' ? 'omaha' : r.game;
      const rate = cards => {
        const me = cards.map(E.cid);
        let sum = 0, n = 0;
        if (board(r)) {
          const bd = r.board.map(E.cid), used = new Set(me.concat(bd)), deck = [];
          for (let c = 0; c < 52; c++) if (!used.has(c)) deck.push(c);
          const rnd = rngFor(r.id + cards.join(''));
          for (let k = 0; k < 250; k++) {
            for (let j = 0; j < me.length; j++) { const x = j + Math.floor(rnd() * (deck.length - j)); const t = deck[j]; deck[j] = deck[x]; deck[x] = t; }
            E.sharesInto(key, [me, deck.slice(0, me.length)], bd, two);
            sum += two[0]; n++;
          }
        } else {
          const pool = pools[r.game], step = Math.max(1, Math.floor(pool.length / 300));
          for (let k = 0; k < pool.length; k += step) {
            if (pool[k].join() === me.join()) continue;
            E.sharesInto(key, [me, pool[k]], [], two);
            sum += two[0]; n++;
          }
        }
        return n ? sum / n : 0;
      };
      const mine = rate(r.cards), theirs = Math.max(...r.oppCards.map(rate));
      const bar = board(r) ? COOL_BOARD : COOL_POOL;
      const notOutdrawn = r.kind === 'allin' ? r.cat === 'dog' : r.cat === 'missed';
      const notLucky = r.kind === 'allin' ? r.cat === 'fav' : r.cat === 'held';
      let cool = '';
      if (r.share <= 0.25 && r.net < 0 && mine >= bar && notOutdrawn) cool = 'against';
      else if (r.share >= 0.75 && r.net > 0 && theirs >= bar && notLucky) cool = 'for';
      out[r.id] = { mine: mine, theirs: theirs, cool: cool };
    }
    return out;
  }

  /* ---------- tournament life: all-ins with every chip in ---------- */
  function lifeSummary(recs) {
    const L = { n: 0, exp: 0, lived: 0, fav: 0, stacks: 0, stackLuckAll: 0, recs: [] };
    for (const r of recs) {
      if (r.tid) L.stackLuckAll += r.sl || 0;
      if (r.kind !== 'allin' || !r.life) continue;
      L.n++; L.exp += r.surv; if (r.lived) L.lived++; if (r.eq >= 0.5) L.fav++;
      L.recs.push(r);
    }
    return L;
  }

  /* ---------- decisions: every time you put money in, against what they held ---------- */
  const STAGES = ['First round', 'Middle rounds', 'One card to come', 'Nothing to come'];
  /* What a decision cost, in hindsight, against the hands they held:
       a call without the price     — what folding would have saved:  bet − equity × (pot + bet)
       a bet or raise made behind   — what not betting would have saved, the bet being matched by
                                      everyone who stayed:  bet × (1 − players × equity)
     and, the other way, a bet made ahead gains  bet × (players × equity − 1).
     The matching part of a raise is judged as a call, the rest as a bet.  Costs
     are counted against stopping at that point, so they add up without
     counting any pot twice. */
  function costOf(d, np) {
    const fair = 1 / np;
    let call = 0, bet = 0, gain = 0;
    const c = d.v === 'c' ? d.a : d.k || 0, b = d.a - c;
    if (c > 0) { const v = d.e * (d.p + c) - c; if (v < 0) call = -v; }
    if (b > 0) { const v = b * (np * d.e - 1); if (v < 0) bet = -v; else gain = v; }
    return { call: call, bet: bet, gain: gain, cost: call + bet };
  }

  function decisionSummary(recs) {
    const blank = name => ({ name: name, n: 0, bb: 0, eqBB: 0, goodBB: 0, calls: 0, callsOk: 0, callEq: 0, callNeed: 0, bets: 0, betsAhead: 0, betEq: 0 });
    const rows = STAGES.map(blank), all = blank('All of it');
    const slot = () => ({ n: 0, bb: 0 });
    // cards to come = a real misjudgement of odds; nothing to come = a bluff-catch or a value bet that ran into better
    const mis = { callDraw: slot(), betDraw: slot(), callEnd: slot(), betEnd: slot(), gain: slot(), total: 0, hands: 0 };
    const worst = [];
    for (const r of recs) {
      const np = r.np || 2, fair = 1 / np;
      let handCost = 0;
      for (const d of (r.dec || [])) {
        const need = d.a / (d.p + d.a);                              // the price: equity a call needs to break even
        for (const t of [rows[d.g], all]) {
          t.n++; t.bb += d.a; t.eqBB += d.a * d.e;
          if (d.e >= fair) t.goodBB += d.a;
          if (d.v === 'c') { t.calls++; t.callEq += d.e; t.callNeed += need; if (d.e >= need) t.callsOk++; }
          else { t.bets++; t.betEq += d.e; if (d.e >= fair) t.betsAhead++; }
        }
        const c = costOf(d, np), end = d.g === 3;
        if (c.call > 0) { const m = end ? mis.callEnd : mis.callDraw; m.n++; m.bb += c.call; }
        if (c.bet > 0) { const m = end ? mis.betEnd : mis.betDraw; m.n++; m.bb += c.bet; }
        if (c.gain > 0) { mis.gain.n++; mis.gain.bb += c.gain; }
        mis.total += c.cost; handCost += c.cost;
        if (c.cost > 0 && !end) worst.push({ r: r, d: d, cost: c.cost, need: d.v === 'c' ? need : fair });
      }
      if (handCost > 0) mis.hands++;
    }
    worst.sort((a, b) => b.cost - a.cost);
    return { rows: rows, all: all, mis: mis, worst: worst.slice(0, 15) };
  }

  const clearCache = async () => { cache = {}; try { await PSDB.setMeta('luck', { v: VER, map: {} }); } catch (e) { } };

  global.PSLuck = { analyze, forHands, summarize, equity, clearCache, dealLuck, strengths, lifeSummary, decisionSummary, costOf, STAGES, VER };
})(typeof window !== 'undefined' ? window : globalThis);
