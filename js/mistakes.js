/* ===========================================================================
   mistakes.js — how often each player's play parted from the solver, in the
   hands where their cards were seen.

   Every hand with a player's whole hand exposed, at a showdown or before one, is
   put back to each decision they made and read from their seat: their own cards,
   the upcards and board, the betting so far.  The solver answers from there, and
   the play is graded the way the solver band and the tournament review grade it:

     correct    its top play, or a play it makes at least 25% of the time
     mistake    anything else
     split      multiway stud: fits the read against some villains, not others.
                Counts as half a mistake.
     big        a mistake it makes under 5% of the time

   The grading needs the solver running, takes a while over a whole library, and
   never changes for a given hand, so it is a run the user starts, it can stop and
   pick up later, and only new hands are asked next time.

   What cannot be read is left out and counted, never guessed:
     · games with no solver, and no-limit and pot-limit hands (the solvers are limit)
     · stud from a site that does not print the upcards
     · draw hands before a player's last draw: a shown hand is what they finished with
     · spots the solver has no trained answer for

   Shown hands are a biased sample, and a player who reaches showdown never folded
   in that hand.  So folding too much cannot show up here, and the fair comparison
   is a player against the field in the same games and streets (expected()).
   Your own draw hands are in the history from the deal, everyone else's only from
   their last draw, so the comparison uses the decisions both sides have.
   =========================================================================== */
