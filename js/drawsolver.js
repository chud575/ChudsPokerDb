/* ===========================================================================
   drawsolver.js — solver advice for 2-7 Triple Draw, A-5 Triple Draw and
   Badugi, from the Triple Draw trainer's brains (TD27Web).

   TD27Web's Hand Builder is stateless: it takes the hand so far — your
   cards, everyone's bets and draws in order — replays it on the trainer's
   own engine and answers for the spot you are in.  Its brains are trained
   2-6 handed, so a multiway pot is read as the multiway pot it is (no
   one-villain-at-a-time approximation is needed: nobody's cards are seen).

   Seats: the engine's seat 0 is the button, then the small blind, the big
   blind and on round (heads-up: the button posts the small blind).  Bet
   actions are 0 fold · 1 check/call · 2 bet/raise; a villain's draw is just
   how many cards they took; your draw names the cards you threw (by their
   place in your hand) and the ones you got.  Anything the engine cannot
   follow — all-ins, dead blinds, 7+ players — comes back as a skipped spot.
   =========================================================================== */
(function (global) {
  'use strict';

  const LOCAL = typeof location === 'undefined' || location.protocol === 'file:' || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  const DEF = LOCAL ? 'http://localhost:8728' : location.origin + '/TripleDraw';
  const KEY = 'psreplayer.drawSolver.url';
  const url = () => { try { return localStorage.getItem(KEY) || DEF; } catch (e) { return DEF; } };
  const setUrl = u => { try { localStorage.setItem(KEY, u.replace(/\/+$/, '')); } catch (e) { } };

  const RANK = { A: 1, T: 10, J: 11, Q: 12, K: 13 };
  const SUIT = { s: 0, h: 1, d: 2, c: 3 };
  function cardId(c) {
    const r = RANK[c[0].toUpperCase()] || +c[0], s = SUIT[c[1]];
    return r >= 1 && r <= 13 && s != null ? s * 13 + (r - 1) : null;
  }

  async function ping() {
    const t0 = Date.now();
    try {
      const r = await fetch(url() + '/api/meta');
      if (!r.ok) return { ok: false, why: 'HTTP ' + r.status };
      await r.json();
      return { ok: true, ms: Date.now() - t0, sample: 'draw brains', model: 'TD27 Trainer' };
    } catch (e) { return { ok: false, why: e.message }; }
  }

  /* the players in the engine's seat order, or a reason it cannot be done */
  function seating(hand) {
    let sb = null, bb = null;
    const dealt = new Set();
    for (const e of hand.events) {
      if (e.t === 'post') {
        if (e.kind === 'sb') sb = e.player;
        else if (e.kind === 'bb') bb = e.player;
        else if (e.kind !== 'ante') return { why: 'a dead or extra blind was posted' };
        dealt.add(e.player);
      }
      if (e.t === 'deal' || e.t === 'act' || e.t === 'discard' || e.t === 'pat') dealt.add(e.player);
    }
    if (!sb || !bb) return { why: 'no small and big blind posted' };
    const ring = hand.seats.filter(p => dealt.has(p.name)).sort((a, b) => a.seat - b.seat).map(p => p.name);
    if (ring.length < 2 || ring.length > 6) return { why: ring.length + ' players — the draw brains cover 2 to 6' };
    const si = ring.indexOf(sb);
    if (si < 0 || ring[(si + 1) % ring.length] !== bb) return { why: 'blinds out of order' };
    const btn = ring.length === 2 ? si : (si - 1 + ring.length) % ring.length;
    return { order: ring.slice(btn).concat(ring.slice(0, btn)) };
  }

  const BET = { fold: 0, check: 1, call: 1, bet: 2, raise: 2 };

  /* every decision you made: the builder payload for the spot just before it */
  function spots(hand, steps, hero, g) {
    const out = [];
    const seat = seating(hand);
    const byEi = new Map();
    steps.forEach(s => { if (s.ei != null) byEi.set(s.ei, s); });
    const ev = hand.events;
    let mine = null, dealt = null;           // your hand now (in the engine's order), and as dealt
    const events = [];
    let broken = seat.why || null, myDraws = 0;
    for (let i = 0; i < ev.length; i++) {
      const e = ev[i];
      if (e.t === 'deal' && e.player === hero && !mine) { mine = e.all.map(cardId); dealt = mine.slice(); continue; }
      const isAct = e.t === 'act' && BET[e.verb] != null;
      const isDraw = e.t === 'discard' || e.t === 'pat';
      if (!isAct && !isDraw) continue;
      if (e.player === hero) {
        const s = byEi.get(i);
        const pre = s ? (steps[s.i - 1] || steps[0]) : null;
        const n = isDraw ? (e.t === 'pat' ? 0 : e.count) : null;
        const spot = {
          step: s ? s.i : null, ei: i, street: pre ? pre.street : '',
          streetLabel: isDraw ? ['1st', '2nd', '3rd'][myDraws] + ' draw' : pre ? pre.streetLabel : '',
          game: g, hero: hero, heroCards: (mine || []).map(cardLabel), oppBoards: [], opponents: 0,
          toCall: 0, pot: 0, board: [], kind: isDraw ? 'draw' : 'bet',
          actual: isDraw ? (n ? 'draw ' + n : 'pat') : e.verb,
          actualLabel: isDraw ? (n ? 'draw ' + n + (e.cards ? ' (' + e.cards.join(' ') + ')' : '') : 'stand pat')
                              : e.verb + (e.to ? ' to ' + e.to : e.amount ? ' ' + e.amount : ''),
          drawn: n,
          payload: broken || !mine || mine.some(x => x == null) || !seat.order ? null : {
            game: g.id, players: seat.order.length, heroSeat: seat.order.indexOf(hero),
            hero: dealt, events: events.slice(),
          },
        };
        if (pre) spot.opponents = pre.players.filter(p => p.inHand && !p.folded && p.name !== hero).length;
        if (!spot.payload) spot.skip = broken || 'your cards are not in the history';
        if (s) out.push(spot);
      }
      if (isDraw && e.player === hero) myDraws++;
      if (e.allin && !broken) broken = 'someone is all-in — the engine has no stacks';
      // then the action itself joins the history the next spot is built from
      if (isAct) events.push({ t: 'bet', a: BET[e.verb] });
      else if (e.player !== hero) events.push({ t: 'vdraw', k: e.t === 'pat' ? 0 : e.count });
      else if (mine) {
        if (e.t === 'pat' || !e.count) { events.push({ t: 'hdraw', discards: [] }); continue; }
        const tossed = (e.cards || []).map(cardId);
        const idx = tossed.map(c => mine.indexOf(c));
        // the cards you got: your next deal line, minus the ones you kept
        const nx = ev.slice(i + 1).find(x => x.t === 'deal' && x.player === hero);
        const kept = mine.filter(c => !tossed.includes(c));
        const got = nx ? nx.all.map(cardId).filter(c => !kept.includes(c)) : [];
        if (idx.some(x => x < 0) || got.length !== tossed.length) { broken = broken || 'your draw is not fully in the history'; continue; }
        events.push({ t: 'hdraw', discards: idx, cards: got });
        mine = kept.concat(got);
      }
    }
    return out;
  }

  function cardLabel(id) {
    if (id == null) return '?';
    const r = id % 13 + 1, s = Math.floor(id / 13);
    return ({ 1: 'A', 10: 'T', 11: 'J', 12: 'Q', 13: 'K' }[r] || String(r)) + 'shdc'[s];
  }

  const pc = x => Math.round(x * 100) + '%';

  async function advise(s) {
    if (!s.payload) return { skipped: s.skip || 'not readable' };
    let j;
    try {
      const r = await fetch(url() + '/api/builder', {
        method: 'POST', headers: { 'Content-Type': 'text/plain' },   // a simple request: no CORS preflight
        body: JSON.stringify(s.payload),
      });
      j = await r.json();
      if (!r.ok || !j.ok) return { skipped: 'the draw engine could not follow this hand' + (j && j.error ? ' (' + j.error + ')' : '') };
    } catch (e) { return { error: e.message }; }
    const a = j.advice, v = j.view || {};
    if (!a) return { skipped: 'no advice for this spot' };
    if (!j.hasBrain) return { skipped: 'no brain for ' + s.game.label + ' at ' + s.payload.players + ' players' };
    const model = s.game.label + ' brain, ' + s.payload.players + '-handed';
    const eq = ' · equity ' + pc(a.equity) + (a.found ? '' : ' · spot not in the solver table');
    if (s.kind === 'draw') {
      const k = a.suggestedDraw;
      const toss = (j.toss || []).map(cardLabel);
      return {
        action: k ? 'draw ' + k : 'stand pat', drawCount: k, toss: toss, model: model, found: a.found,
        strategy: (k && toss.length ? 'throw ' + toss.join(' ') : k ? '' : 'keep all ' + s.heroCards.length) + eq,
        reasoning: '',
      };
    }
    const facing = v.owed > 0, opened = v.bets > 0;
    const lbl = { fold: 'fold', call: facing ? 'call' : 'check', raise: opened ? 'raise' : 'bet' };
    const mix = [['fold', a.fold], ['call', a.call], ['raise', a.raise]].filter(x => x[1] > 0.005).sort((x, y) => y[1] - x[1]);
    return {
      action: lbl[mix[0][0]], model: model, found: a.found,
      strategy: mix.map(x => lbl[x[0]].toUpperCase() + ' ' + pc(x[1])).join(' · ') + eq +
        (a.suggestedDraw != null && v.drawsRemaining > 0 ? ' · plans to draw ' + (a.suggestedDraw || 'none') : ''),
      reasoning: '',
      classProbs: { fold: a.fold, passive: a.call, aggressive: a.raise },
    };
  }

  global.PSDrawSolver = { url, setUrl, ping, spots, advise, DEF, cardId };
})(window);
