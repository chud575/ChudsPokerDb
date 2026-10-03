/* ===========================================================================
   luckui.js — the Skill vs luck screen, and the summary box a tournament's
   page carries.  The measuring is in luck.js; this file only presents it.
   =========================================================================== */
(function (global) {
  'use strict';
  const $ = s => document.querySelector(s);
  const el = (t, c, x) => { const e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; };
  const SUIT = { c: '♣', d: '♦', h: '♥', s: '♠' };
  const sgn = v0 => { const d = Math.abs(v0) >= 100 ? 0 : 1, v = +v0.toFixed(d) || 0; return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(d); };
  const pc = v => Math.round(v * 100) + '%';
  const cls = v => v > 0.05 ? 'up' : v < -0.05 ? 'dn' : '';
  const plural = (n, a, b) => n + ' ' + (n === 1 ? a : b);

  function cardsEl(cards) {
    const w = el('span', 'lkCards');
    (cards || []).forEach(c => w.appendChild(el('span', 'cd su-' + c[1], c[0] + SUIT[c[1]])));
    return w;
  }
  const outcome = r => r.share >= 0.99 ? 'won' : r.share <= 0.01 ? 'lost' : 'split ' + pc(r.share);
  const WHAT = { beat: 'sucked out on', lucky: 'you sucked out', held: 'held up', missed: 'missed', fav: 'all-in, favourite', dog: 'all-in, underdog' };

  /* ---------- what the numbers say, in sentences ---------- */
  function insights(res, s, short) {
    const out = [];
    if (!s.n) return ['No showdown here has every hand face up, so there is nothing to measure yet.'];
    const adj = s.net - s.luck;
    const mild = Math.abs(s.luck) <= Math.max(0.5, s.sd / 2);
    out.push((mild ? 'Luck was close to neutral' : s.luck > 0 ? 'You ran good' : 'You ran bad') + ': across ' + plural(s.n, 'measured showdown', 'measured showdowns') +
      ' the cards gave you ' + sgn(s.luck) + ' BB compared with what your equity was worth. Your result in those hands was ' + sgn(s.net) +
      ' BB; with the luck taken out it would have been ' + sgn(adj) + ' BB.');
    if (s.nGood || s.nBad) out.push('Both sides of that: the cards went your way in ' + plural(s.nGood, 'hand', 'hands') + ' for ' + sgn(s.good) + ' BB, and against you in ' +
      plural(s.nBad, 'hand', 'hands') + ' for ' + sgn(s.bad) + ' BB.' + (s.bigGood ? ' Luckiest single hand ' + sgn(s.bigGood.luck) + ' BB (' + s.bigGood.label + ', ' +
      (s.bigGood.kind === 'allin' ? 'all-in with ' : '') + pc(s.bigGood.eq) + ' equity, ' + outcome(s.bigGood) + ')' : '') +
      (s.bigBad ? '; unluckiest ' + sgn(s.bigBad.luck) + ' BB (' + s.bigBad.label + ', ' + (s.bigBad.kind === 'allin' ? 'all-in with ' : '') + pc(s.bigBad.eq) + ' equity, ' + outcome(s.bigBad) + ').' : '.'));
    if (s.ai.n) {
      const a = s.ai;
      out.push('All-in before the last card ' + plural(a.n, 'time', 'times') + ': the money went in as the favourite ' + a.fav + ' of ' + a.n +
        ' (' + pc(a.fav / a.n) + '), average equity ' + pc(a.eq / a.n) + '. Equity says you win ' + a.exp.toFixed(1) + ' of those pots; you won ' + a.got.toFixed(1) +
        ' — ' + (Math.abs(a.got - a.exp) < 0.5 ? 'right on expectation' : (a.got > a.exp ? 'above' : 'below') + ' expectation by ' + Math.abs(a.got - a.exp).toFixed(1) + ' pots') +
        ' (' + sgn(a.luck) + ' BB).' + ((a.dogBeat || a.favLost) ? ' You won ' + plural(a.dogBeat || 0, 'all-in', 'all-ins') + ' as the underdog (' + sgn(a.dogBeatLuck || 0) +
        ' BB of luck) and lost ' + (a.favLost || 0) + ' as the favourite (' + sgn(a.favLostLuck || 0) + ' BB).' : ''));
    }
    if (s.rv.n) {
      const v = s.rv;
      out.push('Showdowns with no all-in before the last card: ' + v.n + '. You were ahead going into that card ' + v.ahead + ' times (' + pc(v.ahead / v.n) +
        ') and got sucked out on ' + v.beat + (v.ahead ? ' (' + pc(v.beat / v.ahead) + ' of them)' : '') + ', costing ' + sgn(v.beatLuck) + ' BB. You were behind ' + v.behind +
        ' times and sucked out ' + v.lucky + (v.behind ? ' (' + pc(v.lucky / v.behind) + ')' : '') + ', worth ' + sgn(v.luckyLuck) + ' BB.');
    }
    if (short) return out;
    if (res.hands) {
      out.push('Away from showdown — pots that ended without the cards being turned over, where nothing was left to luck at the end — your result was ' +
        sgn(res.netQuiet) + ' BB over ' + (res.hands - res.showdowns).toLocaleString() + ' hands (this includes every blind, ante and bring-in you gave up). At showdown it was ' +
        sgn(res.netShown) + ' BB over ' + res.showdowns + '.');
    }
    const skillBits = [];
    if (s.ai.n >= 10) skillBits.push(s.ai.fav / s.ai.n >= 0.6 ? 'you get your chips in good more often than not' : s.ai.fav / s.ai.n <= 0.4 ? 'you are getting your chips in behind more often than ahead — that part is not luck' : 'your all-ins are close to coin-flips on average');
    if (s.rv.n >= 20) skillBits.push(s.rv.ahead / s.rv.n >= 0.55 ? 'you usually reach the last card with the best of it' : s.rv.ahead / s.rv.n <= 0.45 ? 'you reach the last card behind more often than ahead, which means paying to draw' : 'you reach the last card ahead about half the time');
    if (skillBits.length) out.push('What is in your control: ' + skillBits.join('; ') + '.');
    if (s.n >= 5) out.push('How much is just noise: over ' + s.n + ' hands like these, luck alone typically swings about ±' + Math.round(s.sd) +
      ' BB, and twice that is not unusual. ' + (Math.abs(s.luck) <= s.sd ? 'Your ' + sgn(s.luck) + ' BB is well inside that — an ordinary run.'
        : Math.abs(s.luck) <= 2 * s.sd ? 'Your ' + sgn(s.luck) + ' BB is on the ' + (s.luck > 0 ? 'lucky' : 'unlucky') + ' side of normal.'
        : 'Your ' + sgn(s.luck) + ' BB is an unusually ' + (s.luck > 0 ? 'lucky' : 'unlucky') + ' run.'));
    if (s.approx) out.push(s.approx + ' of these are draw-game hands where an opponent drew on the last draw. Their cards before that draw are not in the history, so they are taken to have kept the best of what they showed — close, but not exact.');
    return out;
  }

  /* ---------- the screen ---------- */
  let hero = '', game = '', listMode = 'beat', data = null;
  const KEY = 'psreplayer.luck';

  let mineNames = [], shownCount = {}, libHands = [];

  // the player list: your accounts, then everyone whose cards were ever shown, most showdowns first
  function fillPlayers() {
    const hs = $('#lkHero'), q = ($('#lkFind').value || '').trim().toLowerCase();
    hs.innerHTML = '';
    const og1 = document.createElement('optgroup'); og1.label = 'Your accounts';
    mineNames.forEach(n => og1.appendChild(new Option(n + ' — ' + (shownCount[n] || 0) + ' showdowns', n)));
    hs.appendChild(og1);
    const others = Object.keys(shownCount).filter(n => !mineNames.includes(n) && (!q || n.toLowerCase().includes(q)))
      .sort((a, b) => shownCount[b] - shownCount[a] || a.localeCompare(b));
    const og2 = document.createElement('optgroup');
    og2.label = 'Opponents — ' + others.length.toLocaleString() + (q ? ' matching' : ' with a shown hand') + (others.length > 400 ? ' (top 400 listed; type to find)' : '');
    others.slice(0, 400).forEach(n => og2.appendChild(new Option(n + ' — ' + shownCount[n] + ' showdown' + (shownCount[n] === 1 ? '' : 's'), n)));
    hs.appendChild(og2);
    if ([...hs.options].some(o => o.value === hero)) hs.value = hero;
    else { const o = new Option(hero + ' — ' + (shownCount[hero] || 0) + ' showdowns', hero); hs.insertBefore(o, hs.firstChild); hs.value = hero; }
  }

  async function render() {
    const body = $('#lkBody');
    if (!PSHome.libOk) { body.innerHTML = '<div class="empty warn">The library is unavailable here.</div>'; return; }
    body.innerHTML = '<div class="empty">reading the hands…</div>';
    const lib = await PSHome.library();
    libHands = lib.hands;
    const heroes = {};
    shownCount = {};
    lib.hands.forEach(h => {
      if (h.hero) heroes[h.hero] = (heroes[h.hero] || 0) + 1;
      if (h.streets.includes('showdown')) for (const n in h.revealed) shownCount[n] = (shownCount[n] || 0) + 1;
    });
    mineNames = Object.keys(heroes).sort((a, b) => heroes[b] - heroes[a]);
    try { const st = JSON.parse(localStorage.getItem(KEY)) || {}; hero = hero || st.hero || ''; game = game || st.game || ''; } catch (e) { }
    if (!mineNames.includes(hero) && !shownCount[hero]) hero = mineNames[0] || '';
    fillPlayers();
    if (!hero) { body.innerHTML = '<div class="empty">No hands in the library yet — import hand histories first.</div>'; return; }
    data = await PSLuck.forHands(lib.hands, hero, (a, b) => { body.innerHTML = '<div class="empty">measuring showdowns… ' + a + ' / ' + b + '</div>'; });
    data.all = data.mine;
    const games = {};
    data.recs.forEach(r => { games[r.game] = games[r.game] || { label: r.label, n: 0 }; games[r.game].n++; });
    const gs = $('#lkGame');
    gs.innerHTML = '';
    gs.appendChild(new Option('All games — ' + data.recs.length + ' measured showdowns', ''));
    Object.keys(games).sort((a, b) => games[b].n - games[a].n).forEach(k => gs.appendChild(new Option(games[k].label + ' — ' + games[k].n, k)));
    if (game && !games[game]) game = '';
    gs.value = game;
    draw();
  }

  /* Everything above is written to "you".  For another player the same page is
     re-voiced once it is built — every text node, so tables and notes agree. */
  const VOICE = [
    [/\bowed you\b/g, 'owed them'], [/\bgave you\b/g, 'gave them'], [/\b[Aa]gainst you\b/g, m => m[0] + 'gainst them'], [/\b[Ff]or you\b/g, m => m[0] + 'or them'],
    [/\bmakes you\b/g, 'makes them'], [/\bto you\b/g, 'to them'], [/\bof yours\b/g, 'of theirs'], [/\byou are\b/g, 'they are'], [/\bYou are\b/g, 'They are'],
    [/\bYour\b/g, 'Their'], [/\byour\b/g, 'their'], [/\bYou\b/g, 'They'], [/\byou\b/g, 'they'],
  ];
  function revoice(root) {
    root.querySelectorAll('th').forEach(th => { if (th.textContent === 'You' && !th.closest('.lkAll')) { th.textContent = hero; th.className = 'lkWhoTh'; } });
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (w.nextNode()) nodes.push(w.currentNode);
    nodes.forEach(n => {
      if (n.parentNode.closest('.lkCards, .lkBoard, .lkAll, .lkWho, .lkWhoTh, select, option')) return;
      let t = n.nodeValue;
      VOICE.forEach(([re, to]) => { t = t.replace(re, to); });
      if (t !== n.nodeValue) n.nodeValue = t;
    });
    root.querySelectorAll('[title]').forEach(e => {
      if (e.closest('.lkAll')) return; let t = e.title; VOICE.forEach(([re, to]) => { t = t.replace(re, to); }); e.title = t; });
  }

  const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ hero, game })); } catch (e) { } };

  function draw() {
    const body = $('#lkBody');
    body.innerHTML = '';
    drawInto(body);
    if (!mineNames.includes(hero)) revoice(body);
  }

  function drawInto(body) {
    const own = mineNames.includes(hero);
    if (!own) body.appendChild(el('div', 'lkWho', hero + ' — measured from the hands in your histories where ' + hero + '’s cards were shown'));
    const recs = data.recs.filter(r => !game || r.game === game);
    // totals for the same slice of hands
    let res = data;
    if (game) {
      res = { hands: 0, showdowns: 0, netAll: 0, netShown: 0, netQuiet: 0, skipped: data.skipped };
      const shown = data.shownIds;
      data.all.forEach(h => {
        if (h.game.key !== game) return;
        const net = (PSEngine.netFor(h)[hero] || 0) / (h.bb || h.sb || 1);
        res.hands++; res.netAll += net;
        if (shown.has(h.id)) { res.showdowns++; res.netShown += net; } else res.netQuiet += net;
      });
    }
    const s = PSLuck.summarize(recs);
    if (!s.n) { body.appendChild(el('div', 'empty', 'No showdown with every hand face up for ' + hero + (game ? ' in this game' : '') + ' yet.')); return; }
    const X = extras(recs, data.all, hero, game);

    const k = el('div', 'trKpis');
    const kpi = (label, v, c, tip) => { const d = el('div', 'kpi ' + (c || '')); d.appendChild(el('b', null, v)); d.appendChild(el('small', null, label)); if (tip) d.title = tip; k.appendChild(d); };
    kpi('luck, BB', sgn(s.luck), cls(s.luck), 'What you actually won minus what your equity was worth, over every measured showdown');
    kpi('good luck · ' + s.nGood + ' hands', sgn(s.good), s.good ? 'up' : '', 'Every hand where the result beat the equity — suckouts, all-ins won as the underdog, and favourites that held up');
    kpi('bad luck · ' + s.nBad + ' hands', sgn(s.bad), s.bad ? 'dn' : '', 'Every hand where the result fell short of the equity — bad beats, all-ins lost as the favourite, draws that missed');
    kpi('showdown result, BB', sgn(s.net), cls(s.net));
    kpi('with luck removed, BB', sgn(s.net - s.luck), cls(s.net - s.luck), 'Your showdown result if every pot had paid exactly its equity');
    kpi('all-ins before the last card', String(s.ai.n));
    if (s.ai.n) kpi('money in as favourite', pc(s.ai.fav / s.ai.n), '', 'Skill: how often you were ahead when the chips went in');
    kpi('ahead at the last card', s.rv.n ? pc(s.rv.ahead / s.rv.n) : '—', '', 'Skill: how often you reached the last card with the better equity');
    kpi('sucked out on', String(s.rv.beat), s.rv.beat ? 'dn' : '');
    kpi('your suckouts', String(s.rv.lucky), s.rv.lucky ? 'up' : '');
    kpi('won without showdown, BB', sgn(res.netQuiet), cls(res.netQuiet), 'Pots that ended before the cards were turned over');
    if (own) kpi('deal luck, BB', sgn(X.dealTotal), cls(X.dealTotal), 'Whether you were dealt your share of the starting hands that pay');
    kpi('coolers against · for', X.coolA.length + ' · ' + X.coolF.length, '', 'Strong hands that lost to stronger ones without being outdrawn, and the reverse');
    if (X.life.n) kpi('tournament-life all-ins survived', X.life.lived + ' of ' + X.life.n, cls(X.life.lived - X.life.exp), 'Equity says ' + X.life.exp.toFixed(1));
    const mc = X.dec.mis.callDraw.bb + X.dec.mis.betDraw.bb;
    if (X.dec.all.n) kpi('mistake cost, BB', sgn(-mc), mc ? 'dn' : '', 'Calls without the price and bets made behind, with cards still to come — in hindsight, against the hands they held. Last-round calls and bets that lost are listed separately below.');
    body.appendChild(k);

    const ins = el('div', 'shNotes lkIns');
    const tone = Math.abs(s.luck) <= Math.max(0.5, s.sd / 2) ? '' : cls(s.luck);
    insights(res, s).concat(extraInsights(X)).forEach((x, i) => ins.appendChild(el('p', i === 0 ? 'lead ' + tone : null, x)));
    body.appendChild(ins);

    chart(body, recs);

    // the three kinds of hand
    body.appendChild(el('h4', 'sec', '1 · All-in before the last card'));
    if (s.ai.n) {
      const t = el('table', 'tbl stats');
      head(t, ['When the money went in', 'Hands', 'Avg equity', 'Pots equity says you win', 'Pots you won', 'Difference', 'Luck BB']);
      const row = (name, list) => {
        if (!list.length) return;
        const exp = list.reduce((a, r) => a + r.eq, 0), got = list.reduce((a, r) => a + r.share, 0), lk = list.reduce((a, r) => a + r.luck, 0);
        cells(t.insertRow(), [name, list.length, pc(exp / list.length), exp.toFixed(1), got.toFixed(1), sgn(got - exp), sgn(lk)], { 5: cls(got - exp), 6: cls(lk) });
      };
      const ai = recs.filter(r => r.kind === 'allin');
      row('As the favourite (50% or better)', ai.filter(r => r.cat === 'fav'));
      row('As the underdog', ai.filter(r => r.cat === 'dog'));
      row('All of them', ai);
      body.appendChild(t);
    } else body.appendChild(el('div', 'dim trNote', 'None with every hand shown.'));

    body.appendChild(el('h4', 'sec', '2 & 3 · Showdown, no all-in before the last card'));
    if (s.rv.n) {
      const rv = recs.filter(r => r.kind === 'river');
      const t = el('table', 'tbl stats');
      head(t, ['Going into the last card', 'Hands', 'Avg equity', 'Held / missed', 'Changed by the card', 'How often', 'Luck BB']);
      const ahead = rv.filter(r => r.eq > 0.5), behind = rv.filter(r => r.eq < 0.5), even = rv.filter(r => r.eq === 0.5);
      const sum = (l, f) => l.reduce((a, r) => a + f(r), 0);
      if (ahead.length) cells(t.insertRow(), ['You were ahead', ahead.length, pc(sum(ahead, r => r.eq) / ahead.length), s.rv.held - even.length + ' held up',
        s.rv.beat + ' sucked out on', pc(s.rv.beat / ahead.length), sgn(sum(ahead, r => r.luck))], { 6: cls(sum(ahead, r => r.luck)) });
      if (behind.length) cells(t.insertRow(), ['You were behind', behind.length, pc(sum(behind, r => r.eq) / behind.length), s.rv.missed + ' missed',
        s.rv.lucky + ' you sucked out', pc(s.rv.lucky / behind.length), sgn(sum(behind, r => r.luck))], { 6: cls(sum(behind, r => r.luck)) });
      if (even.length) cells(t.insertRow(), ['Dead even', even.length, '50%', '', '', '', sgn(sum(even, r => r.luck))]);
      body.appendChild(t);
      body.appendChild(el('div', 'dim trNote', '“Sucked out on” = you had more than half the equity with one card to come and ended with at least 30 points less of the pot than that. ' +
        '“You sucked out” is the mirror image. Hands that ended all-in on the last street are here too — no cards were left to come.'));
    } else body.appendChild(el('div', 'dim trNote', 'None with every hand shown.'));

    dealSection(body, X);
    coolerSection(body, X);
    lifeSection(body, X);
    decisionSection(body, X);

    // by game
    if (!game) {
      body.appendChild(el('h4', 'sec', 'By game'));
      const t = el('table', 'tbl stats');
      head(t, ['Game', 'Measured', 'All-ins', 'In as favourite', 'Ahead at last card', 'Sucked out on', 'Your suckouts', 'Showdown BB', 'Luck BB', 'Luck removed']);
      const by = {};
      recs.forEach(r => (by[r.game] = by[r.game] || []).push(r));
      Object.keys(by).sort((a, b) => by[b].length - by[a].length).forEach(g => {
        const x = PSLuck.summarize(by[g]);
        const tr = t.insertRow();
        cells(tr, [by[g][0].label, x.n, x.ai.n, x.ai.n ? pc(x.ai.fav / x.ai.n) : '—', x.rv.n ? pc(x.rv.ahead / x.rv.n) : '—', x.rv.beat, x.rv.lucky,
          sgn(x.net), sgn(x.luck), sgn(x.net - x.luck)], { 7: cls(x.net), 8: cls(x.luck), 9: cls(x.net - x.luck) });
        tr.style.cursor = 'pointer';
        tr.title = 'Show only this game';
        tr.onclick = () => { game = g; $('#lkGame').value = g; save(); draw(); };
      });
      body.appendChild(global.PSTourneys ? PSTourneys.sortable(t) : t);
    }

    // the hands
    body.appendChild(el('h4', 'sec', 'The hands'));
    const pick = el('div', 'lkPick');
    [['beat', 'Sucked out on (' + s.rv.beat + ')'], ['lucky', 'Your suckouts (' + s.rv.lucky + ')'], ['allin', 'All-ins (' + s.ai.n + ')'],
      ['coolA', 'Coolers against (' + X.coolA.length + ')'], ['coolF', 'Coolers for (' + X.coolF.length + ')'], ['life', 'Tournament-life all-ins (' + X.life.n + ')'],
      ['good', 'Every time you got lucky (' + s.nGood + ')'], ['bad', 'Every time you got unlucky (' + s.nBad + ')'],
      ['all', 'Everything measured (' + s.n + ')']]
      .forEach(([m, label]) => {
        const b = el('button', 'btn' + (listMode === m ? ' primary' : ''), label);
        b.onclick = () => { listMode = m; const y = body.scrollTop; draw(); $('#lkBody').scrollTop = y; };
        pick.appendChild(b);
      });
    body.appendChild(pick);
    let list = listMode === 'coolA' ? X.coolA : listMode === 'coolF' ? X.coolF : listMode === 'life' ? X.life.recs
      : listMode === 'good' ? recs.filter(r => r.luck >= 0.05) : listMode === 'bad' ? recs.filter(r => r.luck <= -0.05)
      : recs.filter(r => listMode === 'all' || (listMode === 'allin' ? r.kind === 'allin' : r.cat === listMode));
    list = list.slice().sort((a, b) => listMode === 'lucky' || listMode === 'good' || listMode === 'coolF' ? b.luck - a.luck : a.luck - b.luck);
    body.appendChild(handTable(list));

    const sk = data.skipped, notes = [];
    if (sk.cards) notes.push(plural(sk.cards, 'showdown', 'showdowns') + ' left out because someone’s cards are not in the history');
    if (sk['draw-early']) notes.push(sk['draw-early'] + ' draw-game all-ins with two or more draws still to come left out — the hands at that point cannot be reconstructed');
    notes.push('BB = big bets in limit games, big blinds otherwise, at the level the hand was played');
    body.appendChild(el('div', 'dim trNote', notes.join(' · ')));
    everyone(body);
  }

  /* ---------- everyone: who ran hot, who gets it in good ---------- */
  let board = null;                                     // the ranking, once measured
  function everyone(body) {
    const sec = el('div', 'lkAll');
    sec.dataset.keep = '1';
    sec.appendChild(el('h4', 'sec', 'Every player — luck and skill side by side'));
    const bar = el('div', 'lkPick');
    const min = document.createElement('input'); min.type = 'number'; min.min = 1; min.value = 8; min.className = 'lkMin';
    const lab = el('label', 'shMinL', 'at least '); lab.appendChild(min); lab.appendChild(document.createTextNode(' measured showdowns'));
    const go = el('button', 'btn primary', board ? 'Measure again' : 'Measure everyone');
    bar.appendChild(go); bar.appendChild(lab);
    sec.appendChild(bar);
    const out = el('div');
    sec.appendChild(out);
    const show = () => {
      out.innerHTML = '';
      const rows = board.filter(r => r.n >= (+min.value || 1));
      const t = el('table', 'tbl stats');
      head(t, ['Player', 'Measured', 'Luck BB', 'Showdown BB', 'Luck removed', 'All-ins', 'In as favourite', 'Ahead at last card', 'Good luck BB', 'Bad luck BB', 'Sucked out on', 'Suckouts', 'Without showdown BB', 'Mistake cost BB', 'Mistake % of BB in']);
      rows.forEach(r => {
        const tr = t.insertRow();
        cells(tr, [r.name + (mineNames.includes(r.name) ? '  (you)' : ''), r.n, sgn(r.luck), sgn(r.net), sgn(r.net - r.luck), r.ai, r.ai ? pc(r.fav / r.ai) : '—',
          r.rv ? pc(r.ahead / r.rv) : '—', sgn(r.good), sgn(r.bad), r.beat, r.lucky, sgn(r.quiet), sgn(-r.mis), r.bbIn ? (100 * r.mis / r.bbIn).toFixed(1) + '%' : '—'],
          { 2: cls(r.luck), 3: cls(r.net), 4: cls(r.net - r.luck), 8: 'up', 9: 'dn', 12: cls(r.quiet), 13: r.mis ? 'dn' : '' });
        tr.cells[0].className = 'pl';
        if (mineNames.includes(r.name)) tr.className = 'me';
        if (r.name === hero) tr.classList.add('me');
        tr.style.cursor = 'pointer'; tr.title = 'Show this player';
        tr.onclick = () => { hero = r.name; game = ''; save(); render().then(() => { $('#lkBody').scrollTop = 0; }); };
      });
      out.appendChild(el('div', 'plMeta', rows.length + ' of ' + board.length + ' players with a shown hand'));
      out.appendChild(global.PSTourneys ? PSTourneys.sortable(t) : t);
      out.appendChild(el('div', 'dim trNote', 'An opponent is measured only on the hands in your histories, and only where their cards were shown — so their samples are smaller than yours and lean toward hands they took to showdown. ' +
        '“Without showdown” is their result in every other hand they were dealt in at your tables.'));
    };
    go.onclick = async () => {
      const names = Object.keys(shownCount).sort((a, b) => shownCount[b] - shownCount[a]);
      const res = [];
      go.disabled = true;
      for (let i = 0; i < names.length; i++) {
        if (i % 5 === 0) { out.textContent = 'measuring ' + (i + 1) + ' of ' + names.length + ' players…'; await new Promise(r => setTimeout(r, 0)); }
        const d = await PSLuck.forHands(libHands, names[i]);
        if (!d.recs.length) continue;
        const x = PSLuck.summarize(d.recs), dq = PSLuck.decisionSummary(d.recs);
        res.push({ good: x.good, bad: x.bad, mis: dq.mis.callDraw.bb + dq.mis.betDraw.bb, bbIn: dq.all.bb, name: names[i], n: x.n, luck: x.luck, net: x.net, ai: x.ai.n, fav: x.ai.fav, rv: x.rv.n, ahead: x.rv.ahead, beat: x.rv.beat, lucky: x.rv.lucky, quiet: d.netQuiet });
      }
      board = res.sort((a, b) => b.n - a.n);
      go.disabled = false; go.textContent = 'Measure again';
      show();
    };
    min.onchange = () => { if (board) show(); };
    if (board) show();
    else out.appendChild(el('div', 'dim trNote', 'Measures every player whose cards were ever shown (' + Object.keys(shownCount).length.toLocaleString() + ' of them) the same way. The first run takes a little while; after that it is remembered.'));
    body.appendChild(sec);
  }

  /* the four further measures, for one slice of hands */
  function extras(recs, hands, who, gameKey) {
    const deal = PSLuck.dealLuck(gameKey ? hands.filter(h => h.game.key === gameKey) : hands, who);
    const str = PSLuck.strengths(recs);
    return {
      deal: deal, dealTotal: Object.values(deal).reduce((a, d) => a + d.luck, 0), dealN: Object.values(deal).reduce((a, d) => a + d.deals, 0),
      str: str, coolA: recs.filter(r => str[r.id].cool === 'against'), coolF: recs.filter(r => str[r.id].cool === 'for'),
      life: PSLuck.lifeSummary(recs), dec: PSLuck.decisionSummary(recs), game: gameKey, n: recs.length,
    };
  }

  function extraInsights(X, short) {
    const out = [];
    if (X.dealN >= 30) out.push('Deal luck: over ' + X.dealN.toLocaleString() + ' deals the mix of starting hands you were given was worth ' + sgn(X.dealTotal) +
      ' BB compared with an average run of cards' + (Math.abs(X.dealTotal) < 3 ? ' — you were dealt about your share.' : X.dealTotal > 0 ? ' — more of the hands that pay.' : ' — fewer of the hands that pay.'));
    if (X.coolA.length || X.coolF.length) {
      const a = X.coolA.reduce((t, r) => t + r.net, 0), f = X.coolF.reduce((t, r) => t + r.net, 0);
      out.push('Coolers: ' + plural(X.coolA.length, 'time', 'times') + ' a strong hand of yours ran into a stronger one (' + sgn(a) + ' BB), and ' +
        plural(X.coolF.length, 'time', 'times') + ' it went the other way (' + sgn(f) + ' BB). Nobody plays those differently — it is luck that shows up as neither a bad beat nor an all-in.');
    }
    if (X.life.n) {
      const L = X.life, d = L.lived - L.exp;
      out.push('Tournament life: you had every chip in before the last card ' + plural(L.n, 'time', 'times') + ', as the favourite in ' + L.fav + '. Equity says you survive ' +
        L.exp.toFixed(1) + ' of them; you survived ' + L.lived + (Math.abs(d) < 0.5 ? ' — as expected.' : d > 0 ? ' — ' + d.toFixed(1) + ' more lives than the cards owed you.' : ' — ' + (-d).toFixed(1) + ' fewer than the cards owed you.'));
    }
    if (!short && X.dec.all.n >= 20) {
      const A = X.dec.all;
      out.push('Decisions, against the hands they turned out to hold: ' + pc(A.goodBB / A.bb) + ' of the ' + Math.round(A.bb) + ' BB you put in went in with at least your fair share of the equity' +
        (A.calls ? '; ' + A.callsOk + ' of your ' + A.calls + ' calls (' + pc(A.callsOk / A.calls) + ') had the price' : '') +
        (A.bets ? '; ' + pc(A.betsAhead / A.bets) + ' of your bets and raises were made with the best of it' : '') + '.');
    }
    if (X.dec.all.n >= 20) {
      const M = X.dec.mis, odds = M.callDraw.bb + M.betDraw.bb, A = X.dec.all;
      out.push('Mistake cost: with cards still to come, ' + plural(M.callDraw.n, 'call', 'calls') + ' without the price cost ' + sgn(-M.callDraw.bb) + ' BB and ' +
        plural(M.betDraw.n, 'bet or raise', 'bets and raises') + ' made behind cost ' + sgn(-M.betDraw.bb) + ' BB — ' + sgn(-odds) + ' BB in all, ' +
        (A.bb ? (100 * odds / A.bb).toFixed(1) + '% of the ' + Math.round(A.bb) + ' BB you put in' : '') + '. Against that, your bets and raises made ahead earned ' + sgn(M.gain.bb) + ' BB.' +
        (short ? '' : ' On the last round, calls that lost and bets that were beaten came to ' + sgn(-(M.callEnd.bb + M.betEnd.bb)) + ' BB — the price of bluff-catching and value-betting, not necessarily errors.'));
    }
    return out;
  }

  function dealSection(body, X) {
    body.appendChild(el('h4', 'sec', '4 · Deal luck — were you dealt your share of the hands that pay?'));
    const games = Object.keys(X.deal);
    if (!games.length) {
      body.appendChild(el('div', 'dim trNote', mineNames.includes(hero) ? 'No starting hands to measure.'
        : 'Only measurable for an account whose hand histories these are: another player’s starting hand is seen only when it reaches a showdown, which is not a fair sample of what was dealt.'));
      return;
    }
    const t = el('table', 'tbl stats');
    if (X.game && X.deal[X.game]) {
      const d = X.deal[X.game];
      head(t, ['Kind of starting hand', 'Should come', 'Came', 'Difference', 'Worth per deal vs your average, BB', 'Deal luck BB']);
      d.rows.forEach(r => cells(t.insertRow(), [r.kind, r.exp.toFixed(1), r.got, sgn(r.got - r.exp), r.got ? sgn(r.worth) : '—', sgn(r.luck)], { 3: '', 5: cls(r.luck) }));
      cells(t.insertRow(), ['All ' + d.deals + ' deals', '', '', '', '', sgn(d.luck)], { 5: cls(d.luck) });
    } else {
      head(t, ['Game', 'Deals', 'Deal luck BB', 'Came most above its share', 'Came most below its share']);
      games.sort((a, b) => X.deal[b].deals - X.deal[a].deals).forEach(g => {
        const d = X.deal[g], by = d.rows.slice().sort((a, b) => (b.got - b.exp) - (a.got - a.exp));
        const up = by[0], dn = by[by.length - 1];
        const tr = t.insertRow();
        cells(tr, [d.label, d.deals, sgn(d.luck), up.kind + ' (' + sgn(up.got - up.exp) + ')', dn.kind + ' (' + sgn(dn.got - dn.exp) + ')'], { 2: cls(d.luck) });
        tr.style.cursor = 'pointer'; tr.title = 'Show this game kind by kind';
        tr.onclick = () => { game = g; $('#lkGame').value = g; if ($('#lkGame').value !== g) { $('#lkGame').value = ''; game = ''; } save(); draw(); };
      });
    }
    body.appendChild(global.PSTourneys ? PSTourneys.sortable(t) : t);
    body.appendChild(el('div', 'dim trNote', '“Should come” is how often a kind of hand is dealt in 20,000 random deals. A kind’s worth is what it makes you per deal above your average deal in that game, ' +
      'pulled toward the average when you have held it only a few times. Deal luck = (came − should come) × worth. It covers every hand you were dealt, not only showdowns.'));
  }

  function coolerSection(body, X) {
    body.appendChild(el('h4', 'sec', '5 · Coolers — a strong hand that ran into a stronger one'));
    const a = X.coolA.reduce((t, r) => t + r.net, 0), f = X.coolF.reduce((t, r) => t + r.net, 0);
    const t = el('table', 'tbl stats');
    head(t, ['', 'Hands', 'Result BB', 'Average strength of the losing hand']);
    const avg = (l, k) => l.length ? pc(l.reduce((x, r) => x + X.str[r.id][k], 0) / l.length) : '—';
    cells(t.insertRow(), ['Against you — your strong hand lost', X.coolA.length, sgn(a), avg(X.coolA, 'mine')], { 2: cls(a) });
    cells(t.insertRow(), ['For you — their strong hand lost', X.coolF.length, sgn(f), avg(X.coolF, 'theirs')], { 2: cls(f) });
    cells(t.insertRow(), ['Net', X.coolA.length + X.coolF.length, sgn(a + f), ''], { 2: cls(a + f) });
    body.appendChild(t);
    body.appendChild(el('div', 'dim trNote', 'Strength = the share of the pot a finished hand takes heads-up against the field: in stud and draw games, the hands actually shown down in that game here (cooler = top 20%); ' +
      'in flop games, random hole cards on the same board (cooler = beats 92%). It only counts when the loser was already behind before the last card — otherwise it is a suckout, counted above.'));
  }

  function lifeSection(body, X) {
    body.appendChild(el('h4', 'sec', '6 · Tournament life — all-in with every chip, cards still to come'));
    const L = X.life;
    if (!L.n) { body.appendChild(el('div', 'dim trNote', 'None with every hand shown.')); return; }
    const t = el('table', 'tbl stats');
    head(t, ['When the chips went in', 'Times', 'Avg chance to survive', 'Equity says you survive', 'You survived', 'Difference']);
    const row = (name, l) => {
      if (!l.length) return;
      const exp = l.reduce((a, r) => a + r.surv, 0), got = l.filter(r => r.lived).length;
      cells(t.insertRow(), [name, l.length, pc(exp / l.length), exp.toFixed(1), got, sgn(got - exp)], { 5: cls(got - exp) });
    };
    row('As the favourite', L.recs.filter(r => r.eq >= 0.5));
    row('As the underdog', L.recs.filter(r => r.eq < 0.5));
    row('All of them', L.recs);
    body.appendChild(t);
    body.appendChild(el('div', 'dim trNote', '“Survive” means getting any part of the pot back (in split-pot games half is enough). Across every measured tournament hand, luck came to ' +
      sgn(L.stackLuckAll) + ' stacks — each hand’s luck divided by the stack you started that hand with, so a flip for your whole stack counts as much as it mattered.'));
  }

  function decisionSection(body, X) {
    body.appendChild(el('h4', 'sec', '7 · Decisions — every time you put money in, against the hands they held'));
    const D = X.dec;
    if (!D.all.n) { body.appendChild(el('div', 'dim trNote', 'Nothing to measure.')); return; }
    const t = el('table', 'tbl stats');
    head(t, ['Stage of the hand', 'Times', 'BB put in', 'Avg equity', 'BB in with the best of it', 'Calls', 'Equity when calling', 'Price needed', 'Calls with the price', 'Bets & raises', 'Made ahead']);
    D.rows.concat([D.all]).forEach(r => {
      if (!r.n) return;
      cells(t.insertRow(), [r.name, r.n, r.bb.toFixed(0), pc(r.eqBB / r.bb), pc(r.goodBB / r.bb), r.calls, r.calls ? pc(r.callEq / r.calls) : '—',
        r.calls ? pc(r.callNeed / r.calls) : '—', r.calls ? pc(r.callsOk / r.calls) : '—', r.bets, r.bets ? pc(r.betsAhead / r.bets) : '—']);
    });
    body.appendChild(t);
    body.appendChild(el('div', 'dim trNote', 'Equity here is against the hands your opponents turned out to hold, with the cards as they stood at that point — the yardstick is “did the money go in good”, not ' +
      '“could you have known”. “With the best of it” = at least your fair share (half heads-up, a third three-way). A call “has the price” when its equity is at least bet ÷ (pot + bet). ' +
      'Only hands that reached a showdown with every hand shown are here, so folds — good and bad — are not. Draw games count only the last two betting rounds.'));
    // ---- what the decisions cost
    const M = D.mis;
    body.appendChild(el('h4', 'sec', '8 · Mistake cost — chips that went in bad'));
    const mt = el('table', 'tbl stats');
    head(mt, ['Kind of decision', 'Times', 'Cost BB', 'Average']);
    const mrow = (name, m) => cells(mt.insertRow(), [name, m.n, m.bb ? sgn(-m.bb) : '0.0', m.n ? sgn(-m.bb / m.n) : '—'], { 2: m.bb ? 'dn' : '' });
    mrow('Calls without the price, cards to come', M.callDraw);
    mrow('Bets and raises made behind, cards to come', M.betDraw);
    mrow('Last-round calls that lost', M.callEnd);
    mrow('Last-round bets and raises that were beaten', M.betEnd);
    cells(mt.insertRow(), ['Total mistake cost', M.callDraw.n + M.betDraw.n + M.callEnd.n + M.betEnd.n, sgn(-M.total), 'in ' + M.hands + ' of ' + X.n + ' hands'], { 2: M.total ? 'dn' : '' });
    cells(mt.insertRow(), ['For comparison — bets and raises made ahead', M.gain.n, sgn(M.gain.bb), M.gain.n ? sgn(M.gain.bb / M.gain.n) : '—'], { 2: 'up' });
    body.appendChild(mt);
    body.appendChild(el('div', 'dim trNote', 'A call without the price costs what folding would have saved: bet − equity × (pot + bet). A bet or raise made behind costs bet × (1 − players × equity), ' +
      'taking it that everyone who stayed matched it; made ahead, the same sum is a gain. The matching part of a raise is judged as a call. ' +
      'The first two rows are misjudged odds. The last two are calls and bets with nothing left to come that ran into a better hand — every one of those “costs” the whole bet in hindsight, and many were still right to make, ' +
      'so read them as the price of bluff-catching and value-betting, not as errors. As everywhere in this section: this is hindsight against the hands they held, and only showdowns with every hand shown.'));
    if (D.worst.length) {
      body.appendChild(el('div', 'dim trNote', 'The costliest decisions with cards still to come:'));
      const w = el('table', 'tbl stats lkHands');
      head(w, ['Date', 'Game', 'Stage', 'You', 'Opponents', 'What you did', 'BB', 'Into a pot of', 'Your equity', 'Needed', 'Cost BB']);
      D.worst.forEach(x => {
        const r = x.r, tr = w.insertRow();
        tr.insertCell().textContent = r.date ? new Date(r.date).toLocaleDateString() : '';
        tr.insertCell().textContent = r.label;
        tr.insertCell().textContent = PSLuck.STAGES[x.d.g];
        tr.insertCell().appendChild(cardsEl(r.cards));
        const them = tr.insertCell();
        r.oppCards.forEach((c, i) => { if (i) them.appendChild(el('span', 'dim', ' / ')); them.appendChild(cardsEl(c)); });
        cells(tr, [x.d.v === 'c' ? 'called' : x.d.v === 'b' ? 'bet' : 'raised', x.d.a.toFixed(1), x.d.p.toFixed(1), pc(x.d.e), pc(x.need), sgn(-x.cost)], { 5: 'dn' });
        tr.style.cursor = 'pointer'; tr.title = 'Open this hand in the replayer';
        tr.onclick = () => openHand(r.id);
      });
      body.appendChild(global.PSTourneys ? PSTourneys.sortable(w) : w);
    }
  }

  const head = (t, cols) => { const hr = t.insertRow(); cols.forEach(h => { const th = document.createElement('th'); th.textContent = h; hr.appendChild(th); }); };
  const cells = (tr, vals, classes) => vals.forEach((v, i) => { const c = tr.insertCell(); c.textContent = v; if (classes && classes[i]) c.className = classes[i]; });

  function handTable(list, opts) {
    const t = el('table', 'tbl stats lkHands');
    head(t, ['Date', 'Game', 'What happened', 'You', 'Opponents', 'Board', 'Equity', 'Result', 'Pot BB', 'Luck BB']);
    list.slice(0, 400).forEach(r => {
      const tr = t.insertRow();
      tr.insertCell().textContent = r.date ? new Date(r.date).toLocaleDateString() : '';
      tr.insertCell().textContent = r.label;
      tr.insertCell().textContent = (r.kind === 'allin' ? 'All-in ' + r.where + ', ' + (r.cat === 'fav' ? 'favourite' : 'underdog') : WHAT[r.cat]) + (r.approx ? ' ~' : '');
      tr.insertCell().appendChild(cardsEl(r.cards));
      const them = tr.insertCell();
      r.oppCards.forEach((c, i) => { if (i) them.appendChild(el('span', 'dim', ' / ')); them.appendChild(cardsEl(c)); });
      them.title = r.opp.join(', ');
      const bc = tr.insertCell(); bc.className = 'lkBoard'; bc.appendChild(cardsEl(r.board));
      tr.insertCell().textContent = pc(r.eq);
      tr.insertCell().textContent = outcome(r);
      tr.insertCell().textContent = r.pot.toFixed(1);
      const c = tr.insertCell(); c.textContent = sgn(r.luck); c.className = cls(r.luck);
      tr.style.cursor = 'pointer';
      tr.title = 'Open this hand in the replayer';
      tr.onclick = () => openHand(r.id);
    });
    if (!list.length) { const tr = t.insertRow(); const c = tr.insertCell(); c.colSpan = 10; c.className = 'dim'; c.textContent = 'None.'; }
    return global.PSTourneys && !(opts && opts.plain) ? PSTourneys.sortable(t) : t;
  }

  async function openHand(id) {
    const rec = await PSDB.get(id);
    if (!rec) return;
    PSApp.replaceHands(rec.raw, 'skill vs luck');
    PSHome.show('replayer');
  }

  /* ---------- the chart: what you won at showdown vs what your equity earned ----------
     Two lines on one axis (BB), cumulative over measured showdowns in date order.
     The gap between them is the luck.  Series colours are the validated dark-mode
     pair (blue / orange); identity is also carried by the legend and end labels. */
  const C_ACTUAL = '#3987e5', C_EQUITY = '#d95926';
  function chart(body, recs) {
    if (recs.length < 3) return;
    const W = 920, H = 250, L = 46, R = 118, T = 14, B = 26;
    let a = 0, e = 0;
    const act = [0], eqv = [0];
    recs.forEach(r => { a += r.net; e += r.net - r.luck; act.push(a); eqv.push(e); });
    const lo = Math.min(0, ...act, ...eqv), hiV = Math.max(0, ...act, ...eqv), span = (hiV - lo) || 1;
    const x = i => L + (W - L - R) * i / (act.length - 1), y = v => T + (H - T - B) * (1 - (v - lo) / span);
    const path = arr => arr.map((v, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1)).join(' ');
    const wrap = el('div', 'lkChart');
    wrap.appendChild(el('h4', 'sec', 'Showdown result against what your equity earned (cumulative BB)'));
    const lg = el('div', 'lkLegend');
    [[C_ACTUAL, 'What you actually won'], [C_EQUITY, 'What your equity was worth (luck removed)']].forEach(([c, t]) => {
      const i = el('span', 'lg'); const sw = el('i'); sw.style.background = c; i.appendChild(sw); i.appendChild(document.createTextNode(t)); lg.appendChild(i);
    });
    wrap.appendChild(lg);
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H); svg.setAttribute('class', 'lkSvg'); svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Cumulative showdown result in big bets: actual ' + sgn(a) + ', equity-adjusted ' + sgn(e));
    const mk = (tag, attrs, text) => { const n = document.createElementNS(NS, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); if (text != null) n.textContent = text; svg.appendChild(n); return n; };
    // recessive grid: a few round ticks and the zero line
    const step = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000].find(s => span / s <= 5) || 2000;
    for (let v = Math.ceil(lo / step) * step; v <= hiV; v += step) {
      mk('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: v === 0 ? 'zero' : 'grid' });
      mk('text', { x: L - 6, y: y(v) + 3.5, class: 'tick', 'text-anchor': 'end' }, String(v));
    }
    mk('text', { x: L, y: H - 6, class: 'tick' }, '1');
    mk('text', { x: W - R, y: H - 6, class: 'tick', 'text-anchor': 'end' }, recs.length + ' showdowns');
    mk('path', { d: path(eqv), fill: 'none', stroke: C_EQUITY, 'stroke-width': 2, 'stroke-linejoin': 'round' });
    mk('path', { d: path(act), fill: 'none', stroke: C_ACTUAL, 'stroke-width': 2, 'stroke-linejoin': 'round' });
    // direct labels at the line ends, nudged apart if they collide
    let ya = y(a), ye = y(e);
    if (Math.abs(ya - ye) < 13) { const m = (ya + ye) / 2; if (ya <= ye) { ya = m - 7; ye = m + 7; } else { ya = m + 7; ye = m - 7; } }
    mk('circle', { cx: x(act.length - 1), cy: y(a), r: 4, fill: C_ACTUAL, class: 'ring' });
    mk('circle', { cx: x(act.length - 1), cy: y(e), r: 4, fill: C_EQUITY, class: 'ring' });
    mk('text', { x: W - R + 9, y: ya + 4, class: 'endLbl' }, 'actual ' + sgn(a));
    mk('text', { x: W - R + 9, y: ye + 4, class: 'endLbl' }, 'equity ' + sgn(e));
    // hover: crosshair + tooltip
    const cross = mk('line', { y1: T, y2: H - B, class: 'cross', visibility: 'hidden' });
    const da = mk('circle', { r: 4, fill: C_ACTUAL, class: 'ring', visibility: 'hidden' });
    const de = mk('circle', { r: 4, fill: C_EQUITY, class: 'ring', visibility: 'hidden' });
    const tip = el('div', 'lkTip');
    const hit = mk('rect', { x: L, y: T, width: W - L - R, height: H - T - B, fill: 'transparent' });
    const move = ev => {
      const box = svg.getBoundingClientRect();
      const px = (ev.clientX - box.left) * W / box.width;
      const i = Math.max(1, Math.min(act.length - 1, Math.round((px - L) / (W - L - R) * (act.length - 1))));
      const r = recs[i - 1];
      [cross, da, de].forEach(n => n.setAttribute('visibility', 'visible'));
      cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i));
      da.setAttribute('cx', x(i)); da.setAttribute('cy', y(act[i]));
      de.setAttribute('cx', x(i)); de.setAttribute('cy', y(eqv[i]));
      tip.innerHTML = '';
      tip.appendChild(el('b', null, '#' + i + ' · ' + (r.date ? new Date(r.date).toLocaleDateString() : '') + ' · ' + r.label));
      tip.appendChild(el('div', null, 'actual ' + sgn(act[i]) + ' BB · equity ' + sgn(eqv[i]) + ' BB'));
      tip.appendChild(el('div', 'dim', 'this hand: ' + pc(r.eq) + ' equity, ' + outcome(r) + ', luck ' + sgn(r.luck) + ' BB'));
      tip.style.display = 'block';
      const wx = (x(i) / W) * box.width;
      tip.style.left = Math.min(box.width - 250, Math.max(0, wx + 12)) + 'px';
      tip.style.top = '34px';
    };
    hit.addEventListener('mousemove', move);
    hit.addEventListener('mouseleave', () => { [cross, da, de].forEach(n => n.setAttribute('visibility', 'hidden')); tip.style.display = 'none'; });
    hit.addEventListener('click', ev => { const box = svg.getBoundingClientRect(); const px = (ev.clientX - box.left) * W / box.width;
      const i = Math.max(1, Math.min(act.length - 1, Math.round((px - L) / (W - L - R) * (act.length - 1)))); openHand(recs[i - 1].id); });
    const holder = el('div', 'lkSvgWrap');
    holder.appendChild(svg); holder.appendChild(tip);
    wrap.appendChild(holder);
    wrap.appendChild(el('div', 'dim trNote', 'When the blue line is above the orange one you have run better than your equity; below it, worse. Hover for a hand, click to open it.'));
    body.appendChild(wrap);
  }

  /* ---------- the box on a tournament's page ---------- */
  async function tournamentBox(box, tid, name) {
    box.innerHTML = '';
    box.appendChild(el('h4', 'sec', 'Your tournament'));
    const wait = el('div', 'dim trNote', 'reading the hands…');
    box.appendChild(wait);
    const lib = await PSHome.library();
    const hs = lib.hands.filter(h => h.tourney === tid);
    if (!hs.length) { wait.textContent = 'No hand histories for this tournament in the library — import them to see how you played it and how the cards ran.'; return; }
    const tally = {};
    hs.forEach(h => { if (h.hero) tally[h.hero] = (tally[h.hero] || 0) + 1; });
    const who = tally[name] ? name : Object.keys(tally).sort((a, b) => tally[b] - tally[a])[0];
    const res = await PSLuck.forHands(hs, who);
    const s = PSLuck.summarize(res.recs);
    wait.remove();
    const mine = hs.filter(h => h.hero === who).sort((a, b) => (a.dateObj || 0) - (b.dateObj || 0));
    let vpip = 0, opp = 0, wonPots = 0;
    mine.forEach(h => { const r = PSStats.rowsFor(h)[who]; if (!r) return; opp += r.vpipOpp ? 1 : 0; vpip += r.vpip; wonPots += r.won; });
    const games = {};
    mine.forEach(h => { games[h.game.label] = (games[h.game.label] || 0) + 1; });

    const k = el('div', 'trKpis');
    const kpi = (label, v, c, tip) => { const d = el('div', 'kpi ' + (c || '')); d.appendChild(el('b', null, v)); d.appendChild(el('small', null, label)); if (tip) d.title = tip; k.appendChild(d); };
    kpi('hands', String(mine.length));
    kpi('played', opp ? pc(vpip / opp) : '—', '', 'Hands where you put money in by choice on the first round');
    kpi('pots won', String(wonPots));
    kpi('showdowns', res.showdowns + (s.n ? ' · won ' + (s.ai.got + s.rv.got).toFixed(1) : ''));
    kpi('without showdown, BB', sgn(res.netQuiet), cls(res.netQuiet));
    kpi('at showdown, BB', sgn(res.netShown), cls(res.netShown));
    if (s.n) {
      kpi('luck, BB', sgn(s.luck), cls(s.luck), 'What you won minus what your equity was worth, over the measured showdowns');
      kpi('good · bad luck, BB', sgn(s.good) + ' · ' + sgn(s.bad), '', s.nGood + ' hands went your way, ' + s.nBad + ' went against you');
      if (s.ai.n) kpi('all-ins · as favourite', s.ai.n + ' · ' + s.ai.fav);
      kpi('sucked out on · your suckouts', s.rv.beat + ' · ' + s.rv.lucky);
    }
    box.appendChild(k);
    const gl = Object.keys(games);
    if (gl.length > 1) box.appendChild(el('div', 'dim trNote', gl.sort((a, b) => games[b] - games[a]).map(g => g + ' ×' + games[g]).join(' · ')));

    const ins = el('div', 'shNotes lkIns');
    const tone = Math.abs(s.luck) <= Math.max(0.5, s.sd / 2) ? '' : cls(s.luck);
    const X = extras(res.recs, mine, who, '');
    kpi('deal luck, BB', sgn(X.dealTotal), cls(X.dealTotal), 'Whether you were dealt your share of the starting hands that pay');
    if (X.coolA.length || X.coolF.length) kpi('coolers against · for', X.coolA.length + ' · ' + X.coolF.length);
    if (X.life.n) kpi('life all-ins survived', X.life.lived + ' of ' + X.life.n, cls(X.life.lived - X.life.exp), 'Equity says ' + X.life.exp.toFixed(1));
    if (X.dec.all.n) kpi('mistake cost, BB', sgn(-(X.dec.mis.callDraw.bb + X.dec.mis.betDraw.bb)), X.dec.mis.callDraw.bb + X.dec.mis.betDraw.bb ? 'dn' : '',
      'Calls without the price and bets made behind, with cards still to come — in hindsight, against the hands they held');
    if (X.dec.all.n) kpi('BB in with the best of it', pc(X.dec.all.goodBB / X.dec.all.bb), '', 'Share of the money you put in that went in with at least your fair share of equity, against the hands they held');
    insights(res, s, true).concat(extraInsights(X, true)).forEach((x, i) => ins.appendChild(el('p', i === 0 && s.n ? 'lead ' + tone : null, x)));
    // how it ended
    const last = mine[mine.length - 1];
    if (last) {
      const m = PSEngine.moneyFor(last), seat = last.seats.find(z => z.name === who);
      const bust = seat && m.got[who] === 0 && m.put[who] >= seat.startStack - 0.5;
      const r = res.recs.find(z => z.id === last.id);
      if (bust) {
        const p = el('p', null, 'You went out on the last hand here' + (r
          ? ': ' + (r.kind === 'allin' ? 'all-in ' + r.where : 'at showdown') + ' with ' + pc(r.eq) + ' equity' +
            (r.kind !== 'allin' ? ' going into the last card' : '') + ' — ' + (r.eq >= 0.6 ? 'that one was bad luck.' : r.eq <= 0.4 ? 'you were behind when the money went in.' : 'close to a coin-flip.')
          : ' — the other hand was not shown, so it cannot be measured.') + ' ');
        const a = el('a', 'pl', 'Open it');
        a.href = '#'; a.onclick = e => { e.preventDefault(); openHand(last.id); };
        p.appendChild(a);
        ins.appendChild(p);
      }
    }
    box.appendChild(ins);
    if (res.recs.length) {
      const big = res.recs.slice().sort((a, b) => Math.abs(b.luck) - Math.abs(a.luck)).slice(0, 6);
      box.appendChild(el('div', 'dim trNote', 'The hands where luck moved the most chips:'));
      box.appendChild(handTable(big, { plain: true }));
    }
  }

  function init() {
    $('#lkHero').onchange = e => { hero = e.target.value; game = ''; save(); render(); };
    $('#lkFind').oninput = () => fillPlayers();
    $('#lkGame').onchange = e => { game = e.target.value; save(); draw(); };
  }

  global.PSLuckUI = { init, render, tournamentBox, insights };
})(window);
