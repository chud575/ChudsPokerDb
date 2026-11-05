/* ===========================================================================
   mistakeui.js — the Mistake rate screen.  The grading is in mistakes.js; this
   file only presents it.
   =========================================================================== */
(function (global) {
  'use strict';
  const $ = s => document.querySelector(s);
  const el = (t, c, x) => { const e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; };
  const SUIT = { c: '♣', d: '♦', h: '♥', s: '♠' };
  const pc1 = v => (v * 100).toFixed(1) + '%';
  const fmt = n => n.toLocaleString();
  const plural = (n, a, b) => fmt(n) + ' ' + (n === 1 ? a : b);
  const KEY = 'psreplayer.mistakes';
  const M = () => global.PSMistakes;

  const st = { game: '', min: 30, who: '', find: '' };
  try { Object.assign(st, JSON.parse(localStorage.getItem(KEY)) || {}); } catch (e) { }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) { } };

  let hands = [], ticket = 0, running = false, stopNow = false, status = '';

  /* ---------- the list ---------- */
  function fillGames() {
    const n = {};
    for (const x of M().seats(hands)) {
      const g = n[x.h.game.key] || (n[x.h.game.key] = { label: x.h.game.label, n: 0, open: !M().closed(x.h) });
      g.n++;
      g.open = g.open || !M().closed(x.h);
    }
    const keys = Object.keys(n).filter(k => n[k].open).sort((a, b) => n[b].n - n[a].n);
    const s = $('#miGame');
    s.innerHTML = '';
    const add = (v, t) => { const o = el('option', null, t); o.value = v; s.appendChild(o); };
    add('', 'All games');
    keys.forEach(k => add(k, n[k].label));
    if (st.game && !n[st.game]) st.game = '';
    s.value = st.game;
    $('#miMin').value = String(st.min);
  }

  const fieldText = p => p.field == null ? '—' : ((p.own - p.field) * 100 >= 0 ? '+' : '') + ((p.own - p.field) * 100).toFixed(1);

  function list(T) {
    const box = $('#miList');
    box.innerHTML = '';
    const q = st.find.toLowerCase();
    const shown = T.players.filter(p => M().graded(p) >= st.min && (!q || p.name.toLowerCase().includes(q)))
      .sort((a, b) => b.rate - a.rate);
    if (!shown.length) {
      box.appendChild(el('div', 'empty', T.players.some(p => M().graded(p)) ? 'Nobody here has ' + st.min + ' graded decisions.' : 'Nothing graded yet.'));
      return;
    }
    const t = el('table', 'tbl stats miTbl');
    const head = t.createTHead().insertRow();
    [['Player', ''], ['Rate', 'Share of graded decisions that were mistakes'], ['vs field', 'Points above (+) or below (−) the other players on the same games and streets'],
      ['Graded', 'Graded decisions'], ['Big', 'Mistakes the solver makes under 5% of the time']].forEach(([x, why]) => { const th = el('th', null, x); if (why) th.title = why; head.appendChild(th); });
    const rows = t.createTBody();
    for (const p of shown) {
      const tr = rows.insertRow();
      tr.className = (p.name === st.who ? 'on ' : '') + (mine.has(p.name) ? 'me' : '');
      tr.onclick = () => { st.who = p.name; save(); render(); };
      tr.insertCell().textContent = p.name;
      tr.insertCell().textContent = pc1(p.rate);
      const f = tr.insertCell();
      f.textContent = fieldText(p);
      f.className = p.field == null ? '' : p.own > p.field ? 'dn' : 'up';
      tr.insertCell().textContent = fmt(M().graded(p));
      tr.insertCell().textContent = fmt(p.big);
    }
    box.appendChild(global.PSTourneys ? PSTourneys.sortable(t) : t);
  }

  /* ---------- running the solver over the library ---------- */
  async function start() {
    if (running) { stopNow = true; return; }
    running = true; stopNow = false;
    const btn = $('#miRun'), tok = ++ticket;
    btn.textContent = 'Stop';
    status = 'Checking the solvers…';
    showStatus();
    let shownAt = 0, res;
    try {
      res = await M().run(hands, (i, n) => {
        status = 'Grading… ' + fmt(i) + ' of ' + fmt(n) + ' seen hands (' + Math.round(i / n * 100) + '%). You can leave this screen open and keep using the app.';
        showStatus();
        if (Date.now() - shownAt > 4000) { shownAt = Date.now(); if (tok === ticket) renderTable(); }
      }, () => stopNow);
    } catch (e) { status = 'Grading stopped: ' + e.message; }
    running = false;
    if (res) status = outcome(res);
    render();
  }

  function outcome(r) {
    const bits = [plural(r.done, 'seen hand', 'seen hands') + ' graded.'];
    if (r.down.includes('stud')) bits.push('The HORSE+ solver is not answering at ' + PSSolver.url() + ', so stud and flop games were left. Start it, or set its address on the replayer’s Solver tab.');
    if (r.down.includes('draw')) bits.push('The draw solver is not answering at ' + PSDrawSolver.url() + ', so draw games were left.');
    if (r.gaveUp) bits.push('The solver stopped answering partway, so this run ended early.');
    else if (r.failed) bits.push(plural(r.failed, 'hand', 'hands') + ' failed and will be asked again next time.');
    if (r.left) bits.push(fmt(r.left) + ' still to do.');
    return bits.join(' ');
  }

  function showStatus() { const b = $('#miStatus'); if (b) b.textContent = status; }

  /* ---------- one player ---------- */
  function cardsEl(cards) {
    const w = el('span', 'lkCards');
    (cards || []).forEach(c => w.appendChild(el('span', 'cd su-' + c[1], c[0] + SUIT[c[1]])));
    return w;
  }

  function openHand(r) {
    PSApp.replaceHands(r.h.raw, 'from mistake rate');
    PSHome.show('replayer');
    setTimeout(() => { PSApp.openById(r.h.id); if (r.s != null) PSApp.goto(r.s); }, 40);
  }

  function breakdown(box, rows) {
    const games = {};
    for (const r of rows) {
      if (r.g === 'n') continue;
      const g = games[r.h.game.key] || (games[r.h.game.key] = { label: r.h.game.label, all: M().fresh(), by: {}, order: [] });
      M().add(g.all, r);
      if (!g.by[r.t]) { g.by[r.t] = M().fresh(); g.order.push(r.t); }
      M().add(g.by[r.t], r);
    }
    const keys = Object.keys(games).sort((a, b) => M().graded(games[b].all) - M().graded(games[a].all));
    if (!keys.length) return;
    box.appendChild(el('h4', 'sec', 'By game and street'));
    const t = el('table', 'tbl stats tdTbl miDetailTbl');
    const hr = t.createTHead().insertRow();
    ['', 'Graded', 'Mistakes', 'Rate', 'Big'].forEach(x => hr.appendChild(el('th', null, x)));
    const body = t.createTBody();
    const row = (name, c, cls) => {
      const tr = body.insertRow();
      if (cls) tr.className = cls;
      [name, fmt(M().graded(c)), M().misses(c), pc1(M().rate(c)), c.big].forEach(v => { tr.insertCell().textContent = v; });
    };
    for (const k of keys) {
      const g = games[k];
      row(g.label, g.all, 'game');
      g.order.forEach(s => row(s, g.by[s], 'street'));
    }
    box.appendChild(t);
  }

  function leaks(box, rows) {
    const bad = rows.filter(r => r.g === 'i' || r.g === 'x');
    if (!bad.length) return;
    const n = {};
    for (const r of bad) { const k = M().leakOf(r); n[k] = (n[k] || 0) + 1; }
    box.appendChild(el('h4', 'sec', 'What the mistakes were'));
    const t = el('table', 'tbl stats tdTbl miDetailTbl');
    const hr = t.createTHead().insertRow();
    ['', 'Times', 'Share'].forEach(x => hr.appendChild(el('th', null, x)));
    const body = t.createTBody();
    Object.keys(n).sort((a, b) => n[b] - n[a]).forEach(k => {
      const tr = body.insertRow();
      [k, n[k], Math.round(n[k] / bad.length * 100) + '%'].forEach(v => { tr.insertCell().textContent = v; });
    });
    box.appendChild(t);
  }

  function worst(box, rows) {
    const bad = rows.filter(r => r.g === 'i' || r.g === 'x')
      .sort((a, b) => (a.p == null ? 1 : a.p) - (b.p == null ? 1 : b.p));
    const top = bad.slice(0, 50);
    if (!top.length) return;
    box.appendChild(el('h4', 'sec', 'The hands, biggest mistakes first' + (bad.length > top.length ? ' (' + top.length + ' of ' + fmt(bad.length) + ')' : '')));
    const t = el('table', 'tbl stats tdTbl lkHands miDetailTbl');
    const hr = t.createTHead().insertRow();
    ['When', 'Game', 'Street', 'Cards', 'Played', 'Solver', 'It plays that'].forEach(x => hr.appendChild(el('th', null, x)));
    const body = t.createTBody();
    for (const r of top) {
      const tr = body.insertRow();
      tr.title = (r.m || '') + (r.m ? ' — ' : '') + 'Open this hand at this moment';
      tr.onclick = () => openHand(r);
      tr.insertCell().textContent = r.h.dateObj ? r.h.dateObj.toLocaleDateString() : '';
      tr.insertCell().textContent = r.h.game.label;
      tr.insertCell().textContent = r.t;
      tr.insertCell().appendChild(cardsEl(r.c));
      tr.insertCell().textContent = r.a;
      tr.insertCell().textContent = r.say;
      tr.insertCell().textContent = r.p == null ? '—' : pc1(r.p);
    }
    box.appendChild(t);
  }

  function player(T) {
    const box = $('#miOne');
    box.innerHTML = '';
    const p = T.players.find(x => x.name === st.who);
    if (!p) return;
    box.appendChild(el('h3', 'miName', p.name));
    const k = el('div', 'trKpis');
    const kpi = (v, label, cl) => { const d = el('div', 'kpi ' + (cl || '')); d.appendChild(el('b', null, String(v))); d.appendChild(el('small', null, label)); k.appendChild(d); };
    const n = M().graded(p);
    if (n) {
      kpi(pc1(p.rate) + ' ±' + (M().margin(p.rate, n) * 100).toFixed(1), 'mistake rate');
      if (p.field != null) kpi(pc1(p.own) + ' vs ' + pc1(p.field), 'against the field, same games and streets');
      kpi(fmt(n), 'decisions graded');
      kpi(fmt(M().misses(p)), 'mistakes');
      kpi(fmt(p.big), 'big mistakes');
    }
    kpi(fmt(p.hands), 'hands seen');
    box.appendChild(k);
    if (n && n < 100) box.appendChild(el('p', 'tdNote warn', 'Only ' + n + ' decisions. The ± is how far this could be from the player’s true rate, so read it as a rough guess.'));
    const rows = M().rowsOf(hands, p.name, st.game);
    breakdown(box, rows);
    leaks(box, rows);
    worst(box, rows);
    const reasons = Object.keys(p.why).sort((a, b) => p.why[b] - p.why[a]);
    if (reasons.length) box.appendChild(el('p', 'tdNote', 'Not graded: ' + reasons.map(w => fmt(p.why[w]) + ' — ' + w).join('; ') + '.'));
  }

  function howToRead(box) {
    box.appendChild(el('h4', 'sec', 'How to read this'));
    [
      'Every hand where a player’s whole hand was exposed is put back to each decision they made and read from their seat, with only what they could see. A mistake is a play that is not the solver’s top play and that it makes under 25% of the time. A big mistake is one it makes under 5%. In multiway stud, a play that fits the read against some villains and not others counts as half.',
      'These are shown hands only. A player who gets to showdown has not folded that hand, and a bluff that works is never turned over. So this catches calling too much and missed value or raises, but it cannot see folding too much. Rates only mean something next to each other, which is what vs field is for: the other players on the same games and streets.',
      'In draw games your own hands are graded from the deal, because the history holds your cards, and everyone else’s only from their last draw. So the plain rate is not a fair match there. Vs field is: it uses only the decisions both sides have, which is why a player’s two rates can differ.',
      'The solver judges what the player could see, not how the cards fell, and it knows nothing of stack depth, payouts or bounties. No-limit and pot-limit hands, and games without a solver, are not graded. Draw hands are graded from a player’s last draw onward, because what they held before it is gone. Stud from a site that does not print the upcards cannot be graded.',
    ].forEach(t => box.appendChild(el('p', 'tdNote', t)));
  }

  /* ---------- the screen ---------- */
  let mine = new Set();
  function renderTable() {
    const T = M().table(hands, st.game);
    const box = $('#miSum');
    box.innerHTML = '';
    const k = el('div', 'trKpis');
    const kpi = (v, label) => { const d = el('div', 'kpi'); d.appendChild(el('b', null, String(v))); d.appendChild(el('small', null, label)); k.appendChild(d); };
    if (M().graded(T.all)) { kpi(pc1(M().rate(T.all)), 'field mistake rate'); kpi(fmt(M().graded(T.all)), 'decisions graded'); }
    kpi(fmt(T.shown), 'hands seen, one per player');
    if (T.waiting) kpi(fmt(T.waiting), 'waiting to be graded');
    box.appendChild(k);
    const b = $('#miRun');
    b.textContent = running ? 'Stop' : 'Grade ' + fmt(T.waiting) + ' hands';
    b.style.display = running || T.waiting ? '' : 'none';
    // regrade: ask the solver again about hands already graded, e.g. after a brain is retrained
    const again = $('#miRedo'), can = running ? 0 : M().regradable(hands, st.game);
    again.textContent = 'Regrade ' + (st.game ? gameLabel(st.game) : 'all games');
    again.title = 'Ask the solver again about the ' + fmt(can) + ' graded hands' + (st.game ? ' in ' + gameLabel(st.game) : '') + '. Their grades stay until each is redone.';
    again.style.display = can ? '' : 'none';
    list(T);
    return T;
  }

  const gameLabel = k => { const o = [...$('#miGame').options].find(o => o.value === k); return o ? o.textContent : k; };
  async function regradeNow() {
    if (running) return;
    const n = M().regradable(hands, st.game), what = st.game ? gameLabel(st.game) : 'every game';
    if (!n || !confirm('Regrade ' + fmt(n) + ' graded hands in ' + what + '?\n\nThe solver is asked about each one again. Their current grades stay until each hand is redone, so you can stop at any time.')) return;
    await M().regrade(hands, st.game);
    start();
  }

  async function render() {
    if (!global.PSMistakes) return;
    const tok = ++ticket, one = $('#miOne');
    let lib;
    try { lib = await PSHome.library(); }
    catch (e) { $('#miList').textContent = 'The library could not be read here.'; return; }
    if (tok !== ticket) return;
    hands = lib.hands;
    await M().load(hands);
    if (tok !== ticket) return;
    mine = new Set(hands.map(h => h.hero).filter(Boolean));
    fillGames();
    if (!st.who) st.who = PSHome.hero && mine.has(PSHome.hero) ? PSHome.hero : '';
    const T = renderTable();
    showStatus();
    player(T);
    if (!T.players.length) one.appendChild(el('div', 'empty', 'Import some hands into the Library first.'));
    howToRead(one);
  }

  function init() {
    $('#miRun').onclick = start;
    $('#miRedo').onclick = regradeNow;
    $('#miGame').onchange = e => { st.game = e.target.value; save(); render(); };
    $('#miMin').onchange = e => { st.min = +e.target.value; save(); render(); };
    $('#miFind').oninput = e => { st.find = e.target.value.trim(); renderTable(); };
  }

  global.PSMistakeUI = { init, render };
})(window);
