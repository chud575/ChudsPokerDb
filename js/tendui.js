/* ===========================================================================
   tendui.js — the % Tendencies screen, and the one-line read in the replayer.
   The measuring is in tendency.js; this file only presents it.
   =========================================================================== */
(function (global) {
  'use strict';
  const $ = s => document.querySelector(s);
  const el = (t, c, x) => { const e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; };
  const SUIT = { c: '♣', d: '♦', h: '♥', s: '♠' };
  const pc = v => Math.round(v * 100) + '%';
  const plural = (n, a, b) => n + ' ' + (n === 1 ? a : b);
  const KEY = 'psreplayer.tendency';
  const T = () => global.PSTendency;

  const st = { player: '', game: '', line: 'checkraise', street: 'before', vs: '' };
  try { Object.assign(st, JSON.parse(localStorage.getItem(KEY)) || {}); } catch (e) { }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) { } };

  /* every decision in the library, rebuilt only when the library changes */
  let all = null, allFor = null, ticket = 0;
  async function decisions(onProgress) {
    const lib = await PSHome.library();
    if (lib.hands !== allFor) { all = await T().decisions(lib.hands, onProgress); allFor = lib.hands; }
    return all;
  }

  const LAST = { stud: '7th street', flop: 'the river' };
  const streetName = s => /^\d/.test(s) ? s + ' street' : s === 'preflop' ? 'Preflop' : s[0].toUpperCase() + s.slice(1);
  function streetPhrase(s, fam) {
    if (s === 'before') return 'before ' + LAST[fam];
    if (s === 'all') return 'on any street';
    return s === 'preflop' ? 'preflop' : /^\d/.test(s) ? 'on ' + s + ' street' : 'on the ' + s;
  }
  const lineOf = id => T().LINES.find(l => l.id === id);
  const label = id => T().BUCKETS.find(b => b.id === id).label;

  function cardsEl(cards) {
    const w = el('span', 'lkCards');
    (cards || []).forEach(c => w.appendChild(el('span', 'cd su-' + c[1], c === '?' ? '?' : c[0] + SUIT[c[1]])));
    return w;
  }

  /* ---------- the pull-downs ---------- */
  function fillHead() {
    const count = {}, games = {};
    for (const d of all) count[d.player] = (count[d.player] || 0) + 1;
    const names = Object.keys(count).sort((a, b) => count[b] - count[a]);
    if (!st.player || !count[st.player]) st.player = (PSHome.hero && count[PSHome.hero]) ? PSHome.hero : names[0] || '';
    const dl = $('#tdNames');
    dl.innerHTML = '';
    names.forEach(n => { const o = el('option'); o.value = n; dl.appendChild(o); });
    $('#tdWho').value = st.player;
    $('#tdVs').value = st.vs;

    for (const d of all) if (d.player === st.player) {
      const g = games[d.h.game.key] || (games[d.h.game.key] = { n: 0, label: d.h.game.label, fam: d.h.game.fam });
      g.n++;
    }
    const keys = Object.keys(games).sort((a, b) => games[b].n - games[a].n);
    if (!games[st.game]) st.game = games.stud8 ? 'stud8' : keys[0] || '';
    const gs = $('#tdGame');
    gs.innerHTML = '';
    keys.forEach(k => { const o = el('option', null, games[k].label); o.value = k; gs.appendChild(o); });
    gs.value = st.game;

    const fam = games[st.game] ? games[st.game].fam : 'stud';
    const ss = $('#tdStreet');
    ss.innerHTML = '';
    const add = (v, t) => { const o = el('option', null, t); o.value = v; ss.appendChild(o); };
    add('before', 'Before ' + LAST[fam]);
    T().STREETS[fam].forEach(s => add(s, streetName(s)));
    add('all', 'Any street');
    if (st.street !== 'before' && st.street !== 'all' && !T().STREETS[fam].includes(st.street)) st.street = 'before';
    ss.value = st.street;

    const ls = $('#tdLine');
    if (!ls.options.length) T().LINES.forEach(l => { const o = el('option', null, l.label); o.value = l.id; ls.appendChild(o); });
    ls.value = st.line;
    return fam;
  }

  /* ---------- the read ---------- */
  function bar(est) {
    const b = el('div', 'tdBar');
    b.setAttribute('role', 'img');
    b.setAttribute('aria-label', T().BUCKETS.map(x => label(x.id) + ' ' + pc(est[x.id])).join(', '));
    for (const x of T().BUCKETS) {
      if (est[x.id] <= 0) continue;
      const s = el('span', 'tdB ' + x.id, est[x.id] >= 0.09 ? pc(est[x.id]) : '');
      s.style.width = (est[x.id] * 100) + '%';
      b.appendChild(s);
    }
    return b;
  }
  function legend(est) {
    const w = el('div', 'tdKey');
    for (const x of T().BUCKETS) {
      const k = el('span', 'tdK');
      k.appendChild(el('i', 'tdB ' + x.id));
      k.appendChild(el('span', null, x.label + ' '));
      k.appendChild(el('b', null, pc(est[x.id])));
      w.appendChild(k);
    }
    return w;
  }
  function cell(tr, t, n) {
    const c = tr.insertCell();
    c.textContent = n.n ? t : '—';
    return c;
  }
  function compare(q, who) {
    const t = el('table', 'tbl stats tdTbl');
    const head = t.createTHead().insertRow();
    ['', 'Shown'].concat(T().BUCKETS.map(b => b.label)).forEach(x => head.appendChild(el('th', null, x)));
    const rows = t.createTBody();
    const row = (name, c) => {
      const tr = rows.insertRow();
      tr.insertCell().textContent = name;
      tr.insertCell().textContent = c.n;
      for (const b of T().BUCKETS) cell(tr, c[b.id] + ' · ' + pc(c[b.id] / (c.n || 1)), c);
    };
    row(who, q.mine);
    row('Everyone', q.pool);
    return t;
  }

  function sampleNote(q, who) {
    const k = T().POOL_WEIGHT;
    if (!q.mine.n && !q.pool.n) return '';
    if (!q.mine.n) return who + ' has no shown hands here, so this is everyone’s average and says nothing about ' + who + ' in particular.';
    if (!q.pool.n) return 'Only ' + who + '’s own ' + plural(q.mine.n, 'hand', 'hands') + ': nobody else has shown this line.';
    if (q.mine.n < k) return 'Only ' + plural(q.mine.n, 'shown hand', 'shown hands') + ' of ' + who + '’s, so this leans mostly on the ' + q.pool.n + ' from everyone. Treat it as a rough guess.';
    return 'From ' + q.mine.n + ' of ' + who + '’s shown hands, with everyone’s ' + q.pool.n + ' counted as ' + k + ' more.';
  }

  function unseenNote(q, who) {
    const u = q.unseen;
    if (!u.n) return q.mine.n ? el('p', 'tdNote', 'Every one of these hands was seen, so no bluffs are hiding here.') : null;
    const bits = [];
    if (u.uncalled) bits.push(plural(u.uncalled, 'time', 'times') + ' everyone folded');
    if (u.folded) bits.push(u.folded + ' ' + (u.folded === 1 ? 'time' : 'times') + ' ' + who + ' folded later');
    if (u.mucked) bits.push(u.mucked + ' mucked at showdown');
    const p = el('p', 'tdNote warn');
    p.textContent = 'Not in these numbers: ' + bits.join(', ') + '. Those cards were never seen, and a bluff that works never is. If all ' +
      plural(u.n, 'hand', 'hands') + ' were bluffs, the true bluff rate would be ' + pc(q.bluffMax) + ', so read it as ' +
      pc(q.mine.n ? q.mine.bluff / (q.mine.n + u.n) : 0) + ' to ' + pc(q.bluffMax) + '.';
    return p;
  }

  /* one row per line, so a thin spot shows what the wider sample says */
  async function everyLine(box, who, tok) {
    const t = el('table', 'tbl stats tdTbl');
    const head = t.createTHead().insertRow();
    ['Line', 'Shown', 'Not seen'].concat(T().BUCKETS.map(b => b.label)).forEach(x => head.appendChild(el('th', null, x)));
    box.appendChild(el('h4', 'sec', who + ' ' + streetPhrase(st.street, famNow()) + ', every line'));
    box.appendChild(t);
    const rows = t.createTBody();
    for (const l of T().LINES) {
      const q = await T().query(all, Object.assign({}, st, { line: l.id }));
      if (tok !== ticket) return;
      const tr = rows.insertRow();
      tr.className = 'tdPick' + (l.id === st.line ? ' on' : '');
      tr.onclick = () => { st.line = l.id; save(); render(); };
      tr.insertCell().textContent = l.label;
      tr.insertCell().textContent = q.mine.n;
      tr.insertCell().textContent = q.unseen.n;
      for (const b of T().BUCKETS) cell(tr, pc(q.mine[b.id] / (q.mine.n || 1)), q.mine);
    }
  }
  const famNow = () => { const d = all.find(x => x.h.game.key === st.game); return d ? d.h.game.fam : 'stud'; };

  function openHand(d, view) {
    PSApp.replaceHands(d.h.raw, 'from % tendencies');
    PSHome.show('replayer');
    setTimeout(() => { PSApp.openById(d.h.id); if (view) PSApp.goto(view.step); }, 40);
  }

  function examples(box, q) {
    const list = q.list.filter(d => d.read).sort((a, b) => a.eq - b.eq).slice(0, 40);
    if (!list.length) return;
    const fam = list[0].h.game.fam;
    box.appendChild(el('h4', 'sec', 'The shown hands, weakest first' + (q.mine.n > list.length ? ' (' + list.length + ' of ' + q.mine.n + ')' : '')));
    const t = el('table', 'tbl stats tdTbl lkHands');
    const head = t.createTHead().insertRow();
    ['When', 'Street', 'Line', 'Their cards', fam === 'stud' ? 'Others showing' : 'Board', 'Equity', 'Ahead now', 'Read'].forEach(x => head.appendChild(el('th', null, x)));
    const rows = t.createTBody();
    let steps = null, stepsFor = null;
    for (const d of list) {
      if (stepsFor !== d.h) { steps = T().stepsOf(d.h); stepsFor = d.h; }
      const v = T().seatView(d, steps);
      if (!v) continue;
      const tr = rows.insertRow();
      tr.title = 'Open this hand at this moment';
      tr.onclick = () => openHand(d, v);
      tr.insertCell().textContent = d.h.dateObj ? d.h.dateObj.toLocaleDateString() : '';
      tr.insertCell().textContent = streetName(d.street);
      tr.insertCell().textContent = lineOf(d.line).label;
      const c = tr.insertCell();
      if (fam === 'stud') { c.appendChild(cardsEl(v.cards.slice(0, 2))); c.appendChild(document.createTextNode('| ')); c.appendChild(cardsEl(v.cards.slice(2))); }
      else c.appendChild(cardsEl(v.cards));
      const o = tr.insertCell();
      if (fam === 'stud') v.opps.forEach((x, i) => { if (i) o.appendChild(document.createTextNode('/ ')); o.appendChild(cardsEl(x.up)); });
      else o.appendChild(cardsEl(v.boardCards));
      tr.insertCell().textContent = pc(d.eq);
      tr.insertCell().textContent = d.noDraw ? '—' : pc(d.now);
      const r = tr.insertCell();
      r.appendChild(el('span', 'tdTag ' + d.read, label(d.read)));
    }
    box.appendChild(global.PSTourneys ? PSTourneys.sortable(t) : t);
  }

  function howToRead(box) {
    const p = el('p', 'tdNote');
    const m = T();
    p.textContent = 'How a hand is read: its cards at that moment against what the others were showing, with their hidden cards random. Equity is the share of the pot ' +
      'it would win with the rest of the cards to come, scaled so 50% is a fair share however many are in. Ahead now is the same, if no more cards came. ' +
      'Very strong: equity ' + pc(m.STRONG) + ' or more, which includes the biggest draws. Bluff: equity under ' + pc(m.BLUFF) + '. In between, ahead now under ' + pc(m.MADE) +
      ' is a semi-bluff and anything else is medium. On the last street and preflop there is nothing to draw to, so there are no semi-bluffs.';
    box.appendChild(p);
  }

  async function render() {
    if (!global.PSTendency) return;
    const tok = ++ticket, body = $('#tdBody');
    body.innerHTML = '';
    const wait = el('div', 'empty', 'Reading the library…');
    body.appendChild(wait);
    const prog = (i, n) => { if (tok === ticket) wait.textContent = 'Reading the library… ' + Math.round(i / n * 100) + '%'; };
    try { await decisions(prog); }
    catch (e) { wait.textContent = 'The library could not be read here.'; return; }
    if (tok !== ticket) return;
    if (!all.length) { wait.textContent = 'Import some hands into the Library first.'; return; }
    const fam = fillHead();
    const who = st.player, line = lineOf(st.line);
    const q = await T().query(all, st, null, (i, n) => { if (tok === ticket) wait.textContent = 'Reading ' + n + ' hands… ' + Math.round(i / n * 100) + '%'; });
    if (tok !== ticket) return;
    body.innerHTML = '';

    const game = $('#tdGame').selectedOptions[0];
    body.appendChild(el('div', 'lkWho', 'When ' + who + ' ' + line.verb + ' ' + streetPhrase(st.street, fam) +
      ' in ' + (game ? game.textContent : '') + (st.vs ? ' against ' + st.vs : '') + ':'));
    if (q.est) {
      body.appendChild(bar(q.est));
      body.appendChild(legend(q.est));
      body.appendChild(el('p', 'tdNote', sampleNote(q, who)));
    } else body.appendChild(el('p', 'tdNote', 'Nobody has shown a hand on this line yet.'));
    const un = unseenNote(q, who);
    if (un) body.appendChild(un);
    if (q.mine.n || q.pool.n) body.appendChild(compare(q, who));
    await everyLine(body, who, tok);
    if (tok !== ticket) return;
    examples(body, q);
    howToRead(body);
  }

  /* ---------- the same read, one line, while a hand replays ---------- */
  let replayTok = 0;
  async function replayRead() {
    const box = $('#tendRead');
    if (!box) return;
    const tok = ++replayTok;
    const h = PSApp.hand(), step = h && PSApp.stepsOf()[PSApp.step()];
    box.textContent = '';
    box.onclick = null;
    if (!step || !global.PSTendency) return;
    const d = T().decisionsOf(h).find(x => x.ei === step.ei);
    if (!d || !T().AGGR[d.line]) return;
    const f = { player: d.player, game: h.game.key, line: d.line, street: d.last ? d.street : 'before' };
    let q;
    try { await decisions(); q = await T().query(all, f, h.id); } catch (e) { return; }
    if (tok !== replayTok || !q.est || q.mine.n + q.pool.n < 3) return;
    box.textContent = T().BUCKETS.map(b => pc(q.est[b.id]) + ' ' + label(b.id).toLowerCase()).join(' · ') +
      ' (' + q.mine.n + ' of theirs, ' + q.pool.n + ' from everyone' + (q.unseen.n ? ', ' + q.unseen.n + ' never seen' : '') + ') ›';
    box.title = 'What this line has meant in shown hands. This hand is left out. Click for the full read.';
    box.onclick = () => { Object.assign(st, f, { vs: '' }); save(); PSHome.show('tend'); };
  }

  function init() {
    const rerun = fn => e => { fn(e.target.value); save(); render(); };
    $('#tdWho').onchange = rerun(v => { if (all && all.some(d => d.player === v)) st.player = v; });
    $('#tdVs').onchange = rerun(v => { st.vs = v.trim(); });
    $('#tdGame').onchange = rerun(v => { st.game = v; });
    $('#tdLine').onchange = rerun(v => { st.line = v; });
    $('#tdStreet').onchange = rerun(v => { st.street = v; });
    if (global.PSApp) PSApp.onRender(replayRead);
  }

  global.PSTendUI = { init, render };
})(window);