(function (global) {
  'use strict';

  const VER = 6, BIG = 0.05;
  const LOCAL = typeof location === 'undefined' || location.protocol === 'file:' || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  const WORKERS = LOCAL ? 4 : 1;      // hosted, the solver is the one the public site is playing on
  const GIVE_UP = 25;                 // failures in a row: the solver has gone
  const SAVE_EVERY = 20000;

  const S = () => global.PSSolver, T = () => global.PSTendency;
  const wantOf = h => h.game.fam === 'stud' ? 7 : h.game.cards;

  /* why nobody can be graded in this hand; '' when they can */
  function closed(h) {
    if (!S().support(h.game.key)) return 'no solver for ' + h.game.label;
    return S().limitOnly(h.game.betting) || S().noBoards(h);
  }

  /* everyone whose whole hand was exposed in this hand */
  const bySeat = new WeakMap();
  function seatsOf(h) {
    let l = bySeat.get(h);
    if (l) return l;
    l = [];
    for (const n of Object.keys(h.revealed || {})) {
      const c = h.revealed[n];
      if (c.length === wantOf(h)) l.push({ h: h, player: n, cards: c, key: h.id + '|' + n });
    }
    bySeat.set(h, l);
    return l;
  }
  function seats(hands) {
    const out = [];
    for (const h of hands) { const l = seatsOf(h); for (let i = 0; i < l.length; i++) out.push(l[i]); }
    return out;
  }

  /* ---------- grades, kept across visits like the luck table ---------- */
  let cache = null, stale = null;
  async function load(hands) {
    if (!cache) {
      cache = {};
      try {
        const c = await global.PSDB.getMeta('mistakes');
        if (c && c.v >= 1 && c.v <= VER) cache = c.map || {};
        // v1 graded under the old draw brains; they differ only after the last draw
        if (c && c.v === 1) for (const k in cache) if (cache[k].some(r => /^After 3rd/.test(r.t))) delete cache[k];
        // before v3, Hold'em came from time-limited solves; before v4, the draw brains had not
        // re-solved the betting with one draw left, the last draw and the river; before v5,
        // A-5 six-handed had a shorter re-solve, and before v6 so did 2-7 and Badugi
        if (c && c.v < 6) stale = new Set(['td27', 'badugi']);
        if (c && c.v < 5) stale.add('a5td');
        if (c && c.v < 3) stale.add('holdem');
      } catch (e) { }
    }
    // a grade doesn't name its game, so this waits for the hands
    if (stale && hands) {
      for (const x of seats(hands)) if (stale.has(x.h.game.key)) delete cache[x.key];
      stale = null;
    }
    return cache;
  }
  async function save() { try { await global.PSDB.setMeta('mistakes', { v: VER, map: cache }); } catch (e) { console.warn('mistakes', e); } }

  async function pending(hands) {
    await load(hands);
    return seats(hands).filter(x => !cache[x.key] && !closed(x.h));
  }

  /* the plain words for what the solver wanted, the commonest read when there are several */
  function wanted(r) {
    const a = r.advice || {};
    if (!a.perVillain) return S().norm(a.action);
    const n = {};
    for (const v of a.perVillain) if (v.action && v.trained) { const k = S().norm(v.action); n[k] = (n[k] || 0) + 1; }
    return Object.keys(n).sort((x, y) => n[y] - n[x])[0] || '';
  }

  const CODE = { correct: 'c', incorrect: 'i', split: 'x', none: 'n' };
  function shrink(r) {
    const g = CODE[r.grade] || 'n', o = { s: r.step, t: r.streetLabel || r.street, a: r.actualLabel, g: g };
    if (g === 'n') { o.w = r.why || 'not graded'; return o; }
    const p = S().shareOf(r);
    if (p != null) o.p = +p.toFixed(3);
    if (g === 'c') return o;
    // only the misses are ever listed, so only they carry the detail
    o.v = S().norm(r.actual);
    o.o = wanted(r);
    o.say = r.advice.action || '';
    o.m = r.advice.strategy || '';
    o.c = r.heroCards;
    if (r.kind === 'draw') { o.d = r.drawn > r.advice.drawCount ? 'more' : 'fewer'; }
    return o;
  }

  /* one player in one hand -> their rows, or null when the solver dropped out so it can be asked again */
  async function gradeSeat(x) {
    let rows;
    try { rows = await S().assess(x.h, T().stepsOf(x.h), x.player, null, x.cards); }
    catch (e) { return null; }
    if (rows.some(r => r.why === 'solver error')) return null;
    return rows.map(shrink);
  }

  /* grades everything not yet graded.  stopped() ends it early and what is done stays done. */
  async function run(hands, onProgress, stopped) {
    const todo = await pending(hands);
    const fams = new Set(todo.map(x => S().support(x.h.game.key).fam));
    const up = {};
    if (fams.has('stud') || fams.has('flop')) up.stud = up.flop = (await S().ping()).ok;
    if (fams.has('draw')) up.draw = (await S().ping('draw')).ok;
    const queue = todo.filter(x => up[S().support(x.h.game.key).fam]);
    let i = 0, done = 0, failed = 0, row = 0, saved = Date.now(), t0 = Date.now();
    // Hold'em turn solves queue behind one lock on the server, so side by side they only wait,
    // past two minutes at four workers, long enough for a browser to give up.  Single file.
    let line = Promise.resolve();
    const grade = x => x.h.game.key === 'holdem' ? (line = line.then(() => gradeSeat(x))) : gradeSeat(x);
    const work = async () => {
      while (i < queue.length && !stopped() && row < GIVE_UP) {
        const x = queue[i++], rows = await grade(x);
        if (rows) { cache[x.key] = rows; done++; row = 0; } else { failed++; row++; }
        if (onProgress) onProgress(done + failed, queue.length);
        if (Date.now() - t0 > 40) { await new Promise(r => setTimeout(r, 0)); t0 = Date.now(); }
        if (Date.now() - saved > SAVE_EVERY) { saved = Date.now(); await save(); }
      }
    };
    await Promise.all(Array.from({ length: WORKERS }, work));
    await save();
    return {
      done: done, failed: failed, gaveUp: row >= GIVE_UP,
      down: Object.keys(up).filter(f => !up[f]),
      left: (await pending(hands)).length,
    };
  }

  /* ---------- counting ---------- */
  const fresh = () => ({ correct: 0, bad: 0, split: 0, none: 0, big: 0 });
  const graded = t => t.correct + t.bad + t.split;
  const misses = t => t.bad + t.split / 2;
  const rate = t => graded(t) ? misses(t) / graded(t) : null;
  function add(t, r) {
    if (r.g === 'c') t.correct++;
    else if (r.g === 'i') { t.bad++; if (r.p != null && r.p < BIG) t.big++; }
    else if (r.g === 'x') t.split++;
    else t.none++;
  }
  /* 95% either side, Wilson.  Decisions in one hand lean on each other, so take it as a floor. */
  function margin(p, n) {
    const z = 1.96, d = 1 + z * z / n;
    return z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d;
  }

  const cellOf = (h, r) => h.game.key + '|' + r.t;

  /* draw hands: draws made by a street, and draws it takes for the shown hand to be known */
  const drawsBy = t => { const m = /\d/.exec(t); return !m ? 0 : /^After/.test(t) ? +m[0] : m[0] - 1; };
  function drawsToKnow(h, player) {
    let n = 0, from = 0;
    for (const e of h.events) if ((e.t === 'discard' || e.t === 'pat') && e.player === player) { n++; if (e.count) from = n; }
    return from;
  }

  /* the field's rate on this player's own mix of games and streets, without them in it,
     and theirs on those same rows */
  function expected(p, pool) {
    let want = 0, own = 0, n = 0;
    for (const k of Object.keys(p.cells)) {
      const c = p.cells[k], f = pool[k];
      const others = graded(f) - graded(c);
      if (!others || !graded(c)) continue;
      want += graded(c) * (misses(f) - misses(c)) / others;
      own += misses(c);
      n += graded(c);
    }
    return n ? { field: want / n, own: own / n } : { field: null, own: null };
  }

  /* every player, from what has been graded so far.  game: one game key or ''. */
  function table(hands, game) {
    const players = {}, pool = {}, all = fresh();
    let shown = 0, waiting = 0;
    for (const x of seats(hands)) {
      if (game && x.h.game.key !== game) continue;
      shown++;
      const p = players[x.player] || (players[x.player] = Object.assign(fresh(), { name: x.player, hands: 0, read: 0, cells: {}, why: {} }));
      p.hands++;
      const no = closed(x.h);
      if (no) {
        const n = x.h.events.reduce((t, e) => t + (e.t === 'act' && e.player === x.player ? 1 : 0), 0);
        p.none += n; all.none += n;
        p.why[no] = (p.why[no] || 0) + n;
        continue;
      }
      const rows = cache && cache[x.key];
      if (!rows) { waiting++; continue; }
      p.read++;
      const known = x.h.game.fam === 'draw' ? drawsToKnow(x.h, x.player) : 0;
      for (const r of rows) {
        add(p, r); add(all, r);
        if (r.g === 'n') { p.why[r.w] = (p.why[r.w] || 0) + 1; continue; }
        if (known && drawsBy(r.t) < known) continue;
        const k = cellOf(x.h, r);
        add(p.cells[k] || (p.cells[k] = fresh()), r);
        add(pool[k] || (pool[k] = fresh()), r);
      }
    }
    const list = Object.values(players);
    for (const p of list) { p.rate = rate(p); Object.assign(p, expected(p, pool)); }
    return { players: list, all: all, shown: shown, waiting: waiting };
  }

  /* the graded decisions of one player, each with its hand */
  function rowsOf(hands, player, game) {
    const out = [];
    for (const h of hands) {
      if (game && h.game.key !== game) continue;
      const rows = cache && cache[h.id + '|' + player];
      if (rows) for (const r of rows) out.push(Object.assign({ h: h }, r));
    }
    return out;
  }

  const DID = { fold: 'Folded', check: 'Checked', call: 'Called', aggressive: 'Bet or raised' };
  const WANT = { fold: 'fold', check: 'check', call: 'call', aggressive: 'bet or raise' };
  function leakOf(r) {
    if (r.d) return r.d === 'more' ? 'Drew more cards than the solver' : 'Drew fewer cards than the solver';
    if (r.g === 'x') return (DID[r.v] || r.v) + ', right against only some opponents';
    return (DID[r.v] || r.v) + ', the solver would ' + (WANT[r.o] || r.o || 'do otherwise');
  }

  global.PSMistakes = {
    BIG, load, pending, run, table, rowsOf, leakOf, closed, seats, gradeSeat,
    fresh, add, graded, misses, rate, margin,
  };
})(typeof window !== 'undefined' ? window : globalThis);
