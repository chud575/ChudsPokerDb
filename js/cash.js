/* ===========================================================================
   cash.js — cash sessions.

   A tournament comes with a summary; a cash game comes with nothing but its
   hands, so the sessions are worked out here.  A session is one sitting: your
   hands in time order, across every table you had open, until you stop for
   longer than the gap.  Nothing is stored — the hands are the authority, so a
   new import changes the sessions on its own.
   =========================================================================== */
(function (global) {
  'use strict';
  const $ = s => document.querySelector(s);
  const el = (t, c, x) => { const e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; };

  const KEY = 'psreplayer.cash';
  const GAPS = [[15, '15 minutes'], [30, '30 minutes'], [60, '1 hour'], [120, '2 hours']];
  const RANGES = [['all', 'All time'], ['7', 'Last 7 days'], ['30', 'Last 30 days'], ['90', 'Last 90 days'], ['365', 'Last 12 months']];
  const NOFLT = { game: '', stake: '', range: 'all' };

  let opt = Object.assign({ who: '', gap: 30, unit: '' }, NOFLT);
  try { Object.assign(opt, JSON.parse(localStorage.getItem(KEY)) || {}); } catch (e) { }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(opt)); } catch (e) { } };
  const fltOn = () => Object.keys(NOFLT).some(k => opt[k] !== NOFLT[k]);

  let built = null, builtOf = null, builtGap = 0;   // every session, and the library and gap they came from
  let list = [];            // the chosen account's sessions in the chosen money
  let shown = [];           // those, with the filters applied, newest first
  let current = null;       // open session id, or null for the overview
  let pick = null;          // a hand the replayer asked to see the session of

  /* ---------- money ---------- */
  // chips and real money never add up, so every session is in one or the other
  function unitOf(h) {
    const m = /\b([A-Z]{3})\b/.exec(h.stakes || '');
    if (m) return m[1];
    return /\$/.test(h.stakes) ? 'USD' : /€/.test(h.stakes) ? 'EUR' : /£/.test(h.stakes) ? 'GBP' : 'chips';
  }
  const M = (v, u) => u === 'chips' ? (v < 0 ? '−' : '') + Math.round(Math.abs(v)).toLocaleString() + ' chips' : PSTSum.money(v, u);
  const plus = (v, u) => (v > 0 ? '+' : '') + M(v, u);
  const cls = v => v > 0 ? 'up' : v < 0 ? 'dn' : '';
  const stakeOf = h => (h.stakes || '').replace(/\s*[A-Z]{3}$/, '').replace(/\.00\b/g, '');
  const bbOf = h => h.bb || h.sb || 1;
  const perHour = (v, mins) => mins >= 1 ? v / (mins / 60) : null;
  const per100 = s => s.n ? 100 * s.bb / s.n : 0;
  function dur(mins) {
    const m = Math.round(mins);
    return m < 60 ? m + 'm' : Math.floor(m / 60) + 'h ' + (m % 60 ? m % 60 + 'm' : '');
  }
  const day = ms => new Date(ms).toLocaleDateString();
  const clock = ms => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  // your result in a hand
  const netMemo = new WeakMap();
  function net(h) {
    if (!netMemo.has(h)) netMemo.set(h, PSEngine.netFor(h)[h.hero] || 0);
    return netMemo.get(h);
  }

  /* ---------- sessions ---------- */
  function summarize(hs) {
    const a = hs[0], z = hs[hs.length - 1];
    const s = { id: a.id, who: a.hero, site: a.site, unit: unitOf(a), hs: hs, n: hs.length, first: +a.dateObj, last: +z.dateObj, net: 0, bb: 0 };
    hs.forEach(h => { s.net += net(h); s.bb += net(h) / bbOf(h); });
    s.mins = (s.last - s.first) / 6e4;
    return s;
  }

  function sessions(hands, gapMins) {
    const groups = {};
    hands.forEach(h => {
      if (h.tourney || !h.hero || !h.dateObj) return;
      const k = [h.hero, h.site, unitOf(h)].join('|');
      (groups[k] = groups[k] || []).push(h);
    });
    const out = [], gap = gapMins * 6e4;
    for (const k in groups) {
      let cur = null;
      groups[k].sort((a, b) => a.dateObj - b.dateObj).forEach(h => {
        if (!cur || h.dateObj - cur[cur.length - 1].dateObj > gap) out.push(cur = []);
        cur.push(h);
      });
    }
    return out.map(summarize).sort((a, b) => b.first - a.first);
  }

  // group hands by something and add them up, most-played first
  function tally(hs, keyOf) {
    const out = {};
    hs.forEach(h => {
      const k = keyOf(h), t = out[k] || (out[k] = { key: k, n: 0, net: 0, bb: 0 });
      t.n++; t.net += net(h); t.bb += net(h) / bbOf(h);
    });
    return Object.values(out).sort((a, b) => b.n - a.n);
  }
  const labelOf = s => {
    const tb = tally(s.hs, h => h.table);
    return tb[0].key + (tb.length > 1 ? ' +' + (tb.length - 1) : '');
  };
  const gamesOf = s => {
    const g = tally(s.hs, h => h.mixed || h.game.label);
    return g[0].key + (g.length > 1 ? ' +' + (g.length - 1) : '');
  };

  /* the part of a session the filters keep: a Razz filter shows the Razz in it */
  function viewOf(s) {
    if (!opt.game && !opt.stake) return s;
    const hs = s.hs.filter(h => (!opt.game || h.game.label === opt.game) && (!opt.stake || stakeOf(h) === opt.stake));
    return hs.length ? Object.assign(summarize(hs), { id: s.id }) : null;
  }
  function inRange(s) {
    if (opt.range === 'all') return true;
    const now = new Date();
    return s.first >= new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - (+opt.range - 1) * 864e5;
  }

  async function load() {
    const lib = await PSHome.library();
    if (!built || builtOf !== lib || builtGap !== +opt.gap) {
      built = sessions(lib.hands, +opt.gap);
      builtOf = lib; builtGap = +opt.gap;
    }
    if (pick) {                          // from the replayer: make sure the session it wants can be seen
      const s = built.find(x => x.hs.some(h => h.id === pick));
      if (s) {
        opt.who = s.who; opt.unit = s.unit; Object.assign(opt, NOFLT); current = s.id;
        save();
      }
      pick = null;
    }
    const counts = {};
    built.forEach(s => { counts[s.who] = (counts[s.who] || 0) + s.n; });
    if (!(opt.who in counts)) opt.who = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || '';
    const mine = built.filter(s => s.who === opt.who);
    const units = tally(mine.flatMap(s => s.hs), unitOf).map(t => t.key);
    if (!units.includes(opt.unit)) opt.unit = units[0] || '';
    list = mine.filter(s => s.unit === opt.unit);
    shown = list.filter(inRange).map(viewOf).filter(Boolean);
    const sel = $('#caAcct');
    sel.innerHTML = '';
    Object.keys(counts).sort((a, b) => counts[b] - counts[a]).forEach(n => {
      const c = built.filter(s => s.who === n).length;
      sel.appendChild(new Option(n + ' — ' + c + ' session' + (c === 1 ? '' : 's'), n));
    });
    sel.value = opt.who;
    return units;
  }

  async function render() {
    if (!PSHome.libOk) { $('#caList').innerHTML = '<div class="empty warn">The library is unavailable here.</div>'; return; }
    $('#caDetail').innerHTML = '<div class="dim trNote">reading the hands…</div>';
    const units = await load();
    renderList();
    if (current && list.some(s => s.id === current)) open(current); else overview(units);
  }

  /* ---------- the list ---------- */
  function renderList() {
    const box = $('#caList');
    box.innerHTML = '';
    if (!built.length) { box.appendChild(el('div', 'empty', 'No cash hands in the library yet.')); return; }
    const ov = el('div', 'toRow ov');
    ov.appendChild(el('b', null, 'Overview'));
    ov.appendChild(el('span', 'dim', shown.length + (shown.length === list.length ? '' : ' of ' + list.length) + ' sessions'));
    ov.onclick = () => overview();
    box.appendChild(ov);
    const q = ($('#caSearch').value || '').trim().toLowerCase();
    const hit = s => !q || s.hs.some(h => h.table.toLowerCase().includes(q) || h.game.label.toLowerCase().includes(q) ||
      h.seats.some(p => p.name.toLowerCase().includes(q)));
    const rows = shown.filter(hit);
    if (q) box.appendChild(el('div', 'plMeta', rows.length + ' match' + (rows.length === 1 ? '' : 'es') + ' (table, game or a player in it)'));
    rows.forEach(s => {
      const row = el('div', 'toRow');
      row.dataset.id = s.id;
      const top = el('div', 'l1');
      top.appendChild(el('b', null, labelOf(s)));
      const fin = el('span', 'fin');
      fin.appendChild(el('span', cls(s.net), plus(s.net, s.unit)));
      top.appendChild(fin);
      row.appendChild(top);
      row.appendChild(el('div', 'l2', [day(s.first), s.mins >= 1 ? dur(s.mins) : '', s.n + ' hand' + (s.n === 1 ? '' : 's'), gamesOf(s)].filter(Boolean).join(' · ')));
      row.onclick = () => open(s.id);
      box.appendChild(row);
    });
    markSel();
  }
  const markSel = () => document.querySelectorAll('#caList .toRow').forEach(r => {
    const on = current ? r.dataset.id === current : r.classList.contains('ov');
    r.classList.toggle('sel', on);
    if (on && current) r.scrollIntoView({ block: 'nearest' });
  });

  /* ---------- filters ---------- */
  function set(k, v) {
    opt[k] = v; save();
    current = null;
    render();
  }
  function filterBar(units) {
    const bar = el('div', 'fltBar');
    const pool = list.flatMap(s => s.hs);
    const pickFrom = (label, k, none, rows) => {
      const w = el('label', 'fld');
      w.appendChild(el('span', null, label));
      const s = document.createElement('select');
      if (none) s.appendChild(new Option(none, ''));
      rows.forEach(r => s.appendChild(new Option(r[1], r[0])));
      s.value = opt[k];
      s.onchange = () => set(k, k === 'gap' ? +s.value : s.value);
      w.appendChild(s);
      bar.appendChild(w);
      return w;
    };
    pickFrom('Game', 'game', 'All games (' + pool.length.toLocaleString() + ')', tally(pool, h => h.game.label).map(t => [t.key, t.key + ' (' + t.n.toLocaleString() + ')']));
    pickFrom('Stakes', 'stake', 'All stakes', tally(pool, stakeOf).map(t => [t.key, t.key + ' (' + t.n.toLocaleString() + ')']));
    pickFrom('When', 'range', '', RANGES);
    pickFrom('A session ends after a break of', 'gap', '', GAPS).title = 'Hands closer together than this, at any of your tables, are the same sitting';
    if (units && units.length > 1) pickFrom('Money', 'unit', '', units.map(u => [u, u === 'chips' ? 'Play chips' : u]));
    if (fltOn()) {
      const c = el('button', 'btn', 'Clear filters');
      c.onclick = () => { Object.assign(opt, NOFLT); save(); current = null; render(); };
      bar.appendChild(c);
    }
    return bar;
  }

  /* ---------- pieces ---------- */
  function kpis(pane, rows) {
    const k = el('div', 'trKpis');
    rows.forEach(r => {
      if (!r) return;
      const d = el('div', 'kpi ' + (r[2] || ''));
      d.appendChild(el('b', null, r[1]));
      d.appendChild(el('small', null, r[0]));
      if (r[3]) d.title = r[3];
      k.appendChild(d);
    });
    pane.appendChild(k);
  }

  function table(pane, title, cols, rows, netCol, click) {
    if (title) pane.appendChild(el('h4', 'sec', title));
    const t = el('table', 'tbl stats');
    const hr = t.insertRow();
    cols.forEach(c => { const th = document.createElement('th'); th.textContent = c; hr.appendChild(th); });
    rows.forEach(row => {
      const r = t.insertRow();
      row.cells.forEach((v, i) => {
        const c = r.insertCell();
        c.textContent = v;
        if (i === netCol) c.className = cls(row.v);
      });
      if (row.me) r.className = 'me';
      if (click) { r.style.cursor = 'pointer'; r.onclick = () => click(row); }
    });
    pane.appendChild(PSTourneys.sortable(t));
  }
  const groupRows = (hs, keyOf, u) => tally(hs, keyOf).map(t => ({ key: t.key, v: t.net,
    cells: [t.key, t.n.toLocaleString(), M(t.net, u), (100 * t.bb / t.n).toFixed(1)] }));

  /* running total — one line, so the title names it and there is no legend */
  function netChart(pane, title, pts, unit, onPick) {
    if (pts.length < 2) return;
    const W = 920, H = 230, L = 72, R = 16, T = 12, B = 24, COL = '#3987e5';
    const ys = pts.map(p => p.y).concat(0), lo = Math.min(...ys), hi = Math.max(...ys), span = hi - lo || 1;
    const x = i => L + (W - L - R) * i / (pts.length - 1), y = v => T + (H - T - B) * (hi - v) / span;
    const wrap = el('div', 'lkChart');
    wrap.appendChild(el('h4', 'sec', title));
    const NS = 'http://www.w3.org/2000/svg', svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H); svg.setAttribute('class', 'lkSvg'); svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', title + ': ended at ' + M(pts[pts.length - 1].y, unit));
    const mk = (tag, a, text) => { const n = document.createElementNS(NS, tag); for (const k in a) n.setAttribute(k, a[k]); if (text != null) n.textContent = text; svg.appendChild(n); return n; };
    const pow = Math.pow(10, Math.floor(Math.log10(span))), step = [0.2, 0.5, 1, 2, 5].map(m => m * pow).find(s => span / s <= 5) || pow * 10;
    for (let v = Math.ceil(lo / step) * step; v <= hi + step / 1e3; v += step) {
      const z = Math.abs(v) < step / 1e3;
      mk('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: z ? 'zero' : 'grid' });
      mk('text', { x: L - 6, y: y(v) + 3.5, class: 'tick', 'text-anchor': 'end' }, M(z ? 0 : v, unit).replace(/\.00$/, ''));
    }
    mk('text', { x: L, y: H - 6, class: 'tick' }, pts[0].from);
    mk('text', { x: W - R, y: H - 6, class: 'tick', 'text-anchor': 'end' }, pts[pts.length - 1].from);
    mk('path', { d: pts.map((p, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(p.y).toFixed(1)).join(' '), fill: 'none', stroke: COL, 'stroke-width': 2, 'stroke-linejoin': 'round' });
    const cross = mk('line', { y1: T, y2: H - B, class: 'cross', visibility: 'hidden' });
    const dot = mk('circle', { r: 4, fill: COL, class: 'ring', visibility: 'hidden' });
    const tip = el('div', 'lkTip');
    const hit = mk('rect', { x: L, y: T, width: W - L - R, height: H - T - B, fill: 'transparent' });
    const at = ev => {
      const b = svg.getBoundingClientRect();
      return Math.max(0, Math.min(pts.length - 1, Math.round(((ev.clientX - b.left) * W / b.width - L) / (W - L - R) * (pts.length - 1))));
    };
    hit.addEventListener('mousemove', ev => {
      const i = at(ev), p = pts[i], b = svg.getBoundingClientRect();
      [cross, dot].forEach(n => n.setAttribute('visibility', 'visible'));
      cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); dot.setAttribute('cx', x(i)); dot.setAttribute('cy', y(p.y));
      tip.innerHTML = '';
      tip.appendChild(el('b', null, p.title));
      p.lines.forEach(l => tip.appendChild(el('div', null, l)));
      tip.style.display = 'block';
      tip.style.left = Math.min(b.width - 250, Math.max(0, x(i) / W * b.width + 12)) + 'px'; tip.style.top = '30px';
    });
    hit.addEventListener('mouseleave', () => { [cross, dot].forEach(n => n.setAttribute('visibility', 'hidden')); tip.style.display = 'none'; });
    if (onPick) { hit.style.cursor = 'pointer'; hit.addEventListener('click', ev => onPick(pts[at(ev)])); }
    const holder = el('div', 'lkSvgWrap'); holder.appendChild(svg); holder.appendChild(tip);
    wrap.appendChild(holder);
    pane.appendChild(wrap);
  }

  /* ---------- every session ---------- */
  function overview(units) {
    current = null; markSel();
    const pane = $('#caDetail');
    pane.innerHTML = '';
    pane.scrollTop = 0;
    pane.appendChild(el('h3', null, 'Cash sessions — ' + (opt.who || 'no cash hands')));
    if (!built.length) {
      pane.appendChild(el('div', 'empty', 'No cash hands in the library yet. Import a hand history (Library → Import files) and each sitting shows up here.'));
      return;
    }
    pane.appendChild(filterBar(units || tally(built.filter(s => s.who === opt.who).flatMap(s => s.hs), unitOf).map(t => t.key)));
    if (!shown.length) { pane.appendChild(el('div', 'empty', 'No sessions match these filters.')); return; }
    const u = opt.unit, hs = shown.flatMap(s => s.hs);
    const n = shown.reduce((a, s) => a + s.n, 0), v = shown.reduce((a, s) => a + s.net, 0), bb = shown.reduce((a, s) => a + s.bb, 0);
    const mins = shown.reduce((a, s) => a + s.mins, 0), wins = shown.filter(s => s.net > 0).length;
    const old = shown[shown.length - 1], rate = perHour(v, mins);
    pane.appendChild(el('div', 'dim trNote', shown.length + ' sessions, ' + day(old.first) + ' – ' + day(shown[0].last) +
      ' · a new one starts after a break of more than ' + GAPS.find(g => g[0] === +opt.gap)[1] + ' · click one on the left to open it'));
    kpis(pane, [
      ['net', plus(v, u), cls(v)],
      ['sessions won', wins + ' of ' + shown.length + ' (' + Math.round(100 * wins / shown.length) + '%)'],
      ['hands', n.toLocaleString()],
      ['BB / 100 hands', (100 * bb / n).toFixed(1), cls(bb), 'Each hand counted in its own big blind (the big bet, in limit games)'],
      !opt.game && !opt.stake ? ['time at the tables', dur(mins)] : null,
      !opt.game && !opt.stake && rate != null ? ['an hour', plus(rate, u), cls(rate), 'Net over the time from first hand to last in each session'] : null,
    ]);
    let run = 0;
    const pts = shown.slice().reverse().map((s, i) => {
      run += s.net;
      return { id: s.id, y: run, from: day(s.first), title: labelOf(s) + ' · ' + day(s.first), lines: [s.n + ' hands · ' + plus(s.net, u), 'running total ' + M(run, u)] };
    });
    netChart(pane, 'Running total, session by session', pts, u, p => open(p.id));
    table(pane, 'By game', ['Game', 'Hands', 'Net', 'BB / 100'], groupRows(hs, h => h.game.label, u), 2, r => { opt.game = r.key; save(); render(); });
    table(pane, 'By stakes', ['Stakes', 'Hands', 'Net', 'BB / 100'], groupRows(hs, stakeOf, u), 2, r => { opt.stake = r.key; save(); render(); });
    table(pane, 'By table', ['Table', 'Hands', 'Net', 'BB / 100'], groupRows(hs, h => h.table, u), 2, r => { $('#caSearch').value = r.key; renderList(); });
  }

  /* ---------- one session ---------- */
  function replay(s, id) {
    PSApp.replaceHands(s.hs.map(h => h.raw).join('\n\n'), 'cash session');
    PSHome.show('replayer');
    if (id) setTimeout(() => PSApp.openById(id), 40);
  }

  function open(id) {
    const s = shown.find(x => x.id === id) || list.find(x => x.id === id);
    if (!s) return;
    current = id; markSel();
    const u = s.unit, pane = $('#caDetail');
    pane.innerHTML = '';
    pane.scrollTop = 0;
    const bar = el('div', 'toBar');
    const rb = el('button', 'btn primary', '▶ Replay the hands');
    rb.title = 'Load this session’s hands into the replayer';
    rb.onclick = () => replay(s);
    bar.appendChild(rb);
    pane.appendChild(bar);

    pane.appendChild(el('h3', null, labelOf(s) + ' · ' + gamesOf(s)));
    const stakes = tally(s.hs, stakeOf).map(t => t.key);
    pane.appendChild(el('div', 'dim trNote', [day(s.first) + ', ' + clock(s.first) + ' – ' + clock(s.last), stakes.join(', '), s.site].join(' · ')));
    let vpip = 0, opps = 0, pots = 0;
    s.hs.forEach(h => { const r = PSStats.rowsFor(h)[s.who]; if (r) { vpip += r.vpip; opps += r.vpipOpp ? 1 : 0; pots += r.won; } });
    const nets = s.hs.map(net), best = Math.max(...nets), worst = Math.min(...nets), rate = perHour(s.net, s.mins);
    const whole = s.n === (list.find(x => x.id === id) || s).n;
    kpis(pane, [
      ['net', plus(s.net, u), cls(s.net)],
      whole && rate != null ? ['an hour', plus(rate, u), cls(rate)] : null,
      ['BB / 100 hands', per100(s).toFixed(1), cls(s.bb), 'Each hand counted in its own big blind (the big bet, in limit games)'],
      ['hands', s.n.toLocaleString()],
      s.mins >= 1 ? ['time', dur(s.mins)] : null,
      opps ? ['played', Math.round(100 * vpip / opps) + '%', '', 'Hands where you put money in by choice on the first round'] : null,
      ['pots won', String(pots)],
      best > 0 ? ['biggest win', plus(best, u), 'up'] : null,
      worst < 0 ? ['biggest loss', M(worst, u), 'dn'] : null,
    ]);

    let run = 0;
    netChart(pane, 'Running total, hand by hand', s.hs.map((h, i) => {
      run += net(h);
      return { id: h.id, y: run, from: clock(+h.dateObj), title: 'Hand ' + (i + 1) + ' · ' + clock(+h.dateObj), lines: [h.game.label + ' · ' + h.table, 'this hand ' + plus(net(h), u) + ' · running total ' + M(run, u)] };
    }), u, p => replay(s, p.id));

    const tb = tally(s.hs, h => h.table), gm = tally(s.hs, h => h.game.label);
    if (tb.length > 1) table(pane, 'By table', ['Table', 'Hands', 'Net', 'BB / 100'], groupRows(s.hs, h => h.table, u), 2);
    if (gm.length > 1) table(pane, 'By game', ['Game', 'Hands', 'Net', 'BB / 100'], groupRows(s.hs, h => h.game.label, u), 2);

    // who else was there, and how they did in the hands you shared
    const seen = {};
    s.hs.forEach(h => {
      const m = PSEngine.netFor(h);
      h.seats.forEach(p => {
        const t = seen[p.name] || (seen[p.name] = { n: 0, v: 0 });
        t.n++;
        t.v += p.name === s.who ? net(h) : (m[p.name] || 0);
      });
    });
    table(pane, 'At your tables', ['Player', 'Hands', 'Net'],
      Object.keys(seen).sort((a, b) => seen[b].n - seen[a].n || seen[b].v - seen[a].v).map(n => ({
        key: n, v: seen[n].v, me: n === s.who, cells: [n + (n === s.who ? '  (you)' : ''), seen[n].n, M(seen[n].v, u)],
      })), 2, r => { PSHome.show('players'); PSHome.openPlayer(r.key); });

    table(pane, 'Every hand', ['#', 'Time', 'Game', 'Table', 'Dealt', 'Pot', 'You'], s.hs.map((h, i) => {
      const d = h.events.find(e => e.t === 'deal' && e.player === s.who);
      return { id: h.id, v: net(h), cells: [i + 1, clock(+h.dateObj), h.game.label, h.table, d ? d.all.join(' ') : '', M(h.totalPot, u), plus(net(h), u)] };
    }), 6, r => replay(s, r.id));
  }

  /* for the replayer's pull-down: newest first, whichever account */
  async function allSessions() {
    await load();
    return built;
  }
  async function replayById(id) {
    await load();
    const s = built.find(x => x.id === id);
    if (s) replay(s);
  }

  function init() {
    $('#caSearch').oninput = () => renderList();
    $('#caAcct').onchange = e => { opt.who = e.target.value; opt.unit = ''; Object.assign(opt, NOFLT); save(); current = null; render(); };
  }

  global.PSCash = {
    init, render, allSessions, replayById, labelOf, gamesOf, plus,
    sessions, unitOf, stakeOf, net, showHand: id => { pick = id; },
  };
})(window);
