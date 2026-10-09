/* ===========================================================================
   tourneys.js — the Tournament Overview.

   Every tournament from the imported "Tournament History" summaries, listed on
   the left; on the right either the overview of your record (default) or one
   tournament laid out the way the PokerStars email prints it — the header
   lines, every entry's place / country / payout, and your own "You …" lines.
   Player names open that player's record in the Player database.
   =========================================================================== */
(function (global) {
  'use strict';
  const $ = s => document.querySelector(s);
  const el = (t, c, x) => { const e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; };

  let all = [];             // every stored summary, newest first
  let list = [];            // the ones the chosen account played
  let acct = '';            // whose tournaments these are
  let acctCounts = {};      // account -> tournaments it appears in
  let handTids = new Set(); // tournaments with hand histories in the library
  let current = null;       // open tournament id, or null for the overview
  let rawMode = false;

  const ACCT_KEY = 'psreplayer.tourneyAccount';
  const FLT_KEY = 'psreplayer.tourneyFilter';

  /* ---------- filters: one set, shared by the overview and the list ---------- */
  const NOFLT = { game: '', range: 'all', from: '', to: '', minBuy: '', maxBuy: '', type: '', result: '', multOn: false, multMin: '0', multMax: '', minEntOn: false, minEnt: 5 };
  // minimum entries thins the opponents table, not the tournaments
  const TOUR_KEYS = ['game', 'range', 'from', 'to', 'minBuy', 'maxBuy', 'type', 'result', 'multOn', 'multMin', 'multMax'];
  const tourFltOn = () => TOUR_KEYS.some(k => flt[k] !== NOFLT[k]);
  let flt = Object.assign({}, NOFLT);
  try { Object.assign(flt, JSON.parse(localStorage.getItem(FLT_KEY)) || {}); } catch (e) { }
  if (flt.single) { flt.multOn = true; flt.multMin = '0'; flt.multMax = '1'; }   // the old "single entry" box
  delete flt.single;
  const saveFlt = () => { try { localStorage.setItem(FLT_KEY, JSON.stringify(flt)); } catch (e) { } };
  const fltOn = () => Object.keys(NOFLT).some(k => flt[k] !== NOFLT[k]);

  const FAMS = [
    ['mixed', 'Mixed games', /HORSE|8-Game|Mixed|TORSE|HOSE|Triple Stud|Dealer|Choice|\bH\.?O\.?R/i],
    ['draw', 'Draw games', /Draw|Badugi|Badacey|Badeucey/i],
    ['stud', 'Stud games', /Stud|Razz/i],
    ['omaha', 'Omaha games', /Omaha|Courchevel/i],
    ['holdem', 'Hold’em', /Hold.?em/i],
  ];
  const famOf = ev => (FAMS.find(f => f[2].test(ev)) || [''])[0];
  const gameOk = (ev, g) => !g || (g.startsWith('fam:') ? famOf(ev) === g.slice(4) : ev === g);

  const RANGES = [['all', 'All time'], ['7', 'Last 7 days'], ['30', 'Last 30 days'], ['90', 'Last 90 days'],
    ['365', 'Last 12 months'], ['month', 'This month'], ['year', 'This year'], ['custom', 'Custom dates']];
  function dateWindow() {
    const now = new Date();
    if (flt.range === 'all') return [-Infinity, Infinity];
    if (flt.range === 'custom') {
      const d = s => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
      const f = d(flt.from), t = d(flt.to);
      return [f ? f.getTime() : -Infinity, t ? t.getTime() + 864e5 - 1 : Infinity];
    }
    if (flt.range === 'month') return [new Date(now.getFullYear(), now.getMonth(), 1).getTime(), Infinity];
    if (flt.range === 'year') return [new Date(now.getFullYear(), 0, 1).getTime(), Infinity];
    const day0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    return [day0 - (+flt.range - 1) * 864e5, Infinity];
  }
  const buyOk = v => (flt.minBuy === '' || v >= +flt.minBuy) && (flt.maxBuy === '' || v <= +flt.maxBuy);

  // your outcome in one tournament: cashed / stone / soft / busted
  function outcome(t) {
    const mine = youIn(t);
    if (!mine.length) return '';
    if (mine.some(r => r.amount > 0 || r.qualified)) return 'cashed';
    return bubbleOf(t, Math.min(...mine.map(r => r.place))) || 'busted';
  }

  /* Cost of entry, in buy-ins: everything you paid to get into a tournament —
     satellites and re-entries together — divided by one buy-in.
       1x     bought in once (or a satellite path that cost exactly that)
       0.1x   a seat won in a cheap satellite, no re-entry
       1.1x   that seat, busted, then one bought re-entry
       3x     three bullets
     The filter keeps tournaments whose cost falls in a range of that; the
     satellites that fed such a tournament come along, so their cost still counts. */
  const multOf = c => c.main && c.face ? c.cost / c.face : null;
  function multOk(c) {
    const x = multOf(c);
    if (x == null) return false;                       // satellites whose target you never played
    const lo = flt.multMin === '' ? 0 : +flt.multMin, hi = flt.multMax === '' ? Infinity : +flt.multMax;
    return x >= lo - 0.0005 && x <= hi + 0.0005;
  }
  let multSet = null, multKey = '';
  function multIds() {
    const key = acct + '|' + flt.multMin + '|' + flt.multMax;
    if (multSet && multKey === key) return multSet;
    multSet = new Set(); multKey = key;
    const perf = PSHome.perfCache();
    if (perf && perf[acct]) PSTSum.campaigns(perf[acct]).filter(multOk).forEach(c => {
      multSet.add(c.main.tid);
      c.sats.forEach(l => multSet.add(l.ev.tid));
    });
    return multSet;
  }

  function passes(t) {
    if (flt.multOn && !multIds().has(t.id)) return false;
    if (!gameOk(t.event, flt.game)) return false;
    const [a, b] = dateWindow(), when = t.start || t.end;
    if (when < a || when > b) return false;
    if (!buyOk(t.buyin ? t.buyin.total : 0)) return false;
    if (flt.type === 'main' && t.satellite) return false;
    if (flt.type === 'sat' && !t.satellite) return false;
    if (flt.result) {
      const o = outcome(t);
      if (flt.result === 'cashed' && o !== 'cashed') return false;
      if (flt.result === 'missed' && o === 'cashed') return false;
      if (flt.result === 'bubble' && o !== 'stone' && o !== 'soft') return false;
    }
    return true;
  }
  // satellite groups follow their target tournament's game, date and price
  function campaignOk(c) {
    if (flt.multOn && !multOk(c)) return false;
    if (!gameOk(c.event, flt.game)) return false;
    const [a, b] = dateWindow();
    return c.date >= a && c.date <= b && buyOk(c.face);
  }
  const plays = (t, n) => t.synthetic ? t.hero.name === n : t.results.some(r => r.name === n);

  async function load() {
    await PSHome.ensurePerf();
    // real summaries, plus play-money tournaments rebuilt from the hand histories
    all = (await PSDB.allSummaries()).concat(await PSHome.playTourneys())
      .sort((a, b) => (b.start || b.end) - (a.start || a.end));
    handTids = new Set((await PSDB.allTourneys()).map(t => t.id));
    const chops = await PSHome.getChops();
    all.forEach(t => { if (chops[t.id]) PSTSum.applyChop(t, chops[t.id]); });
    // your accounts: whoever requested a history, plus the heroes of your hand histories
    const names = new Set(PSHome.accounts);
    all.forEach(t => { if (t.hero && t.hero.name) names.add(t.hero.name); });
    Object.keys(await PSDB.heroes()).forEach(n => names.add(n));
    acctCounts = {};
    names.forEach(n => { acctCounts[n] = all.filter(t => plays(t, n)).length; });
    if (!acct) { try { acct = localStorage.getItem(ACCT_KEY) || ''; } catch (e) { } }
    if (!(acct in acctCounts)) acct = Object.keys(acctCounts).sort((a, b) => acctCounts[b] - acctCounts[a])[0] || '';
    list = all.filter(t => plays(t, acct));
    multSet = null;
    const sel = $('#toAcct');
    sel.innerHTML = '';
    Object.keys(acctCounts).sort((a, b) => acctCounts[b] - acctCounts[a] || a.localeCompare(b)).forEach(n =>
      sel.appendChild(new Option(n + ' — ' + acctCounts[n] + ' tournament' + (acctCounts[n] === 1 ? '' : 's'), n)));
    sel.value = acct;
  }

  async function setAccount(n) {
    acct = n;
    try { localStorage.setItem(ACCT_KEY, n); } catch (e) { }
    current = null;
    await render();
  }

  const youIn = t => t.results.filter(r => r.name === acct);
  /* ---------- click a column heading to sort by it ----------
     Works on the rendered table: rows are moved, not rebuilt, so their click
     handlers survive.  Money, percentages, places ("22nd"), entry tags ("[3]")
     and dates sort as numbers; blanks and dashes always sink to the bottom. */
  function cellKey(txt) {
    const t = (txt || '').trim().replace(/−/g, '-');
    if (!t || t === '—' || t === '-') return null;
    let m;
    if ((m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) return new Date(+m[3], +m[1] - 1, +m[2]).getTime();
    if ((m = t.match(/^\[?([+-]?)\$?(\d[\d,]*(?:\.\d+)?)/))) return (m[1] === '-' ? -1 : 1) * parseFloat(m[2].replace(/,/g, ''));
    return t.toLowerCase();
  }
  function sortable(tbl) {
    const head = tbl.rows[0];
    if (!head) return tbl;
    tbl.classList.add('sortable');
    [...head.cells].forEach((th, col) => {
      if (!th.textContent.trim() && col > 0) return;          // action columns
      th.title = 'Sort by ' + (th.textContent.trim() || 'place');
      th.onclick = () => {
        const rows = [...tbl.rows].slice(1);
        const keyed = rows.map((r, i) => {
          const txt = r.cells[col] ? r.cells[col].textContent : '';
          return { r: r, i: i, k: cellKey(txt), txt: txt.trim().toLowerCase() };
        });
        // a column is numeric only if most of it is — "1MTM91" and "8-Game" are names
        const filled = keyed.filter(x => x.k !== null);
        const numeric = filled.filter(x => typeof x.k === 'number').length * 2 > filled.length;
        keyed.forEach(x => { if (x.k !== null) x.k = numeric ? (typeof x.k === 'number' ? x.k : null) : x.txt; });
        const cmp = dir => (a, b) => {
          if (a.k === null || b.k === null) return (a.k === null) - (b.k === null) || a.i - b.i;
          const d = numeric ? a.k - b.k : a.k.localeCompare(b.k, undefined, { numeric: true });
          return dir * d || a.i - b.i;
        };
        // numbers start biggest-first, names A–Z, places best-first; a second click (or a column already in that order) flips it
        const lowFirst = !numeric || /^(|best|finish|place|when)$/i.test(th.textContent.trim()) && !/when/i.test(th.textContent);
        let dir = th.dataset.dir ? -th.dataset.dir : (lowFirst ? 1 : -1);
        let out = keyed.slice().sort(cmp(dir));
        if (!th.dataset.dir && out.every((x, i) => x.r === rows[i])) { dir = -dir; out = keyed.slice().sort(cmp(dir)); }
        [...head.cells].forEach(c => { delete c.dataset.dir; c.classList.remove('asc', 'desc'); });
        th.dataset.dir = dir;
        th.classList.add(dir > 0 ? 'asc' : 'desc');
        const body = rows[0] && rows[0].parentNode;
        out.forEach(x => body.appendChild(x.r));
      };
    });
    return tbl;
  }

  const M = (v, t) => PSTSum.money(v, (t && t.buyin && t.buyin.cur) || 'USD');

  async function render() {
    if (!PSHome.libOk) { $('#toList').innerHTML = '<div class="empty warn">The library is unavailable here.</div>'; return; }
    await load();
    // asked to open a tournament another of your accounts played (it was requested
    // before the list had loaded): switch to that account rather than drop the request
    if (current && !list.some(t => t.id === current)) {
      const t0 = all.find(x => x.id === current);
      const other = t0 && Object.keys(acctCounts).find(n => plays(t0, n));
      if (other) {
        acct = other;
        try { localStorage.setItem(ACCT_KEY, other); } catch (e) { }
        list = all.filter(t => plays(t, acct));
        multSet = null;
        $('#toAcct').value = acct;
      }
    }
    renderList();
    if (current && list.some(t => t.id === current)) open(current); else overview();
  }

  function filtered() {
    const q = ($('#toSearch').value || '').trim().toLowerCase();
    return list.filter(t => passes(t) &&
      (!q || t.id.includes(q) || t.event.toLowerCase().includes(q) ||
        t.results.some(r => r.name.toLowerCase().includes(q))));
  }

  function renderList() {
    const box = $('#toList');
    box.innerHTML = '';
    if (!list.length) {
      box.appendChild(el('div', 'empty', !all.length ? 'No tournament results yet.'
        : 'No tournament histories include ' + acct + '. Import a PokerStars “Tournament History” email for that account.'));
      return;
    }
    const ov = el('div', 'toRow ov' + (current ? '' : ' sel'));
    ov.appendChild(el('b', null, 'Overview'));
    ov.appendChild(el('span', 'dim', list.length + ' tournaments'));
    ov.onclick = () => overview();
    box.appendChild(ov);
    if (tourFltOn()) {                   // the overview's filters apply here too
      const fm = el('div', 'plMeta toFltNote');
      fm.appendChild(el('span', null, 'filtered: ' + list.filter(passes).length + ' of ' + list.length));
      const clr = el('a', null, 'clear');
      clr.href = '#';
      clr.onclick = e => { e.preventDefault(); setFilter(Object.assign({}, NOFLT)); };
      fm.appendChild(clr);
      box.appendChild(fm);
    }
    const q = ($('#toSearch').value || '').trim();
    const f = filtered();
    // satellites you played that fed each tournament
    const satsFor = {};
    list.forEach(x => { if (x.target && youIn(x).length) satsFor[x.target.id] = (satsFor[x.target.id] || 0) + 1; });
    if (q) box.appendChild(el('div', 'plMeta', f.length + ' match' + (f.length === 1 ? '' : 'es') +
      (q ? ' (tournament, event or a player in it)' : '')));
    f.forEach(t => {
      const row = el('div', 'toRow' + (t.satellite ? ' sat' : '') + (t.id === current ? ' sel' : ''));
      row.dataset.id = t.id;
      const top = el('div', 'l1');
      top.appendChild(el('b', null, t.event + (t.satellite ? ' · sat' : '')));
      if (t.synthetic || t.playMoney) row.title = 'Play money — scored as a $100 buy-in from the payout chart';
      const mine = youIn(t);
      const got = mine.reduce((a, r) => a + r.amount, 0);
      const q = mine.some(r => r.qualified);
      const best = mine.length ? Math.min(...mine.map(r => r.place)) : null;
      const bub = got || q ? '' : bubbleOf(t, best);
      const fin = el('span', 'fin ' + (got || q ? 'up' : bub),
        best ? PSTSum.ord(best) + (q ? ' · seat' : got ? ' · ' + M(got, t) : '') : (t.synthetic ? 'finish unknown' : ''));
      if (bub) fin.title = bub === 'stone' ? 'Stone bubble — first one out of the money'
        : 'Soft bubble — ' + (best - paidCount(t)) + ' places from the money';
      top.appendChild(fin);
      row.appendChild(top);
      const l2 = el('div', 'l2');
      const fed = satsFor[t.id] || 0;
      l2.textContent = (t.start ? new Date(t.start).toLocaleDateString() : '') + ' · ' +
        (t.buyin ? M(t.buyin.total, t) : '') + (t.synthetic || t.playMoney ? ' play' : '') + ' · ' + t.entries + ' entries' +
        (fed ? ' · +' + fed + ' sat' + (fed === 1 ? '' : 's') : '') + (handTids.has(t.id) ? ' · hands' : '');
      row.appendChild(l2);
      row.onclick = () => open(t.id);
      box.appendChild(row);
    });
  }

  /* the bubble: paid = a prize or a seat.  Stone = first one out; soft = out
     within the next 10% of the paid places (at least the next two; the next
     one when fewer than ten are paid) and still in the top half of the field. */
  const paidCount = t => t.playMoney || t.synthetic ? t.paid : t.results.filter(r => r.amount > 0 || r.qualified).length;
  function bubbleOf(t, place) {
    const paid = paidCount(t);
    if (!place || !paid || place <= paid) return '';
    const past = place - paid;
    if (past === 1) return 'stone';
    // small fields: one more place at most, and never the bottom half of the field
    const reach = Math.max(paid < 10 ? 1 : 2, Math.ceil(paid * 0.1));
    return past <= 1 + reach && place <= Math.ceil(t.entries / 2) ? 'soft' : '';
  }

  const markSel = () => document.querySelectorAll('#toList .toRow').forEach(r => {
    const on = current ? r.dataset.id === current : r.classList.contains('ov');
    r.classList.toggle('sel', on);
    if (on && current) r.scrollIntoView({ block: 'nearest' });
  });

  /* ---------- your record across all of them ---------- */
  function overview() {
    current = null; markSel();
    const pane = $('#toDetail');
    pane.innerHTML = '';
    pane.scrollTop = 0;
    PSHome.ensurePerf().then(db => {
      pane.appendChild(el('h3', null, 'Tournament Overview — ' + (acct || 'no account')));
      if (list.length) pane.appendChild(filterBar());
      const body = el('div', 'ovBody');
      pane.appendChild(body);
      overviewBody(body, db);
    });
  }

  function setFilter(next) {
    flt = next; saveFlt();
    renderList();
    if (!current) {
      const body = document.querySelector('#toDetail .ovBody');
      const bar = document.querySelector('#toDetail .fltBar');
      if (bar) bar.replaceWith(filterBar());
      if (body) { body.innerHTML = ''; overviewBody(body, PSHome.perfCache() || {}); }
    }
  }

  function filterBar() {
    const bar = el('div', 'fltBar');
    const field = (label, ctl) => { const w = el('label', 'fld'); w.appendChild(el('span', null, label)); w.appendChild(ctl); bar.appendChild(w); return ctl; };
    const upd = (k, v) => { const n = Object.assign({}, flt); n[k] = v; setFilter(n); };

    // game: families present, then the exact events, with counts
    const g = document.createElement('select');
    g.appendChild(new Option('All games (' + list.length + ')', ''));
    const evs = {}, fams = {};
    list.forEach(t => { evs[t.event] = (evs[t.event] || 0) + 1; const f = famOf(t.event); if (f) fams[f] = (fams[f] || 0) + 1; });
    const og1 = document.createElement('optgroup'); og1.label = 'Game type';
    FAMS.forEach(f => { if (fams[f[0]]) og1.appendChild(new Option(f[1] + ' (' + fams[f[0]] + ')', 'fam:' + f[0])); });
    g.appendChild(og1);
    const og2 = document.createElement('optgroup'); og2.label = 'Event';
    Object.keys(evs).sort((a, b) => evs[b] - evs[a]).forEach(e => og2.appendChild(new Option(e + ' (' + evs[e] + ')', e)));
    g.appendChild(og2);
    g.value = flt.game;
    g.onchange = () => upd('game', g.value);
    field('Game', g);

    const r = document.createElement('select');
    RANGES.forEach(x => r.appendChild(new Option(x[1], x[0])));
    r.value = flt.range;
    r.onchange = () => upd('range', r.value);
    field('When', r);
    if (flt.range === 'custom') {
      const f = document.createElement('input'); f.type = 'date'; f.value = flt.from;
      f.onchange = () => upd('from', f.value);
      field('From', f);
      const t = document.createElement('input'); t.type = 'date'; t.value = flt.to;
      t.onchange = () => upd('to', t.value);
      field('To', t);
    }

    const mn = document.createElement('input'); mn.type = 'number'; mn.min = 0; mn.step = 'any'; mn.placeholder = 'min'; mn.value = flt.minBuy;
    mn.onchange = () => upd('minBuy', mn.value);
    const mx = document.createElement('input'); mx.type = 'number'; mx.min = 0; mx.step = 'any'; mx.placeholder = 'max'; mx.value = flt.maxBuy;
    mx.onchange = () => upd('maxBuy', mx.value);
    const bw = el('span', 'pair'); bw.appendChild(mn); bw.appendChild(el('i', null, '–')); bw.appendChild(mx);
    field('Buy-in $', bw);

    const ty = document.createElement('select');
    [['', 'Tournaments & satellites'], ['main', 'Tournaments only'], ['sat', 'Satellites only']].forEach(x => ty.appendChild(new Option(x[1], x[0])));
    ty.value = flt.type;
    ty.onchange = () => upd('type', ty.value);
    field('Type', ty);

    const rs = document.createElement('select');
    [['', 'Any result'], ['cashed', 'Cashed / won a seat'], ['missed', 'Out of the money'], ['bubble', 'Bubbles (stone + soft)']].forEach(x => rs.appendChild(new Option(x[1], x[0])));
    rs.value = flt.result;
    rs.onchange = () => upd('result', rs.value);
    field('Result', rs);

    // total cost of entry as a multiple of one buy-in, from–to
    const mo = document.createElement('input'); mo.type = 'checkbox'; mo.checked = !!flt.multOn;
    mo.onchange = () => upd('multOn', mo.checked);
    const lo = document.createElement('input'); lo.type = 'number'; lo.min = 0; lo.step = 0.1; lo.placeholder = '0'; lo.value = flt.multMin;
    lo.disabled = !flt.multOn;
    lo.onchange = () => upd('multMin', lo.value === '' ? '' : String(Math.max(0, +lo.value || 0)));
    const hi = document.createElement('input'); hi.type = 'number'; hi.min = 0; hi.step = 0.1; hi.placeholder = 'max'; hi.value = flt.multMax;
    hi.disabled = !flt.multOn;
    hi.onchange = () => upd('multMax', hi.value === '' ? '' : String(Math.max(0, +hi.value || 0)));
    const mw = el('span', 'pair');
    mw.appendChild(mo); mw.appendChild(lo); mw.appendChild(el('i', null, '–')); mw.appendChild(hi); mw.appendChild(el('i', null, '× buy-in'));
    field('Cost of entry', mw).title = 'Everything you paid to get in — satellites and re-entries — as a multiple of one buy-in. 0–1 is a single entry or a cheap satellite seat; 1.1 is a satellite seat plus one bought re-entry; 3 is three bullets. Leave max empty for no upper limit.';

    // opponents with a real sample: at least this many entries in the tournaments shown
    const me = el('span', 'pair');
    const on = document.createElement('input'); on.type = 'checkbox'; on.checked = !!flt.minEntOn;
    on.onchange = () => upd('minEntOn', on.checked);
    const num = document.createElement('input'); num.type = 'number'; num.min = 1; num.step = 1; num.value = flt.minEnt;
    num.disabled = !flt.minEntOn;
    num.onchange = () => upd('minEnt', Math.max(1, Math.round(+num.value) || 1));
    me.appendChild(on); me.appendChild(num);
    field('Opponents: min entries', me).title = 'Only list opponents with at least this many entries in the tournaments shown';

    if (fltOn()) {
      const c = el('button', 'btn', 'Clear filters');
      c.onclick = () => setFilter(Object.assign({}, NOFLT));
      bar.appendChild(c);
    }
    return bar;
  }

  function overviewBody(pane, db) {
    {
      if (!list.length) {
        pane.appendChild(el('div', 'empty', all.length
          ? 'None of the imported tournament histories include ' + acct + '. Pick another account on the left, or import a history requested by ' + acct + '.'
          : 'Import a PokerStars “Tournament History” email (⭱ Import results) to fill this in.'));
        return;
      }
      const fl = list.filter(passes);
      if (!fl.length) { pane.appendChild(el('div', 'empty', 'No tournaments match these filters.')); return; }
      const first = fl[fl.length - 1], last = fl[0];
      pane.appendChild(el('div', 'dim trNote', (tourFltOn() ? fl.length + ' of ' + list.length : fl.length) + ' tournaments, ' +
        new Date(first.start).toLocaleDateString() + ' – ' + new Date(last.start).toLocaleDateString() +
        ' · click one on the left to see it as PokerStars printed it'));
      // everyone in the tournaments shown — you included — with their record in just those
      const keep = new Set(fl.map(t => t.id));
      const others = Object.keys(acctCounts).filter(n => n !== acct);
      const field = { seen: {}, agg: {}, minEnt: flt.minEntOn ? Math.max(1, +flt.minEnt || 1) : 0 };
      fl.forEach(t => new Set(t.results.map(r => r.name)).forEach(n => {
        if (!others.includes(n)) field.seen[n] = (field.seen[n] || 0) + 1;
      }));
      for (const n in field.seen) {
        const ev = {}, evs = (db[n] && db[n].events) || {};
        for (const id in evs) if (keep.has(id)) ev[id] = evs[id];
        field.agg[n] = PSTSum.aggregate({ events: ev });
      }
      if (db[acct]) {
        const ev = {};
        for (const id in db[acct].events) if (keep.has(id)) ev[id] = db[acct].events[id];
        renderKpis(pane, Object.assign({}, db[acct], { events: ev }), field);
        costBreakdown(pane, db[acct]);
        campaignSection(pane, db[acct], null, campaignOk);
      }
      regulars(pane, db, field);
    }
  }

  /* how the results change with what it cost to get in: every tournament you
     played (satellites folded in), bucketed by cost of entry in buy-ins */
  const COST_BUCKETS = [
    ['up to 1×', 0, 1], ['over 1× to 1.5×', 1, 1.5], ['over 1.5× to 2×', 1.5, 2],
    ['over 2× to 3×', 2, 3], ['over 3× to 4×', 3, 4], ['over 4×', 4, Infinity],
  ];
  function costBreakdown(pane, rec) {
    // game, date and buy-in filters apply; the cost-of-entry one does not, so the whole curve shows
    const saved = flt.multOn; flt.multOn = false;
    const cs = PSTSum.campaigns(rec).filter(c => c.main && campaignOk(c));
    flt.multOn = saved;
    if (!cs.length) return;
    const cur = cs[0].cur, m = v => PSTSum.money(v, cur);
    pane.appendChild(el('h4', 'sec', 'By cost of entry (satellites and re-entries, in buy-ins)'));
    const t = el('table', 'tbl stats');
    const hr = t.insertRow();
    ['Cost of entry', 'Tournaments', 'Avg cost', 'Cashed', 'Spent', 'Won', 'Net', 'ROI'].forEach(h => { const th = document.createElement('th'); th.textContent = h; hr.appendChild(th); });
    COST_BUCKETS.forEach(b => {
      const g = cs.filter(c => { const x = multOf(c); return (b[1] === 0 ? x >= 0 : x > b[1] + 0.0005) && x <= b[2] + 0.0005; });
      if (!g.length) return;
      const spent = g.reduce((a, c) => a + c.cost, 0), won = g.reduce((a, c) => a + c.payout + c.unusedValue, 0), net = won - spent;
      const cashed = g.filter(c => c.main.won + c.main.bounty > 0).length;
      const avg = g.reduce((a, c) => a + multOf(c), 0) / g.length;
      const r = t.insertRow();
      [b[0], g.length, avg.toFixed(2) + '×', cashed + ' (' + Math.round(100 * cashed / g.length) + '%)', m(spent), m(won), m(net),
        spent ? (100 * net / spent).toFixed(0) + '%' : '—']
        .forEach((v, i) => { const c = r.insertCell(); c.textContent = v; if (i === 6) c.className = net > 0 ? 'up' : net < 0 ? 'dn' : ''; });
      r.style.cursor = 'pointer';
      r.title = 'Filter to this range';
      r.onclick = () => setFilter(Object.assign({}, flt, { multOn: true,
        multMin: b[1] === 0 ? '0' : String(Math.round((b[1] + 0.01) * 100) / 100), multMax: b[2] === Infinity ? '' : String(b[2]) }));
    });
    pane.appendChild(sortable(t));
  }

  /* where a value stands among a set of values: 1 = best; ties share a rank */
  const rankOf = (v, vals) => 1 + vals.filter(x => x > v).length;

  function renderKpis(box, rec, field) {
    const a = PSTSum.aggregate(rec);
    const m = v => PSTSum.money(v, a.cur);
    const k = el('div', 'trKpis');
    const kpi = (label, v, cls) => { const d = el('div', 'kpi ' + (cls || '')); d.appendChild(el('b', null, v)); d.appendChild(el('small', null, label)); k.appendChild(d); };
    kpi('tournaments', String(a.tourneys));
    kpi('entries', String(a.entries));
    kpi('cashed', a.cashes + ' (' + (a.itm || 0).toFixed(0) + '%)');
    kpi('wins', String(a.wins));
    if (a.tickets) kpi('satellite seats', String(a.tickets));
    kpi('buy-ins', m(a.cost));
    kpi('won', m(a.won));
    kpi('net', m(a.net), a.net > 0 ? 'up' : a.net < 0 ? 'dn' : '');
    kpi('ROI', a.roi == null ? '—' : a.roi.toFixed(0) + '%', a.roi > 0 ? 'up' : a.roi < 0 ? 'dn' : '');
    box.appendChild(k);
    const bt = el('table', 'tbl stats');
    const hr = bt.insertRow();
    const cols = ['Event', 'Played', 'Entries', 'Cashed', 'Best', 'Buy-ins', 'Won', 'Net', 'ROI'];
    if (field) cols.push('Net rank', 'ROI rank');
    cols.forEach(h => { const th = document.createElement('th'); th.textContent = h; hr.appendChild(th); });
    Object.keys(a.byEvent).sort((x, y) => a.byEvent[y].n - a.byEvent[x].n).forEach(ev => {
      const g = a.byEvent[ev], r = bt.insertRow(), net = g.won - g.cost;
      const cells = [ev, g.n, g.entries, g.cashes + ' (' + Math.round(100 * g.cashes / g.n) + '%)', g.best ? PSTSum.ord(g.best) : '—',
        m(g.cost), m(g.won), m(net), g.cost ? (100 * net / g.cost).toFixed(0) + '%' : '—'];
      if (field) {
        // you against everyone who played this event (with the minimum entries, when that is on)
        const nets = [], rois = [];
        for (const n in field.agg) {
          const o = field.agg[n].byEvent[ev];
          if (!o || (n !== acct && o.entries < field.minEnt)) continue;
          nets.push(o.won - o.cost);
          if (o.cost) rois.push((o.won - o.cost) / o.cost);
        }
        cells.push(rankOf(net, nets) + ' / ' + nets.length, g.cost ? rankOf(net / g.cost, rois) + ' / ' + rois.length : '—');
      }
      cells.forEach((v, i) => { const c = r.insertCell(); c.textContent = v; if (i === 7) c.className = net > 0 ? 'up' : net < 0 ? 'dn' : ''; });
      r.style.cursor = 'pointer';
      r.title = 'Filter to this event';
      r.onclick = () => setFilter(Object.assign({}, flt, { game: ev.replace(/ — satellites$/, ''),
        type: / — satellites$/.test(ev) ? 'sat' : flt.type === 'sat' ? '' : flt.type }));
    });
    box.appendChild(sortable(bt));
  }

  /* everyone in these tournaments, most-met first — you among them */
  function regulars(pane, db, field) {
    const seen = field.seen, minEnt = field.minEnt;
    const names = Object.keys(seen).sort((a, b) => seen[b] - seen[a] || a.localeCompare(b));
    if (!names.length) return;
    const title = el('h4', 'sec', '');
    pane.appendChild(title);
    const find = document.createElement('input');
    find.type = 'search'; find.className = 'oppFind'; find.placeholder = 'find a player or country…';
    pane.appendChild(find);
    const count = el('span', 'dim oppCount', '');
    pane.appendChild(count);
    const t = el('table', 'tbl stats');
    const hr = t.insertRow();
    ['Player', 'Country', 'Shared', 'Entries', 'Cashed', 'Best', 'Buy-ins', 'Won', 'Net', 'ROI', 'Net rank', 'ROI rank'].forEach(h => { const th = document.createElement('th'); th.textContent = h; hr.appendChild(th); });
    // the rows: everyone with enough entries, and you regardless; ranks are among these rows
    const rows = names.filter(n => n === acct || field.agg[n].entries >= minEnt);
    const nets = rows.map(n => field.agg[n].net);
    const rois = rows.filter(n => field.agg[n].roi != null).map(n => field.agg[n].roi);
    rows.forEach(n => {
      const a = field.agg[n];
      const r = t.insertRow();
      [n + (n === acct ? '  (you)' : ''), (db[n] && db[n].country) || '', seen[n], a.entries, a.cashes + ' (' + (a.itm || 0).toFixed(0) + '%)',
        a.best ? PSTSum.ord(a.best) : '—', PSTSum.money(a.cost, a.cur), PSTSum.money(a.won, a.cur),
        PSTSum.money(a.net, a.cur), a.roi == null ? '—' : a.roi.toFixed(0) + '%',
        rankOf(a.net, nets), a.roi == null ? '—' : rankOf(a.roi, rois)]
        .forEach((v, i) => { const c = r.insertCell(); c.textContent = v; if (i === 8) c.className = a.net > 0 ? 'up' : a.net < 0 ? 'dn' : ''; });
      r.cells[0].className = 'pl';
      if (n === acct) r.className = 'me';
      r.style.cursor = 'pointer';
      r.onclick = () => openPlayer(n);
    });
    find.oninput = () => {
      const q = find.value.trim().toLowerCase();
      let shown = 0;
      [...t.rows].slice(1).forEach(r => {
        const on = !q || r.cells[0].textContent.toLowerCase().includes(q) || r.cells[1].textContent.toLowerCase().includes(q);
        r.style.display = on ? '' : 'none';
        if (on) shown++;
      });
      count.textContent = q ? shown.toLocaleString() + ' match' + (shown === 1 ? '' : 'es') : '';
    };
    const opp = names.filter(n => n !== acct).length, shown = rows.filter(n => n !== acct).length;
    title.textContent = 'You and your opponents — ' + (minEnt ? shown.toLocaleString() + ' of ' + opp.toLocaleString() + ' with ' + minEnt + '+ entries'
      : 'all ' + opp.toLocaleString());
    pane.appendChild(sortable(t));
  }

  /* ---------- satellites linked to what they fed ---------- */

  // one campaign: the story line, then every leg (click one to open it)
  function campaignBox(c, opts) {
    opts = opts || {};
    const d = PSTSum.describe(c);
    const M = v => PSTSum.money(Math.round(v * 100) / 100, c.cur).replace(/\.00$/, '');
    const box = el('div', 'cpBox' + (c.net > 0 ? ' up' : ' dn'));
    if (opts.title !== false) {
      const t = el('div', 'cpTtl');
      t.appendChild(el('b', null, c.event));
      t.appendChild(el('span', 'dim', (c.date ? new Date(c.date).toLocaleDateString() + ' · ' : '') + '#' + c.id +
        (c.missing ? ' (not in this history)' : '')));
      box.appendChild(t);
    }
    const f = el('div', 'cpLine');
    f.appendChild(el('span', 'lhs', d.lhs));
    f.appendChild(el('span', 'eq', ' = '));
    f.appendChild(el('span', 'tail', d.tail));
    box.appendChild(f);
    box.appendChild(el('div', 'cpRes', d.result));
    if (opts.legs !== false) {
      const tb = el('table', 'tbl cpLegs');
      const legs = c.sats.concat(c.mainLeg ? [c.mainLeg] : []);
      legs.forEach(l => {
        const e = l.ev, r = tb.insertRow();
        r.insertCell().textContent = e.date ? new Date(e.date).toLocaleDateString() : '';
        r.insertCell().textContent = (l.isMain ? '' : 'Satellite · ') + M(e.buyin) + ' · #' + e.tid;
        r.insertCell().textContent = e.entries + ' entr' + (e.entries === 1 ? 'y' : 'ies') +
          (l.viaTicket ? ' (' + l.viaTicket + ' with a ticket)' : '');
        r.insertCell().textContent = e.tickets ? (e.tickets > 1 ? e.tickets + ' seats' : 'won a seat')
          : PSTSum.ord(e.best) + (e.won + e.bounty ? ' · ' + M(e.won + e.bounty) : '');
        r.insertCell().textContent = l.cash ? '−' + M(l.cash) : '$0';
        if (all.some(t => t.id === e.tid)) {
          r.style.cursor = 'pointer';
          r.onclick = () => { PSHome.show('tourneys'); open(e.tid); };
        }
        if (e.tid === opts.here) r.className = 'here';
      });
      box.appendChild(tb);
    }
    return box;
  }

  // every campaign with a satellite in it, with the totals across them
  function campaignSection(pane, rec, heading, keep) {
    const cs = PSTSum.campaigns(rec).filter(c => c.sats.length && (!keep || keep(c)));
    if (!cs.length) return;
    const cur = cs[0].cur;
    const M = v => PSTSum.money(Math.round(v * 100) / 100, cur);
    pane.appendChild(el('h4', 'sec', heading || 'Satellites, linked to the tournaments they fed'));
    const satEntries = cs.reduce((a, c) => a + c.sats.reduce((x, l) => x + l.ev.entries, 0), 0);
    const satCash = cs.reduce((a, c) => a + c.satCost, 0);
    const seatsUsed = cs.reduce((a, c) => a + (c.mainLeg ? c.mainLeg.viaTicket : 0), 0);
    const seatVal = cs.reduce((a, c) => a + (c.mainLeg ? c.mainLeg.viaTicket * c.mainLeg.ev.buyin : 0), 0);
    const played = cs.filter(c => c.main).length;
    const net = cs.reduce((a, c) => a + c.net, 0);
    pane.appendChild(el('div', 'dim trNote', satEntries + ' satellite entries for ' + M(satCash) + ' across ' + cs.length +
      ' target tournaments · ' + seatsUsed + ' seat' + (seatsUsed === 1 ? '' : 's') + ' used (' + M(seatVal) + ' of buy-ins) · ' +
      played + ' of those targets played here · all of it together: ' + M(net) + ' net'));
    const wrap = el('div', 'cpList');
    cs.forEach(c => wrap.appendChild(campaignBox(c, { legs: false })));
    wrap.querySelectorAll('.cpBox').forEach((b, i) => {
      b.style.cursor = 'pointer';
      b.title = 'Show every leg';
      b.onclick = () => {
        const nb = campaignBox(cs[i]);
        nb.onclick = null;
        b.replaceWith(nb);
      };
    });
    pane.appendChild(wrap);
  }

  /* play money: the hand history never says how many entered, so say what was
     assumed and let it be corrected */
  function entriesEditor(t) {
    const box = el('div', 'pmEdit');
    box.appendChild(el('span', null, 'Entries'));
    const inp = document.createElement('input');
    inp.type = 'number'; inp.min = t.est.floor; inp.max = PSPlay.maxEntries(0); inp.value = t.entries;
    box.appendChild(inp);
    const save = el('button', 'btn', 'Set');
    const apply = async n => { await PSHome.setPlayEntries(t.id, n); await render(); };
    save.onclick = () => {
      const n = Math.round(+inp.value);
      if (!n || n < 2) { PSHome.toast('Enter how many entries the tournament had.', 'bad'); return; }
      if (n < t.est.floor) { PSHome.toast('The hand histories already show ' + t.est.floor + ' players, so it had at least that many.', 'bad'); return; }
      apply(n);
    };
    box.appendChild(save);
    if (t.est.how === 'set by you') {
      const un = el('button', 'btn', 'Back to the estimate');
      un.onclick = () => apply(0);
      box.appendChild(un);
    }
    box.appendChild(el('span', 'dim', t.est.how + ' · the hand history does not record the field size' +
      (t.covered ? '' : ' · the payout chart does not reach ' + t.entries + ' entries, so nothing is paid')));
    return box;
  }

  /* ---------- a chop: who split the prizes, and each one's percentage ---------- */
  function chopDialog(t) {
    const old = document.querySelector('.chopModal');
    if (old) old.remove();
    // the players who could be in a deal: everyone paid, by place — and you
    const official = r => r.official != null ? r.official : r.amount;
    const best = {};
    t.results.forEach(r => { if (official(r) > 0 && (!best[r.name] || official(r) > official(best[r.name]))) best[r.name] = r; });
    const cands = Object.values(best).sort((a, b) => a.place - b.place).slice(0, 12);
    const wrap = el('div', 'modal open chopModal');
    const box = el('div', 'modalBox chopBox');
    box.appendChild(el('h3', null, 'Chop — tournament #' + t.id));
    box.appendChild(el('p', 'dim', cands.length ? 'Tick everyone who was in the deal and give each one’s share of the combined prizes. Fill in yours and the rest is split evenly among the others until you change them.'
      : 'Nobody in this tournament has a prize to split.'));
    const tbl = el('table', 'tbl chopTbl');
    const hr = tbl.insertRow();
    ['In the deal', 'Player', 'Place', 'Listed prize', 'Share %', 'Paid'].forEach(h => { const th = document.createElement('th'); th.textContent = h; hr.appendChild(th); });
    const cur = (t.chop && t.chop.pct) || {};
    const rows = cands.map(r => {
      const tr = tbl.insertRow();
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = cur[r.name] != null;
      tr.insertCell().appendChild(cb);
      tr.insertCell().textContent = r.name + (r.name === acct ? '  (you)' : '');
      tr.insertCell().textContent = PSTSum.ord(r.place);
      tr.insertCell().textContent = M(official(r), t);
      const inp = document.createElement('input'); inp.type = 'number'; inp.min = 0; inp.max = 100; inp.step = 'any'; inp.value = cur[r.name] != null ? cur[r.name] : '';
      inp.disabled = !cb.checked;
      tr.insertCell().appendChild(inp);
      const paid = tr.insertCell();
      if (r.name === acct) tr.className = 'me';
      return { r: r, cb: cb, inp: inp, paid: paid, touched: cur[r.name] != null };
    });
    box.appendChild(tbl);
    const sum = el('div', 'chopSum');
    box.appendChild(sum);
    const btns = el('div', 'modalBtns');
    const cancel = el('button', 'btn', 'Cancel');
    cancel.onclick = () => wrap.remove();
    const save = el('button', 'btn primary', 'Save chop');
    const refresh = from => {
      const inRows = rows.filter(x => x.cb.checked);
      rows.forEach(x => { x.inp.disabled = !x.cb.checked; if (!x.cb.checked) { x.inp.value = ''; x.touched = false; } });
      if (from) from.touched = from.inp.value !== '';
      // whatever has not been typed shares what is left
      const typed = inRows.filter(x => x.touched), free = inRows.filter(x => !x.touched);
      const left = 100 - typed.reduce((a, x) => a + (+x.inp.value || 0), 0);
      if (typed.length) free.forEach(x => { x.inp.value = Math.max(0, Math.round(left / free.length * 100) / 100); });
      const pool = inRows.reduce((a, x) => a + official(x.r), 0);
      const total = inRows.reduce((a, x) => a + (+x.inp.value || 0), 0);
      rows.forEach(x => { x.paid.textContent = x.cb.checked && x.inp.value !== '' ? M(pool * (+x.inp.value) / 100, t) : ''; });
      const ok = inRows.length >= 2 && Math.abs(total - 100) < 0.05 && inRows.every(x => +x.inp.value > 0);
      sum.textContent = inRows.length < 2 ? 'Tick at least two players.'
        : 'Combined prizes ' + M(pool, t) + ' · shares add up to ' + (Math.round(total * 100) / 100) + '%' + (ok ? '' : ' — they need to total 100%');
      sum.className = 'chopSum ' + (ok ? 'okNote' : 'warnNote');
      save.disabled = !ok;
    };
    save.onclick = async () => {
      const pct = {};
      rows.filter(x => x.cb.checked).forEach(x => { pct[x.r.name] = Math.round(+x.inp.value * 100) / 100; });
      await PSHome.setChop(t.id, { pct: pct });
      wrap.remove();
      PSHome.toast('Chop saved — results now use what was actually paid');
      await render();
    };
    btns.appendChild(cancel);
    if (t.chop) {
      const rm = el('button', 'btn', 'Remove chop');
      rm.onclick = async () => { await PSHome.setChop(t.id, null); wrap.remove(); PSHome.toast('Chop removed — back to the listed prizes', 'info'); await render(); };
      btns.appendChild(rm);
    }
    btns.appendChild(save);
    box.appendChild(btns);
    rows.forEach(x => { x.cb.onchange = () => refresh(); x.inp.oninput = () => refresh(x); });
    wrap.appendChild(box);
    wrap.onclick = e => { if (e.target === wrap) wrap.remove(); };
    document.body.appendChild(wrap);
    refresh();
  }

  function campaignOf(name, tid) {
    const perf = PSHome.perfCache();
    return perf && perf[name] && PSTSum.campaigns(perf[name]).find(x =>
      (x.main && x.main.tid === tid) || x.sats.some(l => l.ev.tid === tid));
  }

  function openPlayer(n) {
    PSHome.show('players');
    PSHome.openPlayer(n);
  }

  /* ---------- one tournament, as PokerStars printed it ---------- */
  function open(id) {
    current = id;                       // render() reopens it once the list has loaded
    if (!list.some(x => x.id === id)) {
      const t0 = all.find(x => x.id === id);
      const other = t0 && Object.keys(acctCounts).find(n => n !== acct && plays(t0, n));
      if (other) { setAccount(other).then(() => open(id)); return; }
    }
    const t = all.find(x => x.id === id);
    if (!t) return;
    markSel();
    const pane = $('#toDetail');
    pane.innerHTML = '';
    pane.scrollTop = 0;

    const bar = el('div', 'toBar');
    const tg = el('button', 'btn', rawMode ? 'Table view' : 'Plain text');
    tg.onclick = () => { rawMode = !rawMode; open(id); };
    bar.appendChild(tg);
    // into the replayer — always offered, so it is clear when the hands are simply not imported
    const hb = el('button', 'btn' + (handTids.has(t.id) ? ' primary' : ''), handTids.has(t.id) ? '▶ Replay the hands' : '▶ Replay — no hands imported');
    hb.title = handTids.has(t.id) ? 'Load this tournament’s hands into the replayer' : 'Import this tournament’s hand histories (Library → Import files) to replay it';
    if (!handTids.has(t.id)) hb.classList.add('off');
    hb.onclick = () => PSHome.openTourney(t.id);
    bar.appendChild(hb);
    const chb = el('button', 'btn' + (t.chop ? ' primary' : ''), t.chop ? 'Edit chop' : 'Chop');
    chb.title = 'Record a deal: who split the prizes, and what percentage each took';
    chb.onclick = () => chopDialog(t);
    bar.appendChild(chb);
    const cp = el('button', 'btn', 'Copy');
    cp.onclick = () => { try { navigator.clipboard.writeText(t.raw); PSHome.toast('Copied tournament #' + t.id); } catch (e) { } };
    bar.appendChild(cp);
    pane.appendChild(bar);

    if (rawMode) { pane.appendChild(el('pre', 'toRaw', t.raw)); return; }

    // how you played it and how the cards ran, from the hand histories
    if (global.PSLuckUI) {
      const sum = el('div', 'toSum');
      pane.appendChild(sum);
      if (handTids.has(t.id)) PSLuckUI.tournamentBox(sum, t.id, (t.hero && t.hero.name) || acct).catch(e => { console.warn(e); sum.remove(); });
      else sum.appendChild(el('div', 'dim trNote', 'No hand histories for this tournament in the library — import them to see how you played it and how the cards ran (skill vs luck).'));
    }

    const doc = el('div', 'toDoc');
    const head = el('div', 'toHead');
    // the header exactly as the email printed it: everything above the standings
    const pre = [];
    for (const line of t.raw.split('\n')) {
      if (/^\s*\d+:\s/.test(line) || /^You\b/.test(line)) break;
      if (line.trim()) pre.push(line.trim());
    }
    pre.forEach((x, i) => head.appendChild(el('div', i === 0 ? 'ttl' : t.tags.includes(x) ? 'tag' : null, x)));
    doc.appendChild(head);
    if (t.synthetic) doc.appendChild(entriesEditor(t));
    if (t.chop) {
      const cb = el('div', 'pmEdit');
      cb.appendChild(el('b', null, 'Chop'));
      cb.appendChild(el('span', 'dim', Object.keys(t.chop.pct).map(n => n + ' ' + t.chop.pct[n] + '%').join(' · ') + ' of ' + M(t.chop.pool, t) +
        ' — the standings below show what was actually paid; results and ROI use those amounts'));
      doc.appendChild(cb);
    }
    if (t.playMoney) {
      const sc = el('div', 'pmEdit');
      sc.appendChild(el('b', null, 'Play money — scored by the payout chart'));
      sc.appendChild(el('span', 'dim', t.scoring + ' · PokerStars’ chip amounts are ignored'));
      doc.appendChild(sc);
    }

    // what the header doesn't say outright
    const facts = el('div', 'toFacts');
    const paid = paidCount(t);
    const re = t.entries - t.players;
    const hrs = t.start && t.end ? (t.end - t.start) / 36e5 : 0;
    [t.entries + ' entries' + (re > 0 ? ' (' + re + ' re-entries)' : ''), paid + ' paid',
      hrs ? Math.floor(hrs) + 'h ' + Math.round((hrs % 1) * 60) + 'm' : '',
      t.buyin && t.buyin.bounty ? 'knockout · ' + M(t.buyin.bounty, t) + ' bounty' : '']
      .filter(Boolean).forEach(x => facts.appendChild(el('span', null, x)));
    const mine = youIn(t);
    const me = new Set(mine.map(r => r.name));
    const camps = [...me].map(n => campaignOf(n, t.id)).filter(c => c && c.sats.length);
    if (mine.length) {
      const best = Math.min(...mine.map(r => r.place));
      const got = mine.reduce((a, r) => a + r.amount, 0) + ((t.hero && t.hero.bountyWon) || 0);
      // an entry paid with a satellite seat cost no cash
      const viaTicket = camps.reduce((a, c) => a + (c.main && c.main.tid === t.id ? c.mainLeg.viaTicket : 0), 0);
      const cost = (mine.length - viaTicket) * (t.buyin ? t.buyin.total : 0);
      const q = mine.some(r => r.qualified);
      const ticket = q && t.target ? t.target.buyin.total : 0;
      const net = got + ticket - cost;
      facts.appendChild(el('span', 'you ' + (net > 0 ? 'up' : 'dn'), 'you: ' + PSTSum.ord(best) +
        (q ? ' · won a seat' : '') + ' · ' + mine.length + ' entr' + (mine.length === 1 ? 'y' : 'ies') +
        (viaTicket ? ' (' + viaTicket + ' via satellite)' : '') + ' · net ' + M(net, t)));
    }
    doc.appendChild(facts);

    const tbl = el('table', 'tbl toRes');
    const hr = tbl.insertRow();
    ['', 'Player', 'Entry', 'Country', 'Prize', '% of pool'].forEach(h => { const th = document.createElement('th'); th.textContent = h; hr.appendChild(th); });
    t.results.forEach(r => {
      const row = tbl.insertRow();
      row.className = (me.has(r.name) ? 'me ' : '') + (r.amount > 0 || r.qualified ? 'paid' : '');
      row.insertCell().textContent = r.place + ':';
      const nc = row.insertCell();
      const a = el('a', 'pl', r.name);
      a.href = '#';
      a.onclick = e => { e.preventDefault(); openPlayer(r.name); };
      nc.appendChild(a);
      row.insertCell().textContent = r.entry > 1 ? '[' + r.entry + ']' : '';
      row.insertCell().textContent = r.country;
      const pcell = row.insertCell();
      pcell.textContent = r.qualified ? 'qualified for the target tournament'
        : r.amount ? M(r.amount, t) : (r.note || '');
      if (r.chop != null) { pcell.appendChild(el('span', 'chopTag', 'chop ' + r.chop + '% · listed ' + M(r.official, t))); row.classList.add('chopped'); }
      row.insertCell().textContent = r.pct != null ? r.pct + '%' : '';
    });
    // the satellites behind this one (or the tournament this satellite fed)
    camps.forEach(c => {
      const hd = el('h4', 'sec', t.satellite ? 'This satellite fed #' + c.id + (c.missing ? '' : ' — ' + c.event)
        : 'Your entry, satellites included');
      doc.appendChild(hd);
      doc.appendChild(campaignBox(c, { title: t.satellite, here: t.id }));
    });
    doc.appendChild(sortable(tbl));
    if (t.you.length) {
      const y = el('div', 'toYou');
      t.you.join(' ').split(/(?<=\.)\s*(?=You\b)/).forEach(x => y.appendChild(el('div', null, x)));
      doc.appendChild(y);
    }
    pane.appendChild(doc);

    // the starting hands this tournament actually dealt you, in the EV table's order
    if (global.PSStart && PSStart.tourneyGrid && handTids.has(t.id)) {
      const sh = el('div', 'toStart');
      pane.appendChild(sh);
      PSStart.tourneyGrid(sh, t.id, (t.hero && t.hero.name) || acct)
        .then(ok => { if (!ok) sh.remove(); })
        .catch(e => { console.warn('starting hands', e); sh.remove(); });
    }
  }

  function init() {
    $('#toSearch').oninput = () => renderList();
    $('#toAcct').onchange = e => setAccount(e.target.value);
    $('#toImport').onchange = async e => {
      const files = [...e.target.files];
      e.target.value = '';
      const read = await Promise.all(files.map(f => f.text().then(text => ({ name: f.name, text: text }))));
      const ok = read.filter(f => PSTSum.isSummary(f.text));
      if (ok.length < read.length) PSHome.toast(read.filter(f => !ok.includes(f)).map(f => f.name).join(', ') +
        ' — not a PokerStars tournament history', 'bad');
      if (ok.length) PSHome.importSummaries(ok);
    };
  }

  global.PSTourneys = { init, render, open, overview, campaignBox, campaignSection, sortable };
})(window);
