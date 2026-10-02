/* ===========================================================================
   app.js — UI for the PokerStars hand replayer
   =========================================================================== */
(function (global) {
  'use strict';
  const $ = s => document.querySelector(s);
  const el = (t, c, x) => { const e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; };

  /* ---------- state ---------- */
  let HANDS = [];          // every parsed hand
  let VIEW = [];           // filtered / sorted view
  let cur = -1;            // index into HANDS of the open hand
  let steps = [], si = 0;  // replay steps + cursor
  let timer = null;
  let heroName = '';       // '' = per-hand auto
  let cashMode = false;
  const stepCache = new Map();
  const eqCache = new Map();
  let eqCancel = null, curEq = null, eqDebounce = null;
  const renderHooks = [];
  const rangePct = () => +$('#eqRange').value;
  // one colour per live player, matched between the bar, the caption and the seat badge
  const EQ_COLORS = ['#6fb4ff', '#ffc169', '#6fe3b0', '#c79bff', '#ff9d9d', '#9ad8ff', '#ffd86f', '#9ff0a8', '#ff9ede'];
  const netCache = new Map();
  let listShown = 0;

  window.PSFmt = v => {
    if (v == null) return '';
    if (cashMode) return '$' + (Math.round(v * 100) / 100).toFixed(2);
    return Math.round(v).toLocaleString('en-US');
  };
  const fmt = v => window.PSFmt(v);
  const signed = v => (v > 0 ? '+' : v < 0 ? '−' : '') + fmt(Math.abs(v));

  /* =====================================================================
     loading
     ===================================================================== */
  const seenIds = new Set();
  let lastLoaded = [], lastParsed = 0;
  function addText(text, name) {
    const hands = PSParser.parseFile(text, name);
    lastParsed = hands.length;
    let n = 0;
    const fresh = [];
    for (const h of hands) {
      if (seenIds.has(h.id)) continue;      // same hand in two overlapping files
      seenIds.add(h.id);
      h.file = name; prepMeta(h); HANDS.push(h); fresh.push(h); n++;
    }
    lastLoaded = fresh;
    return n;
  }

  function prepMeta(h) {
    h.hasShowdown = h.streets.includes('showdown');
    h.names = h.seats.map(s => s.name);
    h.searchBlob = (h.id + ' ' + h.names.join(' ') + ' ' + h.game.label + ' ' +
      Object.values(h.revealed).map(c => c.join('')).join(' ')).toLowerCase();
  }

  /* one shared implementation, in the engine — see PSEngine.netFor */
  function quickNet(h, name) {
    if (!name) return 0;
    const key = h.id + '|' + name;
    if (netCache.has(key)) return netCache.get(key);
    const all = PSEngine.netFor(h);
    for (const n in all) netCache.set(h.id + '|' + n, all[n]);
    return netCache.has(key) ? netCache.get(key) : 0;
  }

  const heroOf = h => (heroName && h.players[heroName]) ? heroName : h.hero;

  function heroCardsOf(h) {
    const who = heroOf(h);
    if (!who) return [];
    const d = h.events.find(e => e.t === 'deal' && e.player === who);
    if (d) return d.all;
    return h.revealed[who] || [];
  }

  function afterLoad() {
    // sort chronologically by file then time
    if (!keepOrder) HANDS.sort((a, b) => (a.dateObj && b.dateObj) ? a.dateObj - b.dateObj : 0);
    // hero guess = most frequent per-hand hero
    const tally = {};
    for (const h of HANDS) if (h.hero) tally[h.hero] = (tally[h.hero] || 0) + 1;
    const best = Object.keys(tally).sort((a, b) => tally[b] - tally[a])[0];
    const allNames = {};
    for (const h of HANDS) for (const n of h.names) allNames[n] = (allNames[n] || 0) + 1;
    const sel = $('#heroSelect');
    sel.innerHTML = '<option value="">(auto — ' + (best || 'n/a') + ')</option>';
    Object.keys(allNames).sort((a, b) => allNames[b] - allNames[a]).slice(0, 200)
      .forEach(n => { const o = el('option', null, n + '  (' + allNames[n] + ')'); o.value = n; sel.appendChild(o); });

    const games = {}; for (const h of HANDS) games[h.game.label] = (games[h.game.label] || 0) + 1;
    fillSelect($('#fGame'), 'All games', Object.keys(games).sort().map(g => [g, g + ' (' + games[g] + ')']));
    const files = {}; for (const h of HANDS) files[h.file] = (files[h.file] || 0) + 1;
    fillSelect($('#fFile'), 'All files', Object.keys(files).sort().map(f => [f, f.replace(/\.txt$/, '') + ' (' + files[f] + ')']));

    $('#loadStat').textContent = HANDS.length.toLocaleString() + ' hands · ' + Object.keys(files).length + ' file(s)';
    applyFilters();
    try { if (VIEW.length) open(VIEW[0]); } catch (err) { showError('opening first hand: ' + err.message); }
  }

  function fillSelect(sel, allLabel, pairs) {
    const keep = sel.value;
    sel.innerHTML = '';
    sel.appendChild(new Option(allLabel, ''));
    pairs.forEach(([v, l]) => sel.appendChild(new Option(l, v)));
    if (keep) sel.value = keep;
  }

  /* =====================================================================
     hand list
     ===================================================================== */
  function applyFilters() {
    const q = $('#fSearch').value.trim().toLowerCase();
    const g = $('#fGame').value, f = $('#fFile').value, r = $('#fResult').value, s = $('#fSort').value;
    VIEW = HANDS.filter(h => {
      if (g && h.game.label !== g) return false;
      if (f && h.file !== f) return false;
      if (q && h.searchBlob.indexOf(q) < 0) return false;
      const mk = $('#fMark').value;
      if (mk === 'star' && !PSLesson.isStarred(h.id)) return false;
      if (mk === 'note' && !PSLesson.isAnnotated(h.id)) return false;
      if (mk === 'any' && !PSLesson.isStarred(h.id) && !PSLesson.isAnnotated(h.id)) return false;
      if (r) {
        const who = heroOf(h);
        if (!who) return false;
        const net = quickNet(h, who);
        if (r === 'win' && net <= 0) return false;
        if (r === 'lose' && net >= 0) return false;
        if (r === 'sd' && !(h.hasShowdown && h.players[who])) return false;
        if (r === 'vpip') {
          const vol = h.events.some(e => e.player === who && e.t === 'act' &&
            ['call', 'bet', 'raise'].includes(e.verb));
          if (!vol) return false;
        }
      }
      return true;
    });
    if (s === 'pot') VIEW.sort((a, b) => b.totalPot - a.totalPot);
    else if (s === 'win') VIEW.sort((a, b) => quickNet(b, heroOf(b)) - quickNet(a, heroOf(a)));
    else if (s === 'loss') VIEW.sort((a, b) => quickNet(a, heroOf(a)) - quickNet(b, heroOf(b)));

    listMetaLine();
    listShown = 0;
    $('#handList').innerHTML = '';
    growList();
    renderStats();
  }

  function listMetaLine() {
    const net = VIEW.reduce((t, h) => t + (heroOf(h) ? quickNet(h, heroOf(h)) : 0), 0);
    let stars = 0, notes = 0;
    for (const h of VIEW) {
      if (PSLesson.isStarred(h.id)) stars++;
      else if (PSLesson.isAnnotated(h.id)) notes++;
    }
    $('#listMeta').innerHTML = VIEW.length.toLocaleString() + ' hands · hero net ' +
      '<b class="' + (net > 0 ? 'amt up' : net < 0 ? 'amt dn' : 'amt flat') + '">' + signed(net) + '</b>' +
      (stars ? ' · <b class="starCount">★ ' + stars + '</b>' : '') +
      (notes ? ' · <b class="noteCount">★ ' + notes + '</b>' : '');
  }

  function growList() {
    const box = $('#handList');
    if (!VIEW.length && !listShown) { box.appendChild(el('div', 'empty', 'No hands match the filters.')); return; }
    const end = Math.min(VIEW.length, listShown + 150);
    for (let i = listShown; i < end; i++) {
      try { box.appendChild(rowFor(VIEW[i], i)); }
      catch (err) {                       // a single unrenderable hand must not
        console.warn('row render failed', VIEW[i] && VIEW[i].id, err);   // blank the list
        const d = el('div', 'hrow');
        d.appendChild(el('div', 'n', '#' + (i + 1)));
        d.appendChild(el('div', 'g', 'hand ' + ((VIEW[i] && VIEW[i].id) || '?') + ' — display error'));
        d.appendChild(el('div', 'amt flat', '?'));
        d.onclick = () => open(VIEW[i]);
        box.appendChild(d);
        showError('could not render hand ' + ((VIEW[i] && VIEW[i].id) || '?') + ': ' + err.message);
      }
    }
    listShown = end;
  }

  function rowFor(h, i) {
    const who = heroOf(h), net = who ? quickNet(h, who) : 0;
    const row = el('div', 'hrow' + (HANDS[cur] === h ? ' sel' : ''));
    row.dataset.id = h.id;
    row.appendChild(starBtn(h.id));
    row.appendChild(el('div', 'n', '#' + (i + 1)));
    const mid = el('div', 'mid');
    const t = h.dateObj ? h.dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    mid.appendChild(el('div', 'g', h.game.label + (h.levelRoman ? ' · L' + h.levelRoman : '') + (t ? ' · ' + t : '')));
    const cw = el('div', 'c');
    heroCardsOf(h).slice(0, 5).forEach(c => cw.appendChild(miniCard(c)));
    mid.appendChild(cw);
    row.appendChild(mid);
    row.appendChild(el('div', 'amt ' + (net > 0 ? 'up' : net < 0 ? 'dn' : 'flat'), signed(net)));
    row.onclick = () => open(h);
    return row;
  }

  /* ★ gold = tagged for review · ★ blue = annotated, not yet tagged · ☆ = neither */
  function starState(id) {
    if (PSLesson.isStarred(id)) return 'on';
    if (PSLesson.isAnnotated(id)) return 'annot';
    return '';
  }
  function paintStar(b, id) {
    const st = starState(id);
    b.className = 'star' + (st ? ' ' + st : '');
    b.textContent = st ? '★' : '☆';
    b.title = st === 'on' ? 'Tagged for review — click to untag'
      : st === 'annot' ? 'Reviewed (has markup or notes) — click to tag for another look'
      : 'Tag this hand for review';
  }
  function starBtn(id) {
    const b = el('button', 'star');
    paintStar(b, id);
    b.onclick = ev => {
      ev.stopPropagation();
      PSLesson.star(id);
      paintStar(b, id);
      if ($('#fMark').value) applyFilters(); else listMetaLine();
      if (HANDS[cur] && HANDS[cur].id === id) paintStar($('#starBtn'), id);
    };
    return b;
  }
  function refreshStars() {
    document.querySelectorAll('.hrow').forEach(r => {
      const b = r.querySelector('.star');
      if (b) paintStar(b, r.dataset.id);
    });
    if (cur >= 0) paintStar($('#starBtn'), HANDS[cur].id);
    listMetaLine();
  }

  function miniCard(code) {
    const s = code[1], r = code[0] === 'T' ? '10' : code[0];
    const d = el('span', 'mini ' + s, r + suit(s));
    return d;
  }
  const suit = s => ({ s: '♠', h: '♥', d: '♦', c: '♣' }[s] || '');

  /* =====================================================================
     open a hand / build steps
     ===================================================================== */
  function open(h) {
    cur = HANDS.indexOf(h);
    cashMode = h.isCash;
    if (!stepCache.has(h.id)) {
      if (stepCache.size > 60) stepCache.clear();
      h.warnings = [];
      stepCache.set(h.id, PSEngine.build(h));
    }
    steps = stepCache.get(h.id);
    si = 0;
    document.querySelectorAll('.hrow.sel').forEach(e => e.classList.remove('sel'));
    const row = [...document.querySelectorAll('.hrow')].find(e => e.dataset.id === h.id);
    if (row) { row.classList.add('sel'); row.scrollIntoView({ block: 'nearest' }); }
    $('#scrub').max = steps.length - 1;
    renderHead(h);
    renderLog(h);
    renderInfo(h);
    $('#rawText').textContent = h.raw;
    render();
  }

  function renderHead(h) {
    const bits = [];
    if (h.tourney) bits.push('Tournament #' + h.tourney + (h.buyin ? ' (' + h.buyin + ')' : ''));
    bits.push('Table ' + h.table + ' · ' + h.maxSeats + '-max');
    bits.push(h.date);
    $('#hhTitle').innerHTML = (h.mixed ? '<span style="color:#7fd0ff">' + h.mixed + ' → </span>' : '') +
      h.game.label + ' ' + h.game.betting + (h.levelRoman ? ' · Level ' + h.levelRoman : '') +
      ' (' + h.stakes + ')  <span style="color:#65748a">Hand #' + h.id + '</span>';
    $('#hhSub').textContent = bits.join('  ·  ');
    paintStar($('#starBtn'), h.id);
  }

  /* =====================================================================
     table rendering
     ===================================================================== */
  function render() {
    if (cur < 0) return;
    if (!document.getElementById('felt').clientWidth) return;   // view is hidden
    const h = HANDS[cur], st = steps[si];
    const seats = $('#seats');
    seats.innerHTML = '';

    const ps = st.players.slice().sort((a, b) => a.seat - b.seat);
    const who = heroOf(h);
    let hi = ps.findIndex(p => p.name === who);
    if (hi < 0) hi = 0;
    const n = ps.length;
    // short-handed tables need the seats pushed further out (and a taller felt),
    // otherwise the top seat lands on top of the board
    // short-handed tables push the seats further out instead of making the felt
    // taller — a changing felt height would resize the table between hands
    const RX = n <= 4 ? 46 : 44, RY = n <= 2 ? 52 : n <= 4 ? 48 : 43;

    const pitchJobs = [];
    ps.forEach((p, k) => {
      const idx = (k - hi + n) % n;
      const ang = 90 + idx * (360 / n);
      const c = polar(ang, RX, RY);
      const d = el('div', 'seat' +
        (p.name === who ? ' hero' : '') +
        (st.actor === p.name ? ' acting' : '') +
        (p.folded ? ' folded' : '') +
        (!p.inHand ? ' out' : ''));
      d.style.left = c.x + '%'; d.style.top = c.y + '%';
      d.dataset.name = p.name;

      d.title = p.name + ' — seat ' + p.seat + ' — ' + fmt(p.stack);
      const nm = el('div', 'nm');
      nm.appendChild(el('b', null, p.name));
      nm.appendChild(el('span', 'st', fmt(p.stack) + (p.allin ? ' ⛔' : '')));
      d.appendChild(nm);

      const sub = el('div', 'sub');
      sub.appendChild(el('span', null, 'Seat ' + p.seat + (p.pos ? ' · ' + p.pos : '')));
      sub.appendChild(el('span', null, p.sittingOut && !p.inHand ? 'sitting out' : (p.mucked ? 'mucked' : '')));
      d.appendChild(sub);

      if (h.game.fam === 'stud' && p.name === who) d.classList.add('lifted');
      const cw = el('div', 'cards');
      cardsFor(h, p, st, who).forEach(cd => cw.appendChild(cd));
      d.appendChild(cw);

      d.appendChild(el('div', 'last', p.last || (p.showDesc ? p.showDesc : '')));
      if (p.badge) d.appendChild(el('div', 'badge', p.badge));
      if (p.won) d.appendChild(el('div', 'winTag', '+' + fmt(p.won)));
      seats.appendChild(d);

      if (p.bet > 0) {
        const b = polar(ang, RX * 0.58, RY * 0.56);
        const chip = el('div', 'betChip', fmt(p.bet));
        chip.style.left = b.x + '%'; chip.style.top = b.y + '%';
        seats.appendChild(chip);
      }
      // draw games: the cards a player pitched.  Placed after the loop, off the
      // seat's own front edge — an offset around the oval drifts the pile toward
      // the next player and it stops reading as theirs.
      if (p.pitched && p.pitched.n > 0) pitchJobs.push({ p: p, seat: d });
      if (p.isButton) {
        const b = polar(ang + (180 / n), RX * 0.74, RY * 0.72);
        const bt = el('div', 'dealerBtn', 'D');
        bt.style.left = b.x + '%'; bt.style.top = b.y + '%';
        seats.appendChild(bt);
      }
    });

    placePitches(pitchJobs, seats);

    // seat cards shrink so a 7-card stud hand still fits inside the seat box
    const maxC = ps.reduce((m, p) => Math.max(m, p.cards.length), 0);
    const feltEl = document.getElementById('felt');
    // Cards are as large as the table can actually hold: take the size we want,
    // then cap it so no two seat boxes can overlap at this felt size and seat
    // count.  A crowded 8-handed table gets smaller cards than a 3-handed one,
    // and a wide window gets bigger cards than a narrow one.
    const wantScw = maxC >= 7 ? 28 : maxC >= 6 ? 31 : maxC >= 5 ? 34 : maxC >= 4 ? 38 : 42;
    const wantW   = maxC >= 7 ? 228 : maxC >= 6 ? 212 : maxC >= 5 ? 196 : maxC >= 4 ? 178 : 170;
    const fw = feltEl.clientWidth || 760, fh = feltEl.clientHeight || 370;
    const estH = wantScw * 1.45 + 64;                 // seat box height at that card size
    const pts = [];
    for (let k = 0; k < n; k++) {
      const c = polar(90 + k * (360 / n), RX, RY);
      pts.push({ x: c.x / 100 * fw, y: c.y / 100 * fh });
    }
    let capW = Infinity;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const dx = Math.abs(pts[i].x - pts[j].x), dy = Math.abs(pts[i].y - pts[j].y);
      if (dy < estH) capW = Math.min(capW, dx - 10);   // these two share vertical space
    }
    const seatw = Math.max(108, Math.min(wantW, capW));
    const scw = Math.max(14, Math.min(wantScw,
      Math.floor((seatw - 16 - (maxC - 1) * 2) / Math.max(1, maxC))));
    feltEl.style.setProperty('--scw', scw + 'px');
    feltEl.style.setProperty('--seatw', seatw + 'px');

    // centre
    $('#streetTag').textContent = st.streetLabel + (h.mixed ? ' · ' + h.game.label : '');
    const bd = $('#board'); bd.innerHTML = '';
    st.board.forEach(c => bd.appendChild(faceCard(c)));
    $('#potVal').textContent = fmt(st.pot + st.streetBets);
    $('#actionText').textContent = st.desc || '';
    $('#stepCount').textContent = (si + 1) + ' / ' + steps.length;
    $('#scrub').value = si;
    $('#playBtn').textContent = timer ? '❚❚' : '▶';

    // log highlight
    document.querySelectorAll('#paneLog .logline').forEach(l => {
      const s = +l.dataset.step;
      l.classList.toggle('done', s < si);
      l.classList.toggle('cur', s === si);
    });
    const c2 = $('#paneLog .logline.cur');
    if (c2) c2.scrollIntoView({ block: 'nearest' });

    updateEquity();
    fitPinned();
    for (const fn of renderHooks) { try { fn(); } catch (err) { console.warn('render hook', err); } }
  }

  /* =====================================================================
     heads-up equity (Monte Carlo, see equity.js)
     ===================================================================== */
  function updateEquity() {
    if (eqCancel) { eqCancel(); eqCancel = null; }
    curEq = null;
    const box = $('#eqBox');
    const sims = +$('#eqSims').value;
    // Equity switched off is a deliberate one-time layout change; a step with
    // nothing to show keeps its row so the table never resizes mid-replay.
    if (!sims || cur < 0) { box.classList.remove('on'); return; }
    box.classList.add('on');
    const h = HANDS[cur], st = steps[si], xray = $('#xray').checked;
    let sp = null;
    try { sp = PSEquity.spec(h, st, { xray: xray }); } catch (err) { console.warn(err); }
    if (!sp) { blankEquity(); return; }

    // the range slider only means something against a player we cannot see
    const canRange = sp.rangeable.some(Boolean);
    $('#eqRangeWrap').classList.toggle('off', !canRange);
    const range = canRange ? rangePct() / 100 : 1;
    $('#eqRangeVal').textContent = !canRange ? 'n/a' : range >= 1 ? 'any two' : 'top ' + rangePct() + '%';

    const key = h.id + '|' + si + '|' + (xray ? 1 : 0) + '|' + sims + '|' + Math.round(range * 100);
    const names = sp.players.map(p => p.name);
    const cached = eqCache.get(key);
    if (cached) { paintEquity(names, cached, sp, xray); return; }

    paintEquity(names, null, sp, xray);
    eqCancel = PSEquity.start(sp, sims, r => {
      if (r.done) { if (eqCache.size > 400) eqCache.clear(); eqCache.set(key, r); }
      paintEquity(names, r, sp, xray);
    }, { range: range });
  }

  /* The strips below the table hold a fixed height so the felt never resizes
     mid-replay.  If the reader's font makes the content taller than the height
     we picked, grow the strip rather than cut it off — it only ever grows, so
     the table still stops moving. */
  function fitPinned() {
    for (const id of ['handHead', 'eqBox', 'actionBanner', 'teachBand']) {
      const e = document.getElementById(id);
      if (!e || !e.clientHeight) continue;
      if (e.scrollHeight > e.clientHeight + 1) e.style.height = e.scrollHeight + 'px';
    }
  }

  function blankEquity() {
    $('#eqBar').innerHTML = '';
    $('#eqTxt').innerHTML = '';
    $('#eqRangeWrap').classList.add('off');
    document.querySelectorAll('.seat .eq').forEach(e => e.remove());
  }

  function paintEquity(names, r, sp, xray) {
    const bar = $('#eqBar'), txt = $('#eqTxt');
    document.querySelectorAll('.seat .eq').forEach(e => e.remove());
    bar.innerHTML = '';
    const n = names.length;
    if (!r) {
      for (let i = 0; i < n; i++) {
        const sp2 = el('span'); sp2.style.width = (100 / n) + '%';
        sp2.style.background = EQ_COLORS[i % EQ_COLORS.length]; sp2.style.opacity = '.3';
        bar.appendChild(sp2);
      }
      txt.textContent = 'running ' + (+$('#eqSims').value).toLocaleString() + ' simulations…';
      return;
    }
    curEq = r;
    for (let i = 0; i < n; i++) {
      const seg = el('span');
      seg.style.width = (100 * r.eq[i]).toFixed(2) + '%';
      seg.style.background = EQ_COLORS[i % EQ_COLORS.length];
      seg.title = names[i] + ' ' + (100 * r.eq[i]).toFixed(1) + '%';
      bar.appendChild(seg);
    }

    const rangedNames = sp.players.filter((p, i) => sp.rangeable[i]).map(p => p.name);
    const ranged = r.ranged
      ? (rangedNames.length > 2 ? rangedNames.length + ' opponents' : rangedNames.join(' & ')) +
        ' held to the top ' + rangePct() + '%'
      : null;
    const src = r.exact ? 'exact — all cards known'
      : (sp.knownNow ? 'actual hands, run-out simulated'
        : (ranged ? ranged : 'unknown cards sampled')) +
        ' · ' + r.n.toLocaleString() + (r.done ? '' : '…') + ' sims';

    const head = n <= 3
      ? names.map((nm, i) => '<span style="color:' + EQ_COLORS[i % EQ_COLORS.length] + '">' + nm +
          ' <b>' + (100 * r.eq[i]).toFixed(1) + '%</b></span>').join(' · ')
      : n + '-way';
    // hi/lo games: show who wins each half, not just the merged pot share
    let halves = '';
    if (r.hi) {
      const row = (lbl, arr, note) => '<div class="eqHalf"><i>' + lbl + '</i>' +
        arr.map((v, i) => '<b style="color:' + EQ_COLORS[i % EQ_COLORS.length] + '">' +
          (100 * v).toFixed(0) + '%</b>').join('') +
        (note ? '<u>' + note + '</u>' : '') + '</div>';
      halves = row('HI', r.hi, null) +
        (r.lo ? row('LO', r.lo, 'low ' + (100 * r.lowFreq).toFixed(0) + '%')
              : '<div class="eqHalf"><i>LO</i><u>no low possible</u></div>');
    }

    txt.innerHTML = '<span>' + head +
      (r.ties > 0.0005 ? ' · split ' + (100 * r.ties).toFixed(1) + '%' : '') + '</span>' +
      halves +
      '<span style="opacity:.7">' + src +
      (xray || r.exact || sp.knownNow ? '' : ' — press x for actual cards') + '</span>';

    names.forEach((nm, ix) => {
      const seat = document.querySelector('.seat[data-name="' + cssq(nm) + '"]');
      if (!seat) return;
      const e = el('div', 'eq', (100 * r.eq[ix]).toFixed(1) + '%');
      e.style.color = EQ_COLORS[ix % EQ_COLORS.length];
      seat.appendChild(e);
    });
  }

  const cssq = s => s.replace(/["\\]/g, '\\$&');

  /* Put each pile just off the front edge of its own seat, on the line to the
     middle of the table, nudged a little to one side so it clears the bet chip.
     One measuring pass for the whole table. */
  function placePitches(jobs, host) {
    if (!jobs.length) return;
    const box = host.getBoundingClientRect();
    const mx = box.width / 2, my = box.height / 2;
    const rel = r => ({ left: r.left - box.left, top: r.top - box.top, right: r.right - box.left, bottom: r.bottom - box.top });
    const blockers = [...host.querySelectorAll('.seat, .betChip, .dealerBtn')].map(e => rel(e.getBoundingClientRect()));
    const centre = rel(document.getElementById('centre').getBoundingClientRect());
    blockers.push(centre);
    const clash = (x, y, w, h) => {
      const a = { left: x - w / 2, right: x + w / 2, top: y - h / 2, bottom: y + h / 2 };
      return blockers.some(b => !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom));
    };

    for (const job of jobs) {
      const p = job.p;
      const r = job.seat.getBoundingClientRect();
      const cx = r.left - box.left + r.width / 2, cy = r.top - box.top + r.height / 2;
      let dx = mx - cx, dy = my - cy;
      const len = Math.hypot(dx, dy) || 1;
      dx /= len; dy /= len;
      const tx = Math.abs(dx) > 1e-3 ? (r.width / 2) / Math.abs(dx) : Infinity;
      const ty = Math.abs(dy) > 1e-3 ? (r.height / 2) / Math.abs(dy) : Infinity;
      const edge = Math.min(tx, ty);                 // seat centre -> its own edge
      const pw = 24 + (p.pitched.n - 1) * 17, ph = 36;

      // try a few spots just off the seat's front edge and take the first that
      // touches nothing — a fixed offset always collides with something somewhere
      let best = null;
      const side = 22 + pw / 2;
      for (const [out, lat] of [[edge + 26, 0], [edge + 26, side], [edge + 26, -side],
                                [edge + 30, side * 1.4], [edge + 30, -side * 1.4],
                                [edge + 62, 0], [edge + 62, side]]) {
        const x = cx + dx * out + (-dy) * lat, y = cy + dy * out + dx * lat;
        if (x - pw / 2 < 0 || x + pw / 2 > box.width || y - ph / 2 < 0 || y + ph / 2 > box.height) continue;
        if (!clash(x, y, pw, ph)) { best = { x, y }; break; }
      }
      if (!best) best = { x: cx + dx * (edge + 26) + (-dy) * side, y: cy + dy * (edge + 26) + dx * side };

      const g = el('div', 'pitch');
      g.style.left = best.x + 'px'; g.style.top = best.y + 'px';
      for (let i = 0; i < p.pitched.n; i++) {
        const known = p.pitched.cards && p.pitched.cards[i];
        const c = known ? faceCard(known, 'pitchCard known') : el('div', 'card pitchCard down');
        c.style.transform = 'rotate(' + ((i - (p.pitched.n - 1) / 2) * 12).toFixed(1) + 'deg)';
        if (i) c.style.marginLeft = '-7px';
        g.appendChild(c);
      }
      g.title = p.name + ' drew ' + p.pitched.n +
        (p.pitched.cards ? ' — pitched ' + p.pitched.cards.join(' ') : '');
      host.appendChild(g);
      blockers.push({ left: best.x - pw / 2, right: best.x + pw / 2, top: best.y - ph / 2, bottom: best.y + ph / 2 });
    }
  }

  function polar(deg, rx, ry) {
    const t = deg * Math.PI / 180;
    return { x: 50 + rx * Math.cos(t), y: 50 + ry * Math.sin(t) };
  }

  function cardsFor(h, p, st, who) {
    const xray = $('#xray').checked;
    // in stud, lift the hero's own up-cards so it is obvious what the table can see
    const lift = h.game.fam === 'stud' && p.name === who;
    const rev = h.revealed[p.name] || null;
    const drawGame = h.game.fam === 'draw';
    const canXray = xray && rev && (!drawGame || ['draw3', 'showdown', 'summary'].includes(st.street) ||
      (h.game.draws === 1 && ['draw1', 'showdown', 'summary'].includes(st.street)));
    return p.cards.map((c, ix) => {
      if (c.c) return faceCard(c.c, c.up ? (lift ? 'sm lift' : 'sm') : 'sm hole');
      if (canXray && rev[ix]) return faceCard(rev[ix], 'sm xray');
      const d = el('div', 'card sm down');
      return d;
    });
  }

  function faceCard(code, extra) {
    const d = el('div', 'card ' + (extra || '') + ' ' + (code[1] === 's' ? 's2' : code[1]) +
      (code[0] === 'T' ? ' ten' : ''));
    d.appendChild(el('div', 'r', code[0] === 'T' ? '10' : code[0]));
    d.appendChild(el('div', 's', suit(code[1])));
    return d;
  }

  /* =====================================================================
     side panes
     ===================================================================== */
  function renderLog(h) {
    const pane = $('#paneLog');
    pane.innerHTML = '';
    steps.forEach((s, k) => {
      s.lines.forEach(line => {
        const isStreet = line.startsWith('***');
        const d = el('div', 'logline' + (isStreet ? ' street' : ''), line);
        d.dataset.step = k;
        d.onclick = () => { si = k; render(); };
        pane.appendChild(d);
      });
    });
  }

  function renderInfo(h) {
    const who = heroOf(h), pane = $('#paneInfo');
    pane.innerHTML = '';
    const t = el('table', 'infoTable');
    const add = (a, b) => { const r = t.insertRow(); r.insertCell().textContent = a; r.insertCell().innerHTML = b; };
    add('Hand', '#' + h.id);
    add('Game', (h.mixed ? h.mixed + ' → ' : '') + h.game.label + ' ' + h.game.betting);
    if (h.tourney) add('Tournament', '#' + h.tourney + (h.buyin ? ' · ' + h.buyin : ''));
    add('Level', (h.levelRoman || '—') + ' (' + h.stakes + ')');
    add('Table', h.table + ' · ' + h.maxSeats + '-max' + (h.buttonSeat ? ' · button seat ' + h.buttonSeat : ''));
    add('Played', h.date);
    add('File', h.file);
    add('Total pot', fmt(h.totalPot) + (h.rake ? ' (rake ' + fmt(h.rake) + ')' : '') +
      (h.potBreakdown ? '<br><span style="color:#65748a">' + h.potBreakdown + '</span>' : ''));
    pane.appendChild(t);

    pane.appendChild(Object.assign(el('h4', 'sec', 'Result'), {}));
    for (const p of (h.finalPlayers || [])) {
      const net = quickNet(h, p.name);
      const r = el('div', 'sumRow');
      r.appendChild(el('div', 'who', (p.name === who ? '★ ' : '') + p.name + ' · seat ' + p.seat));
      const a = el('div', 'amt ' + (net > 0 ? 'up' : net < 0 ? 'dn' : 'flat'), signed(net));
      r.appendChild(a);
      pane.appendChild(r);
    }

    pane.appendChild(el('h4', 'sec', 'Showdown / summary'));
    for (const s of h.summary) {
      const r = el('div', 'sumRow');
      r.appendChild(el('div', 'who', 'Seat ' + s.seat + ': ' + (s.name || '') + ' ' + s.text));
      pane.appendChild(r);
    }
    if (h.warnings && h.warnings.length) {
      const w = el('div', 'warnBox');
      w.appendChild(el('div', null, '⚠ consistency check'));
      h.warnings.forEach(x => w.appendChild(el('div', null, '· ' + x)));
      pane.appendChild(w);
    }
  }

  function renderStats() {
    const pane = $('#paneStats');
    if (!VIEW.length) { pane.innerHTML = '<div class="empty">Nothing to summarise.</div>'; return; }
    const byGame = {};
    let net = 0, sd = 0, sdw = 0, won = 0, lost = 0, best = null, worst = null;
    for (const h of VIEW) {
      const who = heroOf(h); if (!who || !h.players[who]) continue;
      const v = quickNet(h, who);
      net += v;
      const g = byGame[h.game.label] || (byGame[h.game.label] = { n: 0, net: 0 });
      g.n++; g.net += v;
      if (v > 0) won++; else if (v < 0) lost++;
      if (h.hasShowdown && h.revealed[who]) { sd++; if (v > 0) sdw++; }
      if (!best || v > quickNet(best, heroOf(best))) best = h;
      if (!worst || v < quickNet(worst, heroOf(worst))) worst = h;
    }
    const t = el('table', 'infoTable');
    const add = (a, b) => { const r = t.insertRow(); r.insertCell().textContent = a; r.insertCell().innerHTML = b; };
    add('Hands', VIEW.length.toLocaleString());
    add('Net', '<b class="amt ' + (net > 0 ? 'up' : 'dn') + '">' + signed(net) + '</b>');
    add('Won / lost', won + ' / ' + lost);
    add('Showdowns', sd + (sd ? ' · won ' + Math.round(100 * sdw / sd) + '%' : ''));
    if (best) add('Best hand', signed(quickNet(best, heroOf(best))) + ' — #' + best.id);
    if (worst) add('Worst hand', signed(quickNet(worst, heroOf(worst))) + ' — #' + worst.id);
    pane.innerHTML = '';
    pane.appendChild(t);
    pane.appendChild(el('h4', 'sec', 'By game'));
    const t2 = el('table', 'infoTable');
    Object.keys(byGame).sort().forEach(g => {
      const r = t2.insertRow();
      r.insertCell().textContent = g;
      r.insertCell().innerHTML = byGame[g].n + ' hands · <b class="amt ' +
        (byGame[g].net > 0 ? 'up' : 'dn') + '">' + signed(byGame[g].net) + '</b>';
    });
    pane.appendChild(t2);
  }

  /* =====================================================================
     navigation
     ===================================================================== */
  const go = k => { si = Math.max(0, Math.min(steps.length - 1, k)); render(); };
  function stepStreet(dir) {
    if (!steps.length) return;
    const cs = steps[si].street;
    let k = si;
    while (k + dir >= 0 && k + dir < steps.length && steps[k + dir].street === cs) k += dir;
    go(k + dir);
  }
  function hopHand(d) {
    const vi = VIEW.indexOf(HANDS[cur]);
    const nx = vi < 0 ? 0 : vi + d;
    if (nx >= 0 && nx < VIEW.length) {
      if (nx >= listShown) growList();
      open(VIEW[nx]);
    }
  }
  function play() {
    if (timer) { clearInterval(timer); timer = null; render(); return; }
    if (si >= steps.length - 1) si = 0;
    timer = setInterval(() => {
      if (si >= steps.length - 1) { clearInterval(timer); timer = null; render(); return; }
      si++; render();
    }, +$('#speed').value);
    render();
  }

  /* =====================================================================
     wiring
     ===================================================================== */
  function readFiles(list) {
    const all = [...list];
    const files = all.filter(f => /\.(txt|log|rtf)$/i.test(f.name));
    const report = { chosen: all.length, read: files.length, unreadable: [], empty: [], duplicate: [], parsed: 0, summaries: 0 };
    if (!files.length) {
      report.nothingUsable = true;
      if (global.PSHome) PSHome.reportLoad([], report);
      return;
    }
    let left = files.length;
    let imported = [];
    const summaries = [];          // "Tournament History" emails go to the Tournament Overview
    $('#loadStat').textContent = 'reading ' + files.length + ' file(s)…';
    const done = () => {
      afterLoad();
      if (global.PSHome) {
        if (summaries.length) PSHome.importSummaries(summaries);
        PSHome.reportLoad(imported, report);
      }
    };
    files.forEach(f => {
      const fr = new FileReader();
      fr.onload = () => {
        try {
          if (global.PSTSum && PSTSum.isSummary(fr.result)) {
            summaries.push({ name: f.name, text: fr.result });
            report.summaries++;
          } else {
            addText(global.PSTSum ? PSTSum.rtfToText(fr.result) : fr.result, f.name);
            report.parsed += lastParsed;
            if (!lastParsed) report.empty.push(f.name);
            else if (!lastLoaded.length) report.duplicate.push(f.name);
            imported = imported.concat(lastLoaded);
          }
        } catch (err) {
          console.warn('import failed for', f.name, err);
          report.unreadable.push(f.name + ' (' + err.message + ')');
        }
        if (--left === 0) done();
      };
      fr.onerror = () => {
        report.unreadable.push(f.name + ' (could not be read)');
        if (--left === 0) done();
      };
      fr.readAsText(f);
    });
  }

  $('#fileInput').onchange = e => readFiles(e.target.files);
  $('#dirInput').onchange = e => readFiles(e.target.files);
  $('#pasteBtn').onclick = () => $('#pasteModal').classList.add('open');
  $('#pasteCancel').onclick = () => $('#pasteModal').classList.remove('open');
  $('#pasteLoad').onclick = () => {
    const txt = $('#pasteArea').value;
    if (global.PSTSum && PSTSum.isSummary(txt)) {
      $('#pasteModal').classList.remove('open');
      PSHome.importSummaries([{ name: 'pasted', text: txt }]);
      return;
    }
    const n = addText(txt, 'pasted');
    $('#pasteModal').classList.remove('open');
    if (n) afterLoad();
  };

  ['dragenter', 'dragover'].forEach(t => document.addEventListener(t, e => {
    e.preventDefault(); document.body.classList.add('dragging');
  }));
  ['dragleave', 'drop'].forEach(t => document.addEventListener(t, e => {
    if (t === 'dragleave' && e.relatedTarget) return;
    document.body.classList.remove('dragging');
  }));
  document.addEventListener('drop', e => {
    e.preventDefault();
    document.body.classList.remove('dragging');
    const dtf = e.dataTransfer;
    if (!dtf) return;

    // A folder drop only reaches us through the entry API; a plain file drop may
    // or may not expose one.  Fall back to .files whenever the walk comes up
    // empty, so a drop is never silently ignored.
    let entries = [];
    if (dtf.items && dtf.items.length && dtf.items[0].webkitGetAsEntry) {
      entries = [...dtf.items]
        .map(i => { try { return i.webkitGetAsEntry(); } catch (err) { return null; } })
        .filter(Boolean);
    }
    if (!entries.length) { readFiles(dtf.files); return; }

    const out = [];
    let pending = 0, done = false;
    const finish = () => {
      if (!done || pending) return;
      readFiles(out.length ? out : dtf.files);
    };
    const walk = entry => {
      if (entry.isFile) {
        pending++;
        entry.file(f => { out.push(f); pending--; finish(); },
                   () => { pending--; finish(); });
      } else if (entry.isDirectory) {
        pending++;
        const rd = entry.createReader();
        const readAll = () => rd.readEntries(list => {
          if (!list.length) { pending--; finish(); return; }
          list.forEach(walk); readAll();
        }, () => { pending--; finish(); });
        readAll();
      }
    };
    entries.forEach(walk);
    done = true; finish();
  });

  $('#starBtn').onclick = () => {
    if (cur < 0) return;
    PSLesson.star(HANDS[cur].id);
    refreshStars();
    if ($('#fMark').value) applyFilters();
  };

  ['fSearch', 'fGame', 'fFile', 'fResult', 'fSort', 'fMark'].forEach(id => {
    const n = $('#' + id);
    n.addEventListener(id === 'fSearch' ? 'input' : 'change', () => applyFilters());
  });
  $('#handList').addEventListener('scroll', e => {
    const b = e.target;
    if (b.scrollTop + b.clientHeight > b.scrollHeight - 200) growList();
  });
  $('#heroSelect').onchange = e => {
    heroName = e.target.value;
    netCache.clear(); applyFilters();
    if (cur >= 0) { stepCache.delete(HANDS[cur].id); open(HANDS[cur]); }
  };
  $('#xray').onchange = render;
  $('#eqSims').onchange = () => { eqCache.clear(); updateEquity(); };
  $('#eqRange').oninput = () => {
    const v = rangePct();
    $('#eqRangeVal').textContent = v >= 100 ? 'any two' : 'top ' + v + '%';
    clearTimeout(eqDebounce);
    eqDebounce = setTimeout(updateEquity, 220);
  };
  $('#fourColor').onchange = e => document.body.classList.toggle('twocolor', !e.target.checked);
  $('#blackBg').onchange = e => {
    document.body.classList.toggle('blackbg', e.target.checked);
    try { localStorage.setItem('psreplayer.blackbg', e.target.checked ? '1' : ''); } catch (err) { }
    setTimeout(render, 30);
  };
  try {
    if (localStorage.getItem('psreplayer.blackbg')) {
      $('#blackBg').checked = true;
      document.body.classList.add('blackbg');
    }
  } catch (err) { }

  $('#prevStep').onclick = () => go(si - 1);
  $('#nextStep').onclick = () => go(si + 1);
  $('#firstStep').onclick = () => go(0);
  $('#lastStep').onclick = () => go(steps.length - 1);
  $('#prevStreet').onclick = () => stepStreet(-1);
  $('#nextStreet').onclick = () => stepStreet(1);
  $('#prevHand').onclick = () => hopHand(-1);
  $('#nextHand').onclick = () => hopHand(1);
  $('#playBtn').onclick = play;
  $('#scrub').oninput = e => go(+e.target.value);
  $('#speed').onchange = () => { if (timer) { clearInterval(timer); timer = null; play(); } };

  document.querySelectorAll('.tab').forEach(t => t.onclick = () => {
    document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
    document.querySelectorAll('.pane').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    $('#' + t.dataset.pane).classList.add('active');
  });

  document.addEventListener('keydown', e => {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    switch (e.key) {
      case 'ArrowRight': e.shiftKey ? stepStreet(1) : go(si + 1); e.preventDefault(); break;
      case 'ArrowLeft':  e.shiftKey ? stepStreet(-1) : go(si - 1); e.preventDefault(); break;
      case 'ArrowDown':  hopHand(1); e.preventDefault(); break;
      case 'ArrowUp':    hopHand(-1); e.preventDefault(); break;
      case ' ':          play(); e.preventDefault(); break;
      case 'Home':       go(0); break;
      case 'End':        go(steps.length - 1); break;
      case 'x': $('#xray').checked = !$('#xray').checked; render(); break;
      case 's': $('#starBtn').click(); e.preventDefault(); break;
    }
  });

  /* any uncaught failure becomes visible instead of a silently empty screen */
  function showError(msg) {
    const b = $('#errBar');
    b.textContent = '⚠ ' + msg + '  ·  click to dismiss (a hard reload — ⌘⇧R — clears stale files)';
    b.style.display = 'block';
  }
  $('#errBar').onclick = () => { $('#errBar').style.display = 'none'; };
  window.addEventListener('error', e =>
    showError(e.message + ' (' + String(e.filename || '').split('/').pop() + ':' + e.lineno + ')'));
  window.addEventListener('unhandledrejection', e => showError(String(e.reason)));

  /* the library hands the replayer a whole set at once */
  let keepOrder = false;          // a lesson plays in its own order, not by date
  function replaceHands(text, label, ordered) {
    keepOrder = !!ordered;
    HANDS = []; VIEW = []; cur = -1; steps = []; si = 0;
    seenIds.clear(); stepCache.clear(); netCache.clear(); eqCache.clear();
    $('#handList').innerHTML = '';
    addText(text, label || 'library');
    afterLoad();
  }

  /* ---- API the teaching layer drives the replay through ---- */
  global.PSApp = {
    hand: () => (cur >= 0 ? HANDS[cur] : null),
    step: () => si,
    steps: () => steps.length,
    goto: k => go(k),
    onRender: fn => renderHooks.push(fn),
    openById: id => { const h = HANDS.find(x => x.id === id); if (h) open(h); return !!h; },
    addHandText: (text, name) => { const n = addText(text, name); if (n) afterLoad(); return n; },
    refreshStars: refreshStars,
    stepsOf: () => steps,
    heroName: () => heroOf(HANDS[cur] || {}),
    replaceHands: replaceHands,
    redraw: () => { if (cur >= 0) render(); },
    lastLoaded: () => lastLoaded,
  };

  /* demo hint when nothing loaded */
  $('#handList').innerHTML = '<div class="empty">Load PokerStars hand-history files<br>(drag &amp; drop works too)</div>';

  if (global.PSTeach) PSTeach.init();
  if (global.PSBuildUI) PSBuildUI.init();
  if (global.PSHome) PSHome.init();
  if (global.PSTourneys) PSTourneys.init();
  if (global.PSStart) PSStart.init();
  if (global.PSLuckUI) PSLuckUI.init();
  if (global.PSPlans) PSPlans.init();
  if (global.PSSolverUI) PSSolverUI.init();
})(window);
