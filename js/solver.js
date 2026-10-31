/* ===========================================================================
   solver.js — ask the HORSE+ Solver what it would have done.

   For every point in a hand where the hero acted, this rebuilds the state as
   it stood *before* that action, posts it to the solver's advisor API, and
   lines the solver's answer up against what actually happened.

   Two things the solver cares about that are easy to get wrong:
     · pot and to_call are in SMALL BETS, not chips (pot * small_bet in the
       adapter), and for a limit level "(100/200)" the small bet is 100.
     · hero_cards must be in dealt order — slots 0 and 1 are the hole cards,
       the rest are the upcards — because the adapter exposes them that way.

   Stud games with more than one villain: the solvers are heads-up, so the
   spot is read against each villain on their own (advisor_multi).  For
   villain A, every other upcard on the table — the other villains' and any
   folded ones — is dead, out of the deck; the solver then answers as if you
   were heads-up with A.  One answer per villain.
   =========================================================================== */
(function (global) {
  'use strict';

  // opened off disk or on this machine: the solver on this machine.  Served from a
  // host of its own: that host, where HORSE+ answers at the same address.
  const LOCAL = typeof location === 'undefined' || location.protocol === 'file:' || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  const DEF = LOCAL ? 'http://localhost:5055' : location.origin;
  const KEY = 'psreplayer.solver.url';

  /* games the solver answers for, and how its payload is shaped */
  const GAMES = {
    razz:   { id: 'razz',    fam: 'stud', label: 'Razz' },
    stud:   { id: 'stud_hi', fam: 'stud', label: 'Stud Hi' },
    stud8:  { id: 'stud8',   fam: 'stud', label: 'Stud Hi/Lo' },
    holdem: { id: 'holdem',  fam: 'flop', label: "Hold'em", holes: 2 },
    omaha8: { id: 'omaha8',  fam: 'flop', label: 'Omaha Hi/Lo', holes: 4 },
    // draw games: the Triple Draw trainer's brains (TD27Web), 2-6 players natively
    td27:   { id: 0, fam: 'draw', label: '2-7 Triple Draw' },
    a5td:   { id: 1, fam: 'draw', label: 'A-5 Triple Draw' },
    badugi: { id: 2, fam: 'draw', label: 'Badugi' },
  };
  const STREET_IX = { preflop: 0, flop: 1, turn: 2, river: 3 };

  const url = () => { try { return localStorage.getItem(KEY) || DEF; } catch (e) { return DEF; } };
  const setUrl = u => { try { localStorage.setItem(KEY, u.replace(/\/+$/, '')); } catch (e) { } };

  async function ping(fam) {
    if (fam === 'draw') return PSDrawSolver.ping();
    const t0 = Date.now();
    try {
      const r = await fetch(url() + '/api/game/razz/advisor', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hero_cards: ['Ac', '2d', '3h'], street: 3, to_call: 1, pot: 2.5,
          num_opponents: 1, opponent_boards: [['9s']],
        }),
      });
      if (!r.ok) return { ok: false, why: 'HTTP ' + r.status };
      const j = await r.json();
      return { ok: !!j.recommended_action, ms: Date.now() - t0, sample: j.recommended_action, model: j.model_used || '' };
    } catch (e) {
      return { ok: false, why: e.message };
    }
  }

  const support = key => GAMES[key] || null;

  /* what to say instead of advice on a no-limit or pot-limit hand; '' for a limit hand */
  const limitOnly = betting => betting === 'NL' ? 'No Limit: the solvers are limit only'
    : betting === 'PL' ? 'Pot Limit: the solvers are limit only' : '';

  /* ---------- limit hold'em: the whole betting line, for the N-max limit solver ----------
     The classic advisor only sees cards, pot and board.  The limit solver also wants to know
     who sat where and what everyone did before this decision, so for limit hold'em we send
     the players in preflop acting order (first to act … small blind, big blind) and every
     action up to the decision.  Returns null when the hand cannot be described that way
     (no blinds posted, a dead small blind, the hero not dealt in). */
  function lineFor(hand, uptoEvent, hero) {
    if (!hand.game || hand.game.betting !== 'FL') return null;
    let sbName = null, bbName = null;
    const dealt = new Set();
    for (const e of hand.events) {
      if (e.t === 'post' && e.kind === 'sb') sbName = e.player;
      if (e.t === 'post' && (e.kind === 'bb' || e.kind === 'sb+bb')) { if (bbName && e.kind === 'sb+bb') return null; bbName = bbName || e.player; }
      if (e.t === 'post' && e.kind === 'post') return null;            // extra dead money in the pot
      if (e.t === 'act' || e.t === 'post') dealt.add(e.player);
    }
    if (!sbName || !bbName) return null;
    const ring = hand.seats.filter(p => dealt.has(p.name)).sort((a, b) => a.seat - b.seat).map(p => p.name);
    const bi = ring.indexOf(bbName);
    if (bi < 0 || ring.length < 2) return null;
    const order = ring.slice(bi + 1).concat(ring.slice(0, bi + 1));     // … small blind, big blind
    if (order[order.length - 2] !== sbName) return null;               // dead button / missing blind
    const hi = order.indexOf(hero);
    if (hi < 0) return null;
    const actions = [];
    let st = 0;
    for (let i = 0; i < uptoEvent; i++) {
      const e = hand.events[i];
      if (e.t === 'street' && STREET_IX[e.id] != null) st = STREET_IX[e.id];
      if (e.t !== 'act') continue;
      const seat = order.indexOf(e.player);
      if (seat < 0) return null;
      actions.push([st, seat, e.verb]);
    }
    return { seats: order.length, hero: hi, actions: actions };
  }

  /* ---------- pull every hero decision out of a replayed hand ---------- */
  function spots(hand, steps, heroName) {
    const g = support(hand.game.key);
    const out = [];
    if (!g) return out;
    if (g.fam === 'draw') return PSDrawSolver.spots(hand, steps, heroName || hand.hero, g);
    const hero = heroName || hand.hero;
    if (!hero) return out;
    const sb = +hand.sb || 0;
    if (!sb) return out;

    const byEi = new Map();
    steps.forEach(s => { if (s.ei != null) byEi.set(s.ei, s); });

    hand.events.forEach((e, i) => {
      if (e.t !== 'act' || e.player !== hero) return;
      if (e.verb === 'bringin' && e.allin) return;      // a short stack's bring-in is forced; otherwise it is a choice against completing
      const s = byEi.get(i);
      if (!s) return;
      const pre = steps[s.i - 1] || steps[0];           // the table before the action
      const h = pre.players.find(p => p.name === hero);
      if (!h) return;

      const cards = h.cards.filter(c => c.c).map(c => c.c);
      const live = pre.players.filter(p => p.inHand && !p.folded && p.name !== hero);
      const ups = p => p.cards.filter(c => c.c && c.up).map(c => c.c);
      // folded players' upcards are out of the deck for everyone still in
      const dead = [].concat(...pre.players.filter(p => p.inHand && p.folded && p.name !== hero).map(ups));
      const maxBet = pre.players.reduce((m, p) => Math.max(m, p.bet), 0);
      const potChips = pre.pot + pre.players.reduce((t, p) => t + p.bet, 0);
      const belowBet = g.fam === 'stud' && pre.street === '3rd' && maxBet > 0 && maxBet < sb;   // only the bring-in so far

      const spot = {
        step: s.i, ei: i, street: pre.street, streetLabel: pre.streetLabel,
        game: g, hero: hero,
        heroCards: cards,
        oppBoards: live.map(ups),
        oppNames: live.map(p => p.name),
        dead: dead,
        opponents: live.length,
        toCall: Math.max(0, maxBet - h.bet) / sb,
        pot: potChips / sb,
        board: (pre.board || []).slice(),
        actual: e.verb,
        actualLabel: (e.verb === 'bringin' ? 'bring-in' : belowBet && norm(e.verb) === 'aggressive' ? 'complete' : e.verb) +
          (e.to ? ' to ' + e.to : e.amount ? ' ' + e.amount : ''),
        betting: hand.game.betting || '',
        belowBet: belowBet,
      };
      if (g.id === 'holdem') spot.line = lineFor(hand, i, hero);
      if (!valid(spot)) { spot.skip = reasonInvalid(spot); }
      out.push(spot);
    });
    return out;
  }

  function valid(s) {
    if (s.game.fam === 'stud') {
      if (s.heroCards.length < 3 || s.heroCards.length > 7) return false;
      // every villain still in, with their upcards (read one at a time when there are several)
      if (s.opponents < 1) return false;
      const want = Math.min(s.heroCards.length, 6) - 2;
      return s.oppBoards.every(b => b.length === want);
    }
    if (s.game.fam === 'flop') return s.heroCards.length === s.game.holes && STREET_IX[s.street] != null;
    return false;
  }
  function reasonInvalid(s) {
    if (s.game.fam === 'stud' && s.opponents < 1) return 'nobody left to play';
    if (s.game.fam === 'stud' && s.heroCards.length < 3) return 'cards not dealt yet';
    if (s.game.fam === 'stud') return "villain's upcards incomplete";
    return 'not a spot the solver takes';
  }

  function payload(s) {
    if (s.game.fam === 'stud') {
      return {
        hero_cards: s.heroCards, street: s.heroCards.length,
        to_call: +s.toCall.toFixed(3), pot: +s.pot.toFixed(3),
        num_opponents: s.opponents, opponent_boards: s.oppBoards,
      };
    }
    const p = {
      hero_cards: s.heroCards, street: STREET_IX[s.street],
      to_call: +s.toCall.toFixed(3), pot: +s.pot.toFixed(3),
      num_opponents: s.opponents, board: s.board,
    };
    if (s.line) p.line = s.line;          // limit hold'em: lets the server use the N-max limit solver
    return p;
  }

  /* going up over a bring-in is a complete, not a raise */
  const named = (s, action) => s.belowBet && norm(action) === 'aggressive' ? 'complete' : action;
  const namedMix = (s, mix) => s.belowBet ? mix.replace(/RAISE/g, 'COMPLETE') : mix;

  /* "BET:60% | CHECK:40%" -> {fold, passive, aggressive}, for solvers that only send the text */
  function classesOf(strategy) {
    const out = { fold: 0, passive: 0, aggressive: 0 };
    let found = false;
    for (const m of String(strategy || '').matchAll(/([A-Za-z-]+)[:\s]+(\d+(?:\.\d+)?)%/g)) {
      const k = norm(m[1]);
      out[k === 'aggressive' ? 'aggressive' : k === 'fold' ? 'fold' : 'passive'] += +m[2] / 100;
      found = true;
    }
    return found ? out : null;
  }

  /* stud, any number of villains: one heads-up answer per villain, the others' cards dead */
  let multiOk = true;     // false once the server turns out to predate advisor_multi
  async function adviseMulti(s) {
    const r = await fetch(url() + '/api/game/' + s.game.id + '/advisor_multi', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hero_cards: s.heroCards, street: s.heroCards.length,
        to_call: +s.toCall.toFixed(3), pot: +s.pot.toFixed(3),
        opponent_boards: s.oppBoards, opponent_names: s.oppNames, dead_cards: s.dead,
      }),
    });
    if (r.status === 404) { multiOk = false; return null; }
    if (!r.ok) return { error: 'HTTP ' + r.status };
    const j = await r.json();
    if (j.error) return { error: j.error };
    const per = (j.per_villain || []).map(v => ({
      villain: v.villain, board: v.board || [], dead: v.dead || [],
      action: v.action ? named(s, String(v.action).toLowerCase()) : null, error: v.error || null,
      strategy: namedMix(s, v.strategy || ''), probs: v.probs || null, trained: !!v.trained, model: v.model || '',
      equity: v.equity, equityNoDead: v.equity_no_dead, deadUsed: !!v.dead_used,
    }));
    const ok = per.filter(v => v.action);
    if (!ok.length) return { error: (per[0] && per[0].error) || 'no recommendation returned' };
    const one = per.length === 1;
    return {
      action: one ? ok[0].action : per.map(v => (v.action || '?') + ' vs ' + v.villain).join(' · '),
      model: ok[0].model, strategy: one ? ok[0].strategy : '',
      reasoning: one ? ok[0].model + (ok[0].trained ? ' solved policy' : ' pot-odds fallback (spot not in solver table)') + ' (' + ok[0].strategy + ')' : '',
      perVillain: per,
    };
  }

  async function advise(s) {
    if (s.skip) return { skipped: s.skip };
    if (s.game.fam === 'draw') return PSDrawSolver.advise(s);
    if (s.game.fam === 'stud' && multiOk) {
      try { const m = await adviseMulti(s); if (m) return m; } catch (e) { return { error: e.message }; }
    }
    if (s.game.fam === 'stud' && s.opponents !== 1)
      return { skipped: s.opponents + '-way — this solver server is older and reads heads-up only' };
    try {
      const r = await fetch(url() + '/api/game/' + s.game.id + '/advisor', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload(s)),
      });
      if (!r.ok) return { error: 'HTTP ' + r.status + (r.status === 500 ? ' (the solver errored on this spot)' : '') };
      const j = await r.json();
      if (j.error) return { error: j.error };
      if (!j.recommended_action) return { error: 'no recommendation returned' };
      const strategy = j.rebel_strategy || j.cfr_strategy || j.strategy || '';
      return {
        action: named(s, String(j.recommended_action).toLowerCase()),
        model: j.model_used || '',
        reasoning: j.reasoning || '',
        strategy: namedMix(s, strategy),
        classProbs: j.class_probs || classesOf(strategy),   // {fold, passive, aggressive}
        note: j.line_note || '',
        raw: j,
      };
    } catch (e) {
      return { error: e.message };
    }
  }

  /* fold / call / aggressive — comparing "bet" against "raise" is noise */
  function norm(a) {
    a = String(a || '').toLowerCase();
    if (/fold/.test(a)) return 'fold';
    if (/check/.test(a)) return 'check';
    if (/call|bring/.test(a)) return 'call';
    if (/raise|bet|complete/.test(a)) return 'aggressive';
    return a;
  }
  /* a play the solver itself makes at least this often is not a mistake, even if it is not its favourite */
  const MIXED_OK = 0.25;
  function verdict(mine, theirs, classProbs) {
    const a = norm(mine), b = norm(theirs);
    if (a === b) return 'match';
    if (classProbs) {
      const k = a === 'fold' ? 'fold' : a === 'aggressive' ? 'aggressive' : 'passive';
      if ((classProbs[k] || 0) >= MIXED_OK) return 'match';
    }
    // checking when it says call (or the reverse) is the same passive choice
    if ((a === 'check' && b === 'call') || (a === 'call' && b === 'check')) return 'match';
    return 'differs';
  }

  /* several villains: 'match' when your play fits every read, 'split' when only some */
  function verdictMulti(mine, per) {
    const vs = per.filter(v => v.action).map(v => {
      const p = v.probs || {}, n = k => Object.keys(p).filter(a => norm(a) === k).reduce((t, a) => t + p[a], 0);
      const cp = v.probs ? { fold: n('fold'), passive: n('call') + n('check'), aggressive: n('aggressive') } : null;
      return v.verdict = verdict(mine, v.action, cp);
    });
    if (!vs.length) return null;
    if (vs.every(x => x === 'match')) return 'match';
    if (vs.every(x => x === 'differs')) return 'differs';
    return 'split';
  }

  /* correct / incorrect / split (fits some villains' reads, not others) / none, with why.
     Only a real solver answer counts: not a pot-odds fallback, not an older model, and
     never a limit solver's opinion of a no-limit or pot-limit hand. */
  function grade(r) {
    const none = why => ({ grade: 'none', why: why });
    const by = { match: 'correct', differs: 'incorrect', split: 'split' };
    const a = r.advice || {};
    if (limitOnly(r.betting)) return none(limitOnly(r.betting));
    if (a.skipped) return none(a.skipped);
    if (a.error) return none('solver error');
    if (a.perVillain) {
      const reads = a.perVillain.filter(v => v.action && v.trained);
      if (!reads.length) return none('spot not in the solver table');
      return { grade: by[verdictMulti(r.actual, reads)] };
    }
    if (!a.action) return none('no answer from the solver');
    if (a.found === false) return none('spot not in the solver table');
    if (r.game.fam === 'flop') {
      if (/fallback|not in solver table/i.test(a.reasoning || '')) return none('spot not in the solver table');
      if (/^(rebel|ev|heuristic)$/i.test(a.model || ''))
        return none(r.opponents > 1 ? 'multiway: this solver is heads-up' : 'no solver answer for this spot');
    }
    return { grade: by[r.verdict] || 'none', why: r.verdict ? undefined : 'no answer from the solver' };
  }

  async function assess(hand, steps, heroName, onEach) {
    const list = spots(hand, steps, heroName);
    const out = [];
    for (const s of list) {
      const a = await advise(s);
      const row = Object.assign({}, s, { advice: a });
      row.verdict = a.perVillain ? verdictMulti(s.actual, a.perVillain)
        : a.drawCount != null ? (s.drawn === a.drawCount ? 'match' : 'differs')
        : a.action ? verdict(s.actual, a.action, a.classProbs) : null;
      Object.assign(row, grade(row));
      out.push(row);
      if (onEach) onEach(row, out.length, list.length);
    }
    return out;
  }

  global.PSSolver = { url, setUrl, ping, support, limitOnly, spots, advise, assess, verdict, norm, GAMES, DEF };
})(window);
