/* ===========================================================================
   solverui.js — the Solver tab: what the HORSE+ Solver would have done at
   each of your decisions in this hand, next to what you actually did.
   =========================================================================== */
(function (global) {
  'use strict';
  const $ = s => document.querySelector(s);
  const el = (t, c, x) => { const e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; };
  let busy = false, last = null, lastHand = null;

  function build() {
    const p = $('#paneSolver');
    p.innerHTML = '';

    p.appendChild(el('h4', 'sec', 'HORSE+ Solver'));
    const row = el('div', 'tRow');
    const u = el('input', 'tInput'); u.id = 'svUrl'; u.value = PSSolver.url(); u.style.maxWidth = '190px';
    u.onchange = () => { PSSolver.setUrl(u.value.trim() || PSSolver.DEF); u.value = PSSolver.url(); };
    row.appendChild(u);
    const t = el('button', 'btn', 'test');
    t.onclick = async () => {
      $('#svStatus').textContent = 'testing…';
      const r = await PSSolver.ping();
      $('#svStatus').className = 'tHint ' + (r.ok ? 'okNote' : 'warnNote');
      $('#svStatus').textContent = r.ok
        ? 'connected · ' + r.ms + 'ms · sample answer "' + r.sample + '"' + (r.model ? ' from ' + r.model : '')
        : 'not reachable — ' + r.why + '. Start it with: python3 horse_master.py -p 5055';
    };
    row.appendChild(t);
    p.appendChild(row);
    p.appendChild(el('div', 'tHint', '')).id = 'svStatus';

    p.appendChild(el('h4', 'sec', 'This hand'));
    const go = el('button', 'btn primary', 'Assess my play'); go.id = 'svGo';
    go.onclick = run;
    p.appendChild(go);
    p.appendChild(el('div', 'tHint', '')).id = 'svNote';
    p.appendChild(el('div', '')).id = 'svBody';
    refreshHeader();
  }

  function refreshHeader() {
    const h = PSApp.hand();
    const note = $('#svNote'), go = $('#svGo');
    if (!note) return;
    if (!h) { note.textContent = 'Open a hand first.'; go.disabled = true; return; }
    const g = PSSolver.support(h.game.key);
    if (!g) {
      go.disabled = true;
      note.textContent = 'The solver has no model for ' + h.game.label +
        '. It covers Razz, Stud Hi, Stud Hi/Lo and Hold’em.';
      return;
    }
    if (h.game.betting !== 'FL') {
      go.disabled = true;
      note.textContent = 'The solver’s models are fixed-limit; this hand is ' + h.game.betting + '.';
      return;
    }
    go.disabled = false;
    note.textContent = g.label + ' — your decisions get sent one at a time, in small-bet units.';
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

    const steps = PSApp.stepsOf ? PSApp.stepsOf() : null;
    let rows;
    try {
      rows = await PSSolver.assess(h, steps, PSApp.heroName ? PSApp.heroName() : h.hero,
        (r, i, n) => { prog.textContent = 'asking the solver… ' + i + '/' + n; });
    } catch (e) {
      prog.className = 'tHint warnNote';
      prog.textContent = 'Could not reach the solver: ' + e.message;
      busy = false; go.disabled = false; return;
    }
    busy = false; go.disabled = false;
    last = rows; lastHand = h.id;
    render(rows);
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
    const head = el('div', 'svScore');
    head.appendChild(el('b', null, asked.length ? match + ' of ' + asked.length + ' agree' : 'nothing to compare'));
    const skipped = rows.length - asked.length;
    if (skipped) head.appendChild(el('span', 'dim', '  ' + skipped + ' spot' + (skipped === 1 ? '' : 's') + ' the solver could not take'));
    body.appendChild(head);

    rows.forEach(r => {
      const d = el('div', 'svRow' + (r.verdict === 'differs' ? ' differs' : r.verdict === 'match' ? ' match' : ''));
      const top = el('div', 'svTop');
      top.appendChild(el('span', 'st', r.streetLabel));
      top.appendChild(el('span', 'mine', 'you ' + r.actualLabel));
      if (r.advice.action) top.appendChild(el('span', 'theirs', 'solver ' + r.advice.action));
      d.appendChild(top);
      const sub = el('div', 'svSub');
      if (r.advice.skipped) sub.textContent = r.advice.skipped;
      else if (r.advice.error) sub.textContent = 'solver error: ' + r.advice.error;
      else sub.textContent = (r.advice.reasoning || r.advice.strategy || '') +
        (r.advice.model ? '  [' + r.advice.model + ']' : '');
      d.appendChild(sub);
      const ctx = el('div', 'svCtx');
      ctx.textContent = r.heroCards.join(' ') +
        (r.oppBoards.length ? '   vs ' + r.oppBoards.map(b => b.join(' ')).join(' | ') : '') +
        (r.board && r.board.length ? '   board ' + r.board.join(' ') : '') +
        '   pot ' + r.pot.toFixed(1) + 'sb, to call ' + r.toCall.toFixed(1) + 'sb';
      d.appendChild(ctx);
      d.onclick = () => PSApp.goto(r.step);
      body.appendChild(d);
    });
  }

  function init() {
    build();
    PSApp.onRender(() => {
      const h = PSApp.hand();
      if (!h) return;
      if (lastHand && h.id !== lastHand) { last = null; lastHand = null; const b = $('#svBody'); if (b) b.innerHTML = ''; }
      refreshHeader();
    });
  }

  global.PSSolverUI = { init, run };
})(window);
