/* ===========================================================================
   handreview.js — how the hero played each finished hand, for the Table HUD.

   While the HUD is reachable, the newest hero hands in the library are graded
   the same way the Mistake rate grades them (mistakes.js) and posted to it.
   Only finished hands exist here: a history is written once a hand is over, so
   nothing in this file can ever speak about a hand still being played.

   Grades never change for a hand, so each is kept and only new hands go to the
   solver.  A hand whose solver is down stays ungraded and is tried again.
   =========================================================================== */
(function (global) {
  'use strict';

  const VER = 3, KEEP = 50, BATCH = 8;
  const M = () => global.PSMistakes, S = () => global.PSSolver;
  const NAME = { c: 'ok', i: 'miss', x: 'split', n: 'none' };

  let map = null, sent = '';
  async function load() {
    if (map) return map;
    map = {};
    try { const c = await global.PSDB.getMeta('hudReview'); if (c && c.v === VER) map = c.map || {}; } catch (e) { }
    return map;
  }

  const newest = hands => hands.filter(h => h.hero && h.dateObj)
    .sort((a, b) => b.dateObj - a.dateObj).slice(0, KEEP);

  function cardsOf(h, steps) {
    const end = steps[steps.length - 1];
    const me = end && end.players.find(p => p.name === h.hero);
    return me ? me.cards.filter(c => c.c).map(c => c.c) : [];
  }

  /* one hand -> its record, or null when the solver dropped out */
  async function review(h) {
    const steps = global.PSTendency.stepsOf(h);
    const rec = {
      id: h.id, game: h.game.label, stakes: h.stakes || '', when: h.date || '',
      money: !!(h.isCash && /[$€£]/.test(h.stakes)),
      net: Math.round((global.PSEngine.netFor(h)[h.hero] || 0) * 100) / 100,
      cards: cardsOf(h, steps), graded: 0, mistakes: 0, big: 0, lines: [],
    };
    const shut = M().closed(h);
    if (shut) { rec.why = shut; return rec; }
    const rows = await M().gradeSeat({ h: h, player: h.hero });
    if (!rows) return null;
    const sum = M().fresh();
    for (const r of rows) {
      M().add(sum, r);
      const line = { street: r.t, did: r.a, grade: NAME[r.g] };
      if (r.g === 'i' || r.g === 'x') line.note = M().leakOf(r);
      if (r.g === 'n') line.note = r.w;
      if (r.p != null) line.share = r.p;
      rec.lines.push(line);
    }
    rec.graded = M().graded(sum);
    rec.mistakes = M().misses(sum);
    rec.big = sum.big;
    if (!rec.graded) rec.why = rows.length ? (rows[0].w || 'not graded') : 'no decisions to grade';
    return rec;
  }

  /* grades a few new hands and tells the HUD if anything changed */
  async function sync(hands, hud) {
    await load();
    const list = newest(hands);
    const todo = list.filter(h => !map[h.id]);
    const up = {}, down = new Set();
    const alive = async h => {
      const g = S().support(h.game.key);
      if (!g || M().closed(h)) return true;
      const f = g.fam === 'draw' ? 'draw' : 'stud';
      if (!(f in up)) up[f] = (await S().ping(f === 'draw' ? 'draw' : undefined)).ok;
      if (!up[f]) down.add(f);
      return up[f];
    };
    let done = 0, changed = false;
    for (const h of todo) {
      if (done >= BATCH) break;
      if (!(await alive(h))) continue;
      const rec = await review(h);
      if (rec) { map[h.id] = rec; changed = true; }
      done++;
    }
    if (changed) {
      const kept = {};
      list.forEach(h => { if (map[h.id]) kept[h.id] = map[h.id]; });
      map = kept;
      try { await global.PSDB.setMeta('hudReview', { v: VER, map: map }); } catch (e) { console.warn('hand review', e); }
    }
    const report = {
      hands: list.map(h => map[h.id]).filter(Boolean),
      waiting: list.filter(h => !map[h.id]).length,
      down: Array.from(down),
    };
    const body = JSON.stringify(report);
    if (body === sent) return report;
    await fetch(hud + '/review', { method: 'POST', body: body });
    sent = body;
    return report;
  }

  global.PSHandReview = { sync, review, KEEP };
})(window);
