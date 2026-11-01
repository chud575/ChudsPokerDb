/* ===========================================================================
   tendency.js — what a player's line has meant, read from the hands they showed.

   Every bet, raise, check-raise, re-raise and call in the library is a decision.
   Where the player's cards are known, the hand is put back to that moment and
   read from their seat: their cards so far against what the others were showing,
   with the others' hidden cards random.  Two numbers come out, both as a share of
   the pot and both scaled so 50% is a fair share at any number of players:

     equity  with the rest of the cards still to come
     ahead   if the hand stopped here, no more cards for anyone

   Those two say which kind of hand it was:

     Very strong   equity 70% or more
     Bluff         equity under 40%
     Semi-bluff    in between, and not ahead now (under 60%) — the money is in the draw
     Medium        in between and ahead now: a made hand, but not a big one

   There is nothing to draw to on the last street, or before a flop, so those read
   as Very strong, Medium or Bluff only.

   Only shown hands can be read, and that is a biased sample: a bluff that works
   is never turned over.  So every count carries the decisions that were not seen,
   and how far the bluff figure could go if all of them were bluffs.  A player's own
   sample is usually tiny, so the estimate leans on everyone else's shown hands in
   the same spot, by POOL_WEIGHT hands' worth, until the player has enough of their own.

   Draw games are left out: a shown hand is only what they finished with, and what
   they held before the last draw is gone.  Stud hands from a site that does not
   print the upcards are left out too — there is no way to see what was on the table.
   =========================================================================== */
