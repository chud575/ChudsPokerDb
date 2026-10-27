/* ===========================================================================
   solverui.js — the Solver tab: what the HORSE+ Solver would have done at
   each of your decisions in this hand, next to what you actually did.

   Also the solver band under the table: while you step through a hand the
   solver supports, it shows the advice for the decision you are about to
   make (and, once you have made it, how it compares).  Multiway stud pots
   get one heads-up answer per villain, the other villains' cards dead.
   =========================================================================== */
(function (global) {
  'use strict';
  const $ = s => document.querySelector(s);
  const el = (t, c, x) => { const e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; };
  let busy = false, last = null, lastHand = null;
  const AUTO_KEY = 'psreplayer.solver.auto';
  const auto = () => { try { return localStorage.getItem(AUTO_KEY) !== '0'; } catch (e) { return true; } };
  const cache = new Map();        // hand id → rows (or a pending promise)
  const reach = {};               // last ping per family (stud/flop → HORSE+, draw → TD27Web)

  const pc = x => (x * 100).toFixed(0) + '%';

  function build() {
    const p = $('#paneSolver');
    p.innerHTML = '';

    p.appendChild(el('h4', 'sec', 'HORSE+ Solver'));
    const row = el('div', 'tRow');
    const u = el('input', 'tInput'); u.id = 'svUrl'; u.value = PSSolver.url(); u.style.maxWidth = '190px';
    u.onchange = () => { PSSolver.setUrl(u.value.trim() || PSSolver.DEF); u.value = PSSolver.url(); delete reach.stud; delete reach.flop; cache.clear(); band(); };
    row.appendChild(u);
    const t = el('button', 'btn', 'test');
    t.onclick = async () => {
      $('#svStatus').textContent = 'testing…';
      const r = reach.stud = reach.flop = await PSSolver.ping();
      $('#svStatus').className = 'tHint ' + (r.ok ? 'okNote' : 'warnNote');
      $('#svStatus').textContent = r.ok
        ? 'connected · ' + r.ms + 'ms · sample answer "' + r.sample + '"' + (r.model ? ' from ' + r.model : '')
        : 'not reachable — ' + r.why + '. Start it with: python3 horse_master.py -p 5055';
      if (r.ok) band();
    };
    row.appendChild(t);
    p.appendChild(row);
    p.appendChild(el('div', 'tHint', '')).id = 'svStatus';
    p.appendChild(el('div', 'tHint', 'Draw games (2-7 and A-5 Triple Draw, Badugi) ask the Triple Draw trainer:'));
    const row2 = el('div', 'tRow');
    const u2 = el('input', 'tInput'); u2.value = PSDrawSolver.url(); u2.style.maxWidth = '190px';
    u2.onchange = () => { PSDrawSolver.setUrl(u2.value.trim() || PSDrawSolver.DEF); u2.value = PSDrawSolver.url(); delete reach.draw; cache.clear(); band(); };
    row2.appendChild(u2);
    const t2 = el('button', 'btn', 'test');
    t2.onclick = async () => {
      const st = $('#svStatus2');
      st.textContent = 'testing…';
      const r = reach.draw = await PSDrawSolver.ping();
      st.className = 'tHint ' + (r.ok ? 'okNote' : 'warnNote');
      st.textContent = r.ok ? 'connected · ' + r.ms + 'ms' : 'not reachable — ' + r.why + '. Start TD27Web on port 8728.';
      if (r.ok) band();
    };
    row2.appendChild(t2);
    p.appendChild(row2);
    p.appendChild(el('div', 'tHint', '')).id = 'svStatus2';
    const lab = el('label', 'tHint svAuto');
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = auto();
    cb.onchange = () => { try { localStorage.setItem(AUTO_KEY, cb.checked ? '1' : '0'); } catch (e) { } band(); };
    lab.appendChild(cb); lab.appendChild(document.createTextNode(' show the solver’s advice under the table as you replay'));
    p.appendChild(lab);

    p.appendChild(el('h4', 'sec', 'This hand'));
    const go = el('button', 'btn primary', 'Assess my play'); go.id = 'svGo';
    go.onclick = run;
    p.appendChild(go);
    p.appendChild(el('div', 'tHint', '')).id = 'svNote';
    p.appendChild(el('div', '')).id = 'svBody';
    refreshHeader();
  }

  // why the solver cannot take this hand, or '' when it can
  function unsupported(h) {
    const g = PSSolver.support(h.game.key);
    if (!g) return 'The solver has no model for ' + h.game.label + '. It covers Razz, Stud Hi, Stud Hi/Lo, Hold’em, 2-7 and A-5 Triple Draw and Badugi.';
    if (h.game.betting !== 'FL') return 'The solver’s models are fixed-limit; this hand is ' + h.game.betting + '.';
    return '';
  }

  function refreshHeader() {
    const h = PSApp.hand();
    const note = $('#svNote'), go = $('#svGo');
    if (!note) return;
    if (!h) { note.textContent = 'Open a hand first.'; go.disabled = true; return; }
    const why = unsupported(h);
    go.disabled = !!why;
    if (why) { note.textContent = why; return; }
    const g = PSSolver.support(h.game.key);
    note.textContent = g.fam === 'draw'
      ? g.label + ' — each decision (bets and draws) goes to the Triple Draw trainer’s brain for the table size, 2 to 6 players.'
      : g.label + ' — your decisions get sent one at a time, in small-bet units.' +
        (g.fam === 'stud' ? ' With more than one villain, each is read on their own, heads-up, the others’ cards dead.' : '');
  }

  /* every decision in the open hand, asked once and kept */
  function rowsFor(h) {
    if (cache.has(h.id)) return cache.get(h.id);
    const job = PSSolver.assess(h, PSApp.stepsOf(), PSApp.heroName ? PSApp.heroName() : h.hero)
      .then(rows => { cache.set(h.id, rows); return rows; })
      .catch(e => { cache.delete(h.id); throw e; });
    cache.set(h.id, job);
    return job;
  }

  async function run() {
    if (busy) return;
    const h = PSApp.hand();
    if (!h) return;
    busy = true;
    const body = $('#svBody'), go = $('#svGo');
    go.disabled = true;
    body.innerHTML = '';
    const prog = el('div', 'tHint', 'asking the solver…');
    body.appendChild(prog);
    let rows;
    try {
      cache.delete(h.id);
      rows = await rowsFor(h);
    } catch (e) {
      prog.className = 'tHint warnNote';
      prog.textContent = 'Could not reach the solver: ' + e.message;
      busy = false; go.disabled = false; return;
    }
    busy = false; go.disabled = false;
    last = rows; lastHand = h.id;
    render(rows);
    band();
  }

  /* one villain's read: "raise vs Bob — RAISE 91% · CALL 9% · equity 74% (71% with no dead cards)" */
  function villainLine(v, ahead) {
    // ahead: the decision is still to come, so don't colour it by what you went on to do
    const d = el('div', 'svVil' + (ahead ? '' : v.verdict === 'match' ? ' match' : v.verdict === 'differs' ? ' differs' : ''));
    d.appendChild(el('b', null, 'vs ' + v.villain));
    if (v.board.length) d.appendChild(el('span', 'cards', ' ' + v.board.join(' ')));
    if (!v.action) { d.appendChild(el('span', 'dim', '  ' + (v.error || 'no answer'))); return d; }
    d.appendChild(el('span', 'theirs', '  ' + v.action));
    const bits = [];
    if (v.strategy) bits.push(v.strategy.replace(/:/g, ' ').replace(/ \| /g, ' · '));
    if (v.equity != null) bits.push((/stud8|Hi\/Lo/i.test(v.model) ? 'pot share ' : 'equity ') + pc(v.equity) +
      (v.deadUsed && Math.abs(v.equity - v.equityNoDead) >= 0.005 ? ' (' + pc(v.equityNoDead) + ' with no dead cards)' : ''));
    if (!v.trained) bits.push('pot-odds fallback');
    d.appendChild(el('span', 'dim', '  ' + bits.join(' · ')));
    if (v.dead.length) d.title = 'Dead for this read: ' + v.dead.join(' ') + (v.deadUsed ? '' : ' (3rd street keys on the exact cards, so dead cards only change the equity shown)');
    return d;
  }

  function render(rows) {
    const body = $('#svBody');
    body.innerHTML = '';
    if (!rows.length) {
      body.appendChild(el('div', 'tHint', 'You had no betting decisions in this hand.'));
      return;
    }
    const asked = rows.filter(r => r.advice && r.advice.action);
    const match = asked.filter(r => r.verdict === 'match').length;
    const split = asked.filter(r => r.verdict === 'split').length;
    const head = el('div', 'svScore');
    head.appendChild(el('b', null, asked.length ? match + ' of ' + asked.length + ' agree' : 'nothing to compare'));
    if (split) head.appendChild(el('span', 'dim', '  ' + split + ' agree with some villains’ reads, not all'));
    const skipped = rows.length - asked.length;
    if (skipped) head.appendChild(el('span', 'dim', '  ' + skipped + ' spot' + (skipped === 1 ? '' : 's') + ' the solver could not take'));
    body.appendChild(head);

    rows.forEach(r => {
      const d = el('div', 'svRow' + (r.verdict === 'differs' ? ' differs' : r.verdict === 'match' ? ' match' : r.verdict === 'split' ? ' split' : ''));
      const top = el('div', 'svTop');
      top.appendChild(el('span', 'st', r.streetLabel));
      top.appendChild(el('span', 'mine', 'you ' + r.actualLabel));
      const per = r.advice.perVillain;
      if (r.advice.action && !(per && per.length > 1)) top.appendChild(el('span', 'theirs', 'solver ' + r.advice.action));
      if (per && per.length > 1) top.appendChild(el('span', 'dim', per.length + ' villains — one heads-up read each'));
      d.appendChild(top);
      if (per && (per.length > 1 || per[0].dead.length)) per.forEach(v => d.appendChild(villainLine(v)));
      const sub = el('div', 'svSub');
      if (r.advice.skipped) sub.textContent = r.advice.skipped;
      else if (r.advice.error) sub.textContent = 'solver error: ' + r.advice.error;
      else if (!(per && per.length > 1)) sub.textContent = (r.advice.reasoning || r.advice.strategy || '') +
        (r.advice.model && (r.advice.reasoning || '').indexOf(r.advice.model) < 0 ? '  [' + r.advice.model + ']' : '') +
        (r.advice.note ? '  (limit solver not used: ' + r.advice.note + ')' : '');
      if (sub.textContent) d.appendChild(sub);
      const ctx = el('div', 'svCtx');
      ctx.textContent = r.heroCards.join(' ') +
        (r.oppBoards.length ? '   vs ' + r.oppBoards.map(b => b.join(' ')).join(' | ') : '') +
        (r.dead && r.dead.length ? '   folded ' + r.dead.join(' ') : '') +
        (r.board && r.board.length ? '   board ' + r.board.join(' ') : '') +
        '   pot ' + r.pot.toFixed(1) + 'sb, to call ' + r.toCall.toFixed(1) + 'sb';
      d.appendChild(ctx);
      d.onclick = () => PSApp.goto(r.step);
      body.appendChild(d);
    });
  }

  /* ---------- the band under the table ---------- */
  let bandHand = null;
  async function band() {
    const b = $('#solverBand');
    if (!b) return;
    const h = PSApp.hand();
    if (!h || !auto() || unsupported(h)) { b.className = ''; b.innerHTML = ''; bandHand = null; return; }
    b.className = 'on';
    const fam = PSSolver.support(h.game.key).fam;
    if (reach[fam] && !reach[fam].ok) {
      b.innerHTML = '';
      b.appendChild(el('span', 'dim', fam === 'draw'
        ? 'Draw solver not answering at ' + PSDrawSolver.url() + ' — start TD27Web (port 8728) and press test on the Solver tab.'
        : 'Solver not answering at ' + PSSolver.url() + ' — start HORSE+ (python3 horse_master.py -p 5055) and press test on the Solver tab.'));
      return;
    }
    const got = cache.get(h.id);
    if (!got || got.then) {
      if (bandHand !== h.id) { b.innerHTML = ''; b.appendChild(el('span', 'dim', 'asking the solver about your decisions in this hand…')); }
      bandHand = h.id;
      if (!reach[fam]) reach[fam] = await PSSolver.ping(fam);
      if (!reach[fam].ok) { band(); return; }
      try { await rowsFor(h); } catch (e) { b.innerHTML = ''; b.appendChild(el('span', 'dim', 'solver error: ' + e.message)); return; }
      if (PSApp.hand() === h) band();
      return;
    }
    const rows = got, si = PSApp.step();
    b.innerHTML = '';
    const next = rows.find(r => r.step === si + 1), done = rows.find(r => r.step === si);
    const r = next || done;
    if (!r) {
      const left = rows.filter(x => x.step > si && x.advice && x.advice.action).length;
      b.appendChild(el('span', 'dim', rows.length ? (left ? 'Solver: step to your next decision to see its advice (' + left + ' more in this hand).' : 'Solver: no more decisions of yours in this hand.') : 'Solver: you had no betting decisions in this hand.'));
      return;
    }
    const top = el('div', 'sbTop');
    top.appendChild(el('span', 'st', r.streetLabel));
    top.appendChild(el('b', null, next ? 'Your decision — the solver says:' : 'You ' + r.actualLabel + ' —'));
    if (done && !next) top.appendChild(el('span', r.verdict === 'match' ? 'ok' : r.verdict === 'differs' ? 'bad' : 'mid',
      r.verdict === 'match' ? ' agrees' : r.verdict === 'differs' ? ' the solver would not' : r.verdict === 'split' ? ' fits some reads, not all' : ''));
    b.appendChild(top);
    const a = r.advice;
    if (a.skipped || a.error) { b.appendChild(el('div', 'dim', a.skipped || ('solver error: ' + a.error))); return; }
    if (a.perVillain) a.perVillain.forEach(v => b.appendChild(villainLine(v, !!next)));
    else b.appendChild(el('div', 'svVil', (a.action || '') + (a.strategy ? '  ' + a.strategy : '') + (a.model ? '  [' + a.model + ']' : '')));
  }

  function init() {
    build();
    PSApp.onRender(() => {
      const h = PSApp.hand();
      if (!h) return;
      if (lastHand && h.id !== lastHand) { last = null; lastHand = null; const b = $('#svBody'); if (b) b.innerHTML = ''; }
      refreshHeader();
      band();
    });
  }

  global.PSSolverUI = { init, run };
})(window);
