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
   =========================================================================== */
(function (global) {
  'use strict';

  const DEF = 'http://localhost:5055';
  const KEY = 'psreplayer.solver.url';

  /* games the solver answers for, and how its payload is shaped */
  const GAMES = {
    razz:   { id: 'razz',    fam: 'stud', label: 'Razz' },
    stud:   { id: 'stud_hi', fam: 'stud', label: 'Stud Hi' },
    stud8:  { id: 'stud8',   fam: 'stud', label: 'Stud Hi/Lo' },
    holdem: { id: 'holdem',  fam: 'flop', label: "Hold'em" },
    // omaha8 is registered in the solver but its advisor returns HTTP 500 for
    // every payload shape tried, so it is left out until that is fixed.
  };
  const STREET_IX = { preflop: 0, flop: 1, turn: 2, river: 3 };

  const url = () => { try { return localStorage.getItem(KEY) || DEF; } catch (e) { return DEF; } };
  const setUrl = u => { try { localStorage.setItem(KEY, u.replace(/\/+$/, '')); } catch (e) { } };

  async function ping() {
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

  /* ---------- pull every hero decision out of a replayed hand ---------- */
  function spots(hand, steps, heroName) {
    const g = support(hand.game.key);
    const out = [];
    if (!g) return out;
    const hero = heroName || hand.hero;
    if (!hero) return out;
    const sb = +hand.sb || 0;
    if (!sb) return out;

    const byEi = new Map();
    steps.forEach(s => { if (s.ei != null) byEi.set(s.ei, s); });

    hand.events.forEach((e, i) => {
      if (e.t !== 'act' || e.player !== hero) return;
      if (e.verb === 'bringin') return;                 // forced, not a decision
      const s = byEi.get(i);
      if (!s) return;
      const pre = steps[s.i - 1] || steps[0];           // the table before the action
      const h = pre.players.find(p => p.name === hero);
      if (!h) return;

      const cards = h.cards.filter(c => c.c).map(c => c.c);
      const live = pre.players.filter(p => p.inHand && !p.folded && p.name !== hero);
      const maxBet = pre.players.reduce((m, p) => Math.max(m, p.bet), 0);
      const potChips = pre.pot + pre.players.reduce((t, p) => t + p.bet, 0);

      const spot = {
        step: s.i, ei: i, street: pre.street, streetLabel: pre.streetLabel,
        game: g, hero: hero,
        heroCards: cards,
        oppBoards: live.map(p => p.cards.filter(c => c.c && c.up).map(c => c.c)),
        opponents: live.length,
        toCall: Math.max(0, maxBet - h.bet) / sb,
        pot: potChips / sb,
        board: (pre.board || []).slice(),
        actual: e.verb,
        actualLabel: e.verb + (e.to ? ' to ' + e.to : e.amount ? ' ' + e.amount : ''),
      };
      if (!valid(spot)) { spot.skip = reasonInvalid(spot); }
      out.push(spot);
    });
    return out;
  }

  function valid(s) {
    if (s.game.fam === 'stud') {
      if (s.heroCards.length < 3 || s.heroCards.length > 7) return false;
      // the stud adapters want exactly one villain, with their upcards
      if (s.opponents !== 1) return false;
      const want = Math.min(s.heroCards.length, 6) - 2;
      if ((s.oppBoards[0] || []).length !== want) return false;
      return true;
    }
    if (s.game.fam === 'flop') return s.heroCards.length === 2 && STREET_IX[s.street] != null;
    return false;
  }
  function reasonInvalid(s) {
    if (s.game.fam === 'stud' && s.opponents !== 1)
      return s.opponents + '-way — the stud models are heads-up only';
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
    return {
      hero_cards: s.heroCards, street: STREET_IX[s.street],
      to_call: +s.toCall.toFixed(3), pot: +s.pot.toFixed(3),
      num_opponents: s.opponents, board: s.board,
    };
  }

  async function advise(s) {
    if (s.skip) return { skipped: s.skip };
    try {
      const r = await fetch(url() + '/api/game/' + s.game.id + '/advisor', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload(s)),
      });
      if (!r.ok) return { error: 'HTTP ' + r.status + (r.status === 500 ? ' (the solver errored on this spot)' : '') };
      const j = await r.json();
      if (j.error) return { error: j.error };
      if (!j.recommended_action) return { error: 'no recommendation returned' };
      return {
        action: String(j.recommended_action).toLowerCase(),
        model: j.model_used || '',
        reasoning: j.reasoning || '',
        strategy: j.rebel_strategy || j.cfr_strategy || '',
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
    if (/call/.test(a)) return 'call';
    if (/raise|bet|complete/.test(a)) return 'aggressive';
    return a;
  }
  function verdict(mine, theirs) {
    const a = norm(mine), b = norm(theirs);
    if (a === b) return 'match';
    // checking when it says call (or the reverse) is the same passive choice
    if ((a === 'check' && b === 'call') || (a === 'call' && b === 'check')) return 'match';
    return 'differs';
  }

  async function assess(hand, steps, heroName, onEach) {
    const list = spots(hand, steps, heroName);
    const out = [];
    for (const s of list) {
      const a = await advise(s);
      const row = Object.assign({}, s, { advice: a });
      row.verdict = a.action ? verdict(s.actual, a.action) : null;
      out.push(row);
      if (onEach) onEach(row, out.length, list.length);
    }
    return out;
  }

  global.PSSolver = { url, setUrl, ping, support, spots, advise, assess, verdict, norm, GAMES, DEF };
})(window);