(function (global) {
  'use strict';

  const VER = 1;
  // Omaha scores every hole pair with every board trio, so fewer deals: a read only
  // has to land on the right side of a threshold, not settle to a decimal
  const simsFor = v => v.fam === 'flop' && v.mine.length > 2 ? (v.mine.length > 4 ? 120 : 250) : 800;
  const STRONG = 0.70, BLUFF = 0.40, MADE = 0.60;
  const POOL_WEIGHT = 8;

  const LINES = [
    { id: 'aggr', label: 'Any bet or raise', verb: 'bets or raises' },
    { id: 'bet', label: 'Bet', verb: 'bets' },
    { id: 'raise', label: 'Raise', verb: 'raises' },
    { id: 'checkraise', label: 'Check-raise', verb: 'check-raises' },
    { id: 'reraise', label: 'Re-raise', verb: 're-raises' },
    { id: 'call', label: 'Call', verb: 'calls' },
    { id: 'checkcall', label: 'Check-call', verb: 'check-calls' },
  ];
  const AGGR = { bet: 1, raise: 1, checkraise: 1, reraise: 1 };
  const BUCKETS = [
    { id: 'strong', label: 'Very strong' },
    { id: 'medium', label: 'Medium' },
    { id: 'semi', label: 'Semi-bluff' },
    { id: 'bluff', label: 'Bluff' },
  ];
  const STREETS = { stud: ['3rd', '4th', '5th', '6th', '7th'], flop: ['preflop', 'flop', 'turn', 'river'] };

  const wantOf = h => h.game.fam === 'stud' ? 7 : h.game.cards;
  const supported = h => !!STREETS[h.game.fam] && !h.game.noEval && !h.board2 && !h.noUpcards;

  function rngFor(str) {
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = h << 13 | h >>> 19; }
    let a = h >>> 0;
    return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }

  /* ---------- every decision in one hand ---------- */
  const byHand = new WeakMap();
  function decisionsOf(h) {
    let list = byHand.get(h);
    if (list) return list;
    list = [];
    byHand.set(h, list);
    if (!supported(h)) return list;
    const street0 = STREETS[h.game.fam], last = street0[3 + (h.game.fam === 'stud' ? 1 : 0)];
    const want = wantOf(h), folded = new Set();
    const seated = h.seats.filter(s => s.inHand).map(s => s.name);
    let street = '', raises = 0, checked = new Set(), taken = new Set();
    h.events.forEach((e, ei) => {
      if (e.t === 'street') { street = e.id; raises = 0; checked = new Set(); taken = new Set(); return; }
      if (e.t !== 'act' || !street0.includes(street)) return;
      if (e.verb === 'fold') { folded.add(e.player); return; }
      if (e.verb === 'check') { checked.add(e.player); return; }
      let line = null;
      if (e.verb === 'bet') { line = 'bet'; raises++; }
      else if (e.verb === 'raise') { line = checked.has(e.player) ? 'checkraise' : raises >= 2 ? 'reraise' : 'raise'; raises++; }
      else if (e.verb === 'call') line = checked.has(e.player) ? 'checkcall' : 'call';
      if (!line) return;
      // a line counts once a street: a second raise in the same round is not a new read
      const k = e.player + '|' + line;
      if (taken.has(k)) return;
      taken.add(k);
      list.push({
        h: h, ei: ei, player: e.player, street: street, line: line, last: street === last,
        noDraw: street === last || street === 'preflop',
        vs: seated.filter(n => n !== e.player && !folded.has(n)),
      });
    });
    const sawShowdown = h.streets.includes('showdown');
    for (const d of list) {
      const r = h.revealed && h.revealed[d.player];
      d.shown = !!(r && r.length === want);
      d.known = d.shown || d.player === h.hero;
      // how an unseen hand ended: the three ways the cards stay hidden
      d.fate = d.known ? null : folded.has(d.player) ? 'folded' : sawShowdown ? 'mucked' : 'uncalled';
    }
    return list;
  }

  /* everything in a set of hands; yields so a big library does not freeze the page */
  async function decisions(hands, onProgress) {
    const out = [];
    let t0 = Date.now();
    for (let i = 0; i < hands.length; i++) {
      const l = decisionsOf(hands[i]);
      for (let k = 0; k < l.length; k++) out.push(l[k]);
      if (Date.now() - t0 > 40) { if (onProgress) onProgress(i + 1, hands.length); await new Promise(r => setTimeout(r, 0)); t0 = Date.now(); }
    }
    return out;
  }

  /* ---------- put the hand back to that moment ---------- */
  function stepsOf(h) {
    const w = h.warnings;
    h.warnings = [];
    const s = global.PSEngine.build(h);
    h.warnings = w;
    return s;
  }

  /* the table as the player saw it: their own cards, everybody's upcards, the board.
     Cards the history knows and they did not (the hero's, when reading someone else)
     stay in the deck, because from that seat they could be anywhere. */
  function seatView(d, steps) {
    const E = global.PSEquity, h = d.h, fam = h.game.fam;
    const step = (steps || stepsOf(h)).find(s => s.ei === d.ei);
    if (!step) return null;
    const live = step.players.filter(p => p.inHand && !p.folded);
    const me = live.find(p => p.name === d.player);
    if (!me || live.length < 2) return null;
    const cards = d.shown
      ? (fam === 'stud' ? h.revealed[d.player].slice(0, me.cards.length) : h.revealed[d.player].slice())
      : me.cards.map(c => c.c);
    const mine = cards.map(E.cid);
    if (mine.some(c => c < 0)) return null;
    const used = new Set(mine), board = step.board.map(E.cid), opps = [];
    board.forEach(c => used.add(c));
    for (const p of step.players) {
      if (p === me) continue;
      const up = p.cards.filter(c => c.c && c.up).map(c => c.c), ids = up.map(E.cid);
      ids.forEach(c => used.add(c));
      if (live.includes(p)) opps.push({ name: p.name, up: up, known: ids, hidden: p.cards.length - ids.length });
    }
    const deck = [];
    for (let i = 0; i < 52; i++) if (!used.has(i)) deck.push(i);
    return { key: E.evalKey(h.game.key), fam: fam, want: wantOf(h), cards: cards, mine: mine, opps: opps,
             board: board, boardCards: step.board.slice(), deck: deck, noDraw: d.noDraw, step: step.i };
  }

  /* -> { eq, now } as fair-share-scaled fractions, or null when it cannot be dealt */
  function measure(v, seed) {
    const E = global.PSEquity, rnd = rngFor(seed);
    const { key, fam, want, mine, opps, board } = v;
    const d = v.deck.slice(), len = d.length, np = opps.length + 1;
    const toCome = fam === 'stud' ? np * (want - mine.length) : 5 - board.length;
    if (opps.reduce((a, o) => a + o.hidden, 0) + toCome > len) return null;
    const frozen = !v.noDraw && (fam === 'flop' ? board.length >= 3 : mine.length >= 5);
    const hands = [mine.slice()].concat(opps.map(() => [])), bd = [], out = new Array(np).fill(0);
    const sims = simsFor(v);
    let eq = 0, now = 0;
    for (let s = 0; s < sims; s++) {
      let di = 0;
      const draw = () => { const j = di + Math.floor(rnd() * (len - di)), t = d[di]; d[di] = d[j]; d[j] = t; return d[di++]; };
      hands[0].length = mine.length;
      opps.forEach((o, k) => {
        const hnd = hands[k + 1];
        hnd.length = 0;
        for (let i = 0; i < o.known.length; i++) hnd.push(o.known[i]);
        for (let i = 0; i < o.hidden; i++) hnd.push(draw());
      });
      bd.length = 0;
      for (let i = 0; i < board.length; i++) bd.push(board[i]);
      if (frozen) { E.sharesInto(key, hands, bd, out); now += out[0]; }
      else if (!v.noDraw) now += aheadPartial(key, hands);
      if (fam === 'stud') for (const hnd of hands) while (hnd.length < want) hnd.push(draw());
      else while (bd.length < 5) bd.push(draw());
      E.sharesInto(key, hands, bd, out);
      eq += out[0];
    }
    const fair = x => np === 2 ? x : x / (x + (1 - x) / (np - 1));
    const e = fair(eq / sims);
    return { eq: e, now: v.noDraw ? e : fair(now / sims) };
  }

  /* fewer than five stud cards: no made hand to score yet, so compare the partial
     strengths — pairs against high cards, or the lowest cards in razz */
  function aheadPartial(key, hands) {
    const E = global.PSEquity;
    const sc = hands.map(h => E.strengths(key, h));
    const val = s => s.hi != null ? s.hi : -s.lo;
    const a = val(sc[0]);
    let ties = 1;
    for (let i = 1; i < sc.length; i++) { const b = val(sc[i]); if (b > a) return 0; if (b === a) ties++; }
    return 1 / ties;
  }

  function bucketOf(r, noDraw) {
    if (r.eq >= STRONG) return 'strong';
    if (r.eq < BLUFF) return 'bluff';
    return !noDraw && r.now < MADE ? 'semi' : 'medium';
  }

  /* ---------- reads, cached across visits like the luck table ---------- */
  let cache = null;
  async function loadCache() {
    if (cache) return cache;
    cache = {};
    try { const c = await global.PSDB.getMeta('tendency'); if (c && c.v === VER) cache = c.map || {}; } catch (e) { }
    return cache;
  }
  const clearCache = async () => { cache = {}; try { await global.PSDB.setMeta('tendency', { v: VER, map: {} }); } catch (e) { } };

  // reads a set of decisions in place: d.eq, d.now, d.read.  Only known hands; the rest have none.
  async function readAll(list, onProgress) {
    await loadCache();
    const todo = list.filter(d => d.known && d.read === undefined);
    let t0 = Date.now(), dirty = false, steps = null, stepsFor = null;
    for (let i = 0; i < todo.length; i++) {
      const d = todo[i], ck = d.h.id + '|' + d.player + '|' + d.ei;
      let r = cache[ck];
      if (r === undefined) {
        if (stepsFor !== d.h) { steps = stepsOf(d.h); stepsFor = d.h; }
        const v = seatView(d, steps), m = v && measure(v, ck);
        r = m ? [Math.round(m.eq * 1000), Math.round(m.now * 1000)] : 0;
        cache[ck] = r;
        dirty = true;
      }
      d.read = r ? bucketOf({ eq: r[0] / 1000, now: r[1] / 1000 }, d.noDraw) : null;
      if (r) { d.eq = r[0] / 1000; d.now = r[1] / 1000; }
      if (Date.now() - t0 > 40) { if (onProgress) onProgress(i + 1, todo.length); await new Promise(res => setTimeout(res, 0)); t0 = Date.now(); }
    }
    if (dirty) { try { await global.PSDB.setMeta('tendency', { v: VER, map: cache }); } catch (e) { } }
  }

  /* ---------- counting ---------- */
  function matches(d, f) {
    if (f.game && d.h.game.key !== f.game) return false;
    if (f.line === 'aggr' ? !AGGR[d.line] : f.line && d.line !== f.line) return false;
    if (f.street === 'before') { if (d.last) return false; }
    else if (f.street && f.street !== 'all' && d.street !== f.street) return false;
    return true;
  }

  const emptyTally = () => ({ n: 0, strong: 0, medium: 0, semi: 0, bluff: 0 });
  function tally(list) {
    const t = emptyTally();
    for (const d of list) if (d.read) { t[d.read]++; t.n++; }
    return t;
  }
  function unseen(list) {
    const u = { n: 0, folded: 0, mucked: 0, uncalled: 0 };
    for (const d of list) if (d.fate) { u[d.fate]++; u.n++; }
    return u;
  }

  /* the player's own hands, leaning on the pool until there are enough of them */
  function estimate(mine, pool) {
    const weight = pool.n ? POOL_WEIGHT : 0, total = mine.n + weight;
    if (!total) return null;
    const out = {};
    for (const b of BUCKETS) out[b.id] = (mine[b.id] + (pool.n ? weight * pool[b.id] / pool.n : 0)) / total;
    return out;
  }

  /* who, what, where -> the whole read.  skipId: a hand to leave out, the one being
     replayed, so the hand on the table never gets to vouch for itself. */
  async function query(all, f, skipId, onProgress) {
    const near = all.filter(d => d.h.id !== skipId && matches(d, f));
    const mineAll = near.filter(d => d.player === f.player && (!f.vs || d.vs.includes(f.vs)));
    // everyone else's hands only count where a showdown turned them over, like any opponent's;
    // the hero's folds are known, but the same folds from anyone else are not
    const poolAll = near.filter(d => d.shown);
    await readAll(mineAll.concat(poolAll), onProgress);
    const mine = tally(mineAll), pool = tally(poolAll), hidden = unseen(mineAll);
    return {
      list: mineAll, mine: mine, pool: pool, unseen: hidden, est: estimate(mine, pool),
      // if every hand we did not see was a bluff
      bluffMax: mine.n + hidden.n ? (mine.bluff + hidden.n) / (mine.n + hidden.n) : null,
    };
  }

  global.PSTendency = {
    LINES, BUCKETS, STREETS, POOL_WEIGHT, STRONG, BLUFF, MADE, AGGR,
    supported, decisionsOf, decisions, stepsOf, seatView, measure, bucketOf, readAll, matches,
    tally, unseen, estimate, query, clearCache,
  };
})(typeof window !== 'undefined' ? window : globalThis);
