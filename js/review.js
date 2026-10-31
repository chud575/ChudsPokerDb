/* ===========================================================================
   review.js — one tournament, reviewed: how the stack moved, the hands that
   mattered, and what was luck, what was a mistake and what was well played.

   It reuses what the rest of the app already measures:
     luck.js       equity at showdown, luck, the cost of each bet and call
     starthands.js what kind of starting hand it was
     evtables.js   what the HORSE+ EV table says that hand is worth
     solver.js     (on request) every decision graded by the HORSE+ solver

   Every hand gets at most one tag, in this order of precedence:
     mistake   money that went in bad with cards still to come
     unlucky   ahead and outdrawn, or an all-in lost as the favourite
     lucky     the reverse
     cooler    a strong hand that ran into a stronger one
     value     bet ahead and got paid
     catch     called the last bet and was right
     steal     won a pot of some size without a showdown
     look      nothing provably wrong, but worth replaying: chips put in and
               then given up, a last-round call that lost, a weak start played
               at a loss, a strong start folded

   "Mistake" here is hindsight against the hands the opponents held, and only
   exists for showdowns with every hand shown.  The solver check is the one
   part that judges a decision on what you could see.
   =========================================================================== */
(function (global) {
  'use strict';
  const el = (t, c, x) => { const e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; };
  const SUIT = { c: '♣', d: '♦', h: '♥', s: '♠' };
  const sgn = v0 => { const d = Math.abs(v0) >= 100 ? 0 : 1, v = +v0.toFixed(d) || 0; return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(d); };
  const pc = v => Math.round(v * 100) + '%';
  const STAGE = ['on the first round', 'in the middle rounds', 'with one card to come', 'on the last round'];
  const STREET = { preflop: 'before the flop', flop: 'on the flop', turn: 'on the turn', river: 'on the river',
    '3rd': 'on 3rd street', '4th': 'on 4th street', '5th': 'on 5th street', '6th': 'on 6th street', '7th': 'on 7th street',
    predraw: 'before the draw', draw1: 'after the first draw', draw2: 'after the second draw', draw3: 'after the last draw' };

  /* hands: one tournament's hands for `who`, any order; res: PSLuck.forHands() for them */
  function analyze(hands, who, res) {
    const mine = hands.filter(h => h.seats.some(z => z.name === who && z.inHand)).sort((a, b) => (a.dateObj || 0) - (b.dateObj || 0));
    const recOf = {};
    res.recs.forEach(r => { recOf[r.id] = r; });
    const str = PSLuck.strengths(res.recs);
    const rows = [];
    let peak = null, low = null;
    mine.forEach((h, i) => {
      const unit = h.bb || h.sb || 1;
      const seat = h.seats.find(z => z.name === who) || {};
      const money = PSEngine.moneyFor(h);
      const net = (money.got[who] - money.put[who]) / unit;
      const st = PSStats.rowsFor(h)[who] || {};
      const rec = recOf[h.id] || null;
      const cls = h.hero === who && global.PSStart ? PSStart.classify(h) : null;
      const n = h.seats.filter(z => z.inHand).length;
      const tk = cls && global.PSEV ? PSEV.tableKey(h.game.key, cls.cards) : null;
      const eq = tk && PSEV.table(h.game.key) ? PSEV.eq(h.game.key, tk, n) : null;
      const fair = eq != null ? 1 / PSEV.clampN(h.game.key, n) : null;
      // where the hero folded, if they did
      let street = 'setup', foldAt = null;
      for (const e of h.events) {
        if (e.t === 'street') street = e.id;
        else if (e.t === 'act' && e.player === who && e.verb === 'fold') { foldAt = street; break; }
      }
      const row = {
        h: h, i: i + 1, id: h.id, unit: unit, net: net, stack: (seat.startStack || 0), stackBB: (seat.startStack || 0) / unit,
        put: money.put[who] / unit, level: h.levelRoman || '', game: h.game.label, rec: rec, played: !!st.vpip, foldAt: foldAt,
        cards: rec ? rec.cards : (cls ? cls.cards : null), kind: cls ? cls.group : '', exact: cls ? cls.exact : '',
        eq: eq, fair: fair, tag: '', why: '', weight: 0,
      };
      row.swing = seat.startStack ? (money.got[who] - money.put[who]) / seat.startStack : 0;
      if (!peak || row.stack > peak.stack) peak = row;
      if (!low || row.stack < low.stack) low = row;

      // ---- one tag per hand
      const tagIt = (tag, why, weight) => { if (!row.tag) { row.tag = tag; row.why = why; row.weight = weight; } };
      if (rec) {
        let cost = 0, gain = 0, worst = null, caught = null, paid = null;
        (rec.dec || []).forEach(d => {
          const c = PSLuck.costOf(d, rec.np || 2);
          if (d.g < 3) { cost += c.cost; if (c.cost > 0 && (!worst || c.cost > worst.c)) worst = { d: d, c: c.cost }; }
          gain += c.gain;
          if (d.g === 3 && d.v === 'c') { if (d.e >= 0.5) caught = d; else paid = d; }
        });
        row.cost = cost; row.gain = gain;
        if (cost >= 0.5 && worst) {
          const d = worst.d, need = d.v === 'c' ? d.a / (d.p + d.a) : 1 / (rec.np || 2);
          tagIt('mistake', (d.v === 'c' ? 'Called ' : d.v === 'b' ? 'Bet ' : 'Raised ') + d.a.toFixed(1) + ' BB ' + STAGE[d.g] + ' with ' + pc(d.e) +
            ' equity' + (d.v === 'c' ? ' — the price needed ' + pc(need) : ' — behind, against a fair share of ' + pc(need)) +
            '. Money in bad this hand: ' + sgn(-cost) + ' BB.', cost + Math.abs(row.swing) * 4);
        }
        const beat = rec.kind === 'allin' ? rec.cat === 'fav' && rec.share < 0.5 : rec.cat === 'beat';
        const lucky = rec.kind === 'allin' ? rec.cat === 'dog' && rec.share > 0.5 : rec.cat === 'lucky';
        if (beat && rec.luck <= -1) tagIt('unlucky', (rec.kind === 'allin' ? 'All-in ' + rec.where + ' with ' : 'Went to the last card with ') + pc(rec.eq) +
          ' equity and lost — ' + sgn(rec.luck) + ' BB against what the hand was worth.', Math.abs(rec.luck) + Math.abs(row.swing) * 4);
        if (lucky && rec.luck >= 1) tagIt('lucky', (rec.kind === 'allin' ? 'All-in ' + rec.where + ' with only ' : 'Went to the last card with only ') + pc(rec.eq) +
          ' equity and won — ' + sgn(rec.luck) + ' BB more than the hand was worth.', Math.abs(rec.luck) + Math.abs(row.swing) * 4);
        const s2 = str[rec.id];
        if (s2 && s2.cool === 'against') tagIt('cooler', 'A strong hand (better than ' + pc(s2.mine) + ' of the field) that was behind all the way. Nothing to fix.', Math.abs(net) + Math.abs(row.swing) * 4);
        if (rec.share >= 0.75 && gain >= 1.5) tagIt('value', 'Bet and raised with the best of it and got paid — ' + sgn(gain) + ' BB of value from betting ahead.', gain + Math.abs(row.swing) * 4);
        if (caught && net > 0) tagIt('catch', 'Called ' + caught.a.toFixed(1) + ' BB on the last round and was right.', net + Math.abs(row.swing) * 4);
        if (paid && net <= -3) tagIt('look', 'Called the last bet and lost — ' + sgn(net) + ' BB in the hand. Was the call worth its price (' + pc(paid.a / (paid.p + paid.a)) + ')?', Math.abs(net));
      } else {
        if (net >= 2.5) tagIt('steal', 'Won ' + sgn(net) + ' BB without a showdown.', net + Math.abs(row.swing) * 4);
        if (foldAt && row.put >= 3) tagIt('look', 'Put in ' + row.put.toFixed(1) + ' BB and folded ' + (STREET[foldAt] || '') + '. Either the fold or the money before it deserves a second look.', row.put);
      }
      if (eq != null) {
        if (row.played && eq < fair - 0.03 && net <= -1.5) tagIt('look', 'Played ' + row.exact + ' — the EV table gives it ' + pc(eq) + ' against a fair share of ' + pc(fair) + ' at ' + n + ' players — and lost ' + sgn(net) + ' BB.', Math.abs(net));
        if (!row.played && foldAt && eq >= fair + 0.1) tagIt('look', 'Folded ' + row.exact + ' on the first round — the EV table gives it ' + pc(eq) + ' against a fair share of ' + pc(fair) + ' at ' + n + ' players.', (eq - fair) * 10);
      }
      rows.push(row);
    });

    const by = tag => rows.filter(r => r.tag === tag).sort((a, b) => b.weight - a.weight);
    const out = {
      who: who, rows: rows, peak: peak, low: low,
      mistakes: by('mistake'), unlucky: by('unlucky'), lucky: by('lucky'), coolers: by('cooler'),
      good: rows.filter(r => r.tag === 'value' || r.tag === 'catch' || r.tag === 'steal').sort((a, b) => b.weight - a.weight),
      look: by('look'),
    };
    // starting hands against the EV tables
    const rated = rows.filter(r => r.eq != null);
    const weak = rated.filter(r => r.played && r.eq < r.fair - 0.03), strong = rated.filter(r => r.eq >= r.fair + 0.1);
    out.starts = {
      rated: rated.length, played: rows.filter(r => r.played).length,
      weakPlayed: weak.length, weakNet: weak.reduce((a, r) => a + r.net, 0),
      strong: strong.length, strongPlayed: strong.filter(r => r.played).length, strongNet: strong.reduce((a, r) => a + r.net, 0),
    };
    out.mistakeCost = rows.reduce((a, r) => a + (r.cost || 0), 0);
    out.valueGain = rows.reduce((a, r) => a + (r.gain || 0), 0);
    return out;
  }

  /* the review in sentences */
  function summary(R, res, s) {
    const out = [], n = R.rows.length;
    if (!n) return out;
    const first = R.rows[0], last = R.rows[n - 1];
    out.push(n + ' hands. You started with ' + Math.round(first.stackBB) + ' BB, peaked at ' + Math.round(R.peak.stack).toLocaleString() + ' chips on hand ' + R.peak.i +
      (R.low.i > 1 ? ', and were lowest at ' + Math.round(R.low.stack).toLocaleString() + ' on hand ' + R.low.i : '') + '.');
    if (s.n) {
      const part = Math.abs(s.luck) <= Math.max(0.5, s.sd / 2) ? 'Luck was roughly neutral (' + sgn(s.luck) + ' BB)'
        : s.luck > 0 ? 'The cards helped: ' + sgn(s.luck) + ' BB above your equity' : 'The cards hurt: ' + sgn(s.luck) + ' BB below your equity';
      out.push(part + ' over ' + s.n + ' measured showdowns' + (R.unlucky.length || R.lucky.length ? ' — ' + R.unlucky.length + ' real bad beats, ' + R.lucky.length + ' real suckouts of your own' : '') + '.');
    }
    if (R.mistakeCost >= 0.5) out.push('Money that went in bad with cards to come cost ' + sgn(-R.mistakeCost) + ' BB' +
      (R.mistakes[0] ? '; the worst was hand ' + R.mistakes[0].i + '.' : '.') + ' Bets and raises made ahead earned ' + sgn(R.valueGain) + ' BB.');
    else if (s.n) out.push('No measurable money went in bad with cards to come. Bets and raises made ahead earned ' + sgn(R.valueGain) + ' BB.');
    out.push('Without a showdown your result was ' + sgn(res.netQuiet) + ' BB; at showdown ' + sgn(res.netShown) + ' BB.');
    const S = R.starts;
    if (S.rated) out.push('Starting hands, against the HORSE+ EV table: you played ' + S.played + ' of ' + n + ' hands (' + pc(S.played / n) + '). ' +
      (S.weakPlayed ? S.weakPlayed + ' of those were below their fair share on the cards (' + sgn(S.weakNet) + ' BB between them). ' : 'None of the hands you played was below its fair share on the cards. ') +
      (S.strong ? 'You were dealt ' + S.strong + ' clearly strong starts and played ' + S.strongPlayed + ' of them (' + sgn(S.strongNet) + ' BB).' : ''));
    return out;
  }

  /* ---------- on the page ---------- */
  const TAGS = { mistake: 'Mistake', unlucky: 'Unlucky', lucky: 'Lucky', cooler: 'Cooler', value: 'Value', catch: 'Good call', steal: 'No showdown', look: 'Look again' };
  function cardsEl(cards) {
    const w = el('span', 'lkCards');
    (cards || []).forEach(c => w.appendChild(el('span', 'cd su-' + c[1], c[0] + SUIT[c[1]])));
    return w;
  }

  async function openIn(tid, id) {
    const now = PSApp.loaded();
    if (!(now.tourneys.length === 1 && now.tourneys[0] === tid)) { if (!(await PSHome.openTourney(tid))) return; }
    else PSHome.show('replayer');
    PSApp.openById(id);
  }

  function list(box, title, rows, tid, max) {
    if (!rows.length) return;
    box.appendChild(el('h4', 'sec', title + ' (' + rows.length + ')'));
    const t = el('table', 'tbl stats rvTbl');
    rows.slice(0, max || 8).forEach(r => {
      const tr = t.insertRow();
      tr.insertCell().textContent = '#' + r.i;
      const tg = tr.insertCell(); tg.appendChild(el('span', 'rvTag ' + r.tag, TAGS[r.tag]));
      tr.insertCell().textContent = r.game + (r.level ? ' · L' + r.level : '');
      tr.insertCell().appendChild(cardsEl(r.cards));
      const w = tr.insertCell(); w.className = 'why'; w.textContent = r.why;
      const nc = tr.insertCell(); nc.textContent = sgn(r.net) + ' BB'; nc.className = r.net > 0 ? 'up' : r.net < 0 ? 'dn' : '';
      tr.style.cursor = 'pointer'; tr.title = 'Replay hand ' + r.i + ' of this tournament';
      tr.onclick = () => openIn(tid, r.id);
    });
    box.appendChild(t);
    if (rows.length > (max || 8)) box.appendChild(el('div', 'dim trNote', 'and ' + (rows.length - (max || 8)) + ' more'));
  }

  /* the stack, hand by hand — one line, so the title names it and there is no legend */
  function stackChart(box, R, tid) {
    const rows = R.rows;
    if (rows.length < 4) return;
    const W = 920, H = 210, L = 58, RM = 16, T = 12, B = 24, COL = '#3987e5';
    const mark = { mistake: '#ff6b6b', unlucky: '#e6d38a', lucky: '#e6d38a', cooler: '#e6d38a', value: '#4fd08a', catch: '#4fd08a', steal: '#4fd08a' };
    const hiV = Math.max(...rows.map(r => r.stack)), span = hiV || 1;
    const x = i => L + (W - L - RM) * i / (rows.length - 1), y = v => T + (H - T - B) * (1 - v / span);
    const wrap = el('div', 'lkChart');
    wrap.appendChild(el('h4', 'sec', 'Your stack at the start of each hand (chips)'));
    const NS = 'http://www.w3.org/2000/svg', svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H); svg.setAttribute('class', 'lkSvg'); svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Stack by hand: started ' + rows[0].stack + ', peak ' + hiV);
    const mk = (tag, a, text) => { const n = document.createElementNS(NS, tag); for (const k in a) n.setAttribute(k, a[k]); if (text != null) n.textContent = text; svg.appendChild(n); return n; };
    const step = [500, 1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000, 500000].find(s => span / s <= 5) || 1000000;
    for (let v = 0; v <= hiV; v += step) {
      mk('line', { x1: L, x2: W - RM, y1: y(v), y2: y(v), class: v === 0 ? 'zero' : 'grid' });
      mk('text', { x: L - 6, y: y(v) + 3.5, class: 'tick', 'text-anchor': 'end' }, v.toLocaleString());
    }
    mk('text', { x: L, y: H - 6, class: 'tick' }, 'hand 1');
    mk('text', { x: W - RM, y: H - 6, class: 'tick', 'text-anchor': 'end' }, 'hand ' + rows.length);
    mk('path', { d: rows.map((r, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(r.stack).toFixed(1)).join(' '), fill: 'none', stroke: COL, 'stroke-width': 2, 'stroke-linejoin': 'round' });
    rows.forEach((r, i) => { if (mark[r.tag]) mk('circle', { cx: x(i), cy: y(r.stack), r: 4, fill: mark[r.tag], class: 'ring' }); });
    const cross = mk('line', { y1: T, y2: H - B, class: 'cross', visibility: 'hidden' });
    const dot = mk('circle', { r: 4, fill: COL, class: 'ring', visibility: 'hidden' });
    const tip = el('div', 'lkTip');
    const hit = mk('rect', { x: L, y: T, width: W - L - RM, height: H - T - B, fill: 'transparent' });
    const at = ev => { const b = svg.getBoundingClientRect(); return Math.max(0, Math.min(rows.length - 1, Math.round(((ev.clientX - b.left) * W / b.width - L) / (W - L - RM) * (rows.length - 1)))); };
    hit.addEventListener('mousemove', ev => {
      const i = at(ev), r = rows[i], b = svg.getBoundingClientRect();
      [cross, dot].forEach(n => n.setAttribute('visibility', 'visible'));
      cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); dot.setAttribute('cx', x(i)); dot.setAttribute('cy', y(r.stack));
      tip.innerHTML = '';
      tip.appendChild(el('b', null, 'Hand ' + r.i + ' · ' + r.game + (r.level ? ' · level ' + r.level : '')));
      tip.appendChild(el('div', null, Math.round(r.stack).toLocaleString() + ' chips (' + Math.round(r.stackBB) + ' BB) · this hand ' + sgn(r.net) + ' BB'));
      if (r.tag) tip.appendChild(el('div', 'dim', TAGS[r.tag] + ' — ' + r.why));
      tip.style.display = 'block';
      tip.style.left = Math.min(b.width - 250, Math.max(0, x(i) / W * b.width + 12)) + 'px'; tip.style.top = '30px';
    });
    hit.addEventListener('mouseleave', () => { [cross, dot].forEach(n => n.setAttribute('visibility', 'hidden')); tip.style.display = 'none'; });
    hit.addEventListener('click', ev => openIn(tid, rows[at(ev)].id));
    const holder = el('div', 'lkSvgWrap'); holder.appendChild(svg); holder.appendChild(tip);
    wrap.appendChild(holder);
    const lg = el('div', 'lkLegend');
    [['#ff6b6b', 'mistake'], ['#e6d38a', 'luck or a cooler'], ['#4fd08a', 'well played']].forEach(([c, t]) => { const i = el('span', 'lg'); const sw = el('i'); sw.style.cssText = 'background:' + c + ';width:8px;height:8px;border-radius:50%'; i.appendChild(sw); i.appendChild(document.createTextNode(t)); lg.appendChild(i); });
    wrap.appendChild(lg);
    box.appendChild(wrap);
  }

  /* ---------- solver scorecard: every decision in the tournament, graded ---------- */
  const SCORE_V = 1, scoreKey = tid => 'solverScore.' + tid;
  const count = list => {
    const c = { correct: 0, incorrect: 0, split: 0, none: 0 };
    list.forEach(d => c[d.grade]++);
    c.graded = c.correct + c.incorrect + c.split;
    return c;
  };

  function scoreRow(t, label, list, cls, showSplit) {
    const c = count(list), tr = t.insertRow();
    if (cls) tr.className = cls;
    [label.replace(/ Street.*/, ''), c.correct, c.incorrect, c.split, c.graded ? pc(c.correct / c.graded) : '—', c.none]
      .filter((v, i) => i !== 3 || showSplit).forEach(v => { tr.insertCell().textContent = v; });
  }

  function renderScore(box, saved, tid) {
    const ds = saved.d, c = count(ds);
    const k = el('div', 'trKpis');
    const kpi = (v, label, cl) => { const d = el('div', 'kpi ' + (cl || '')); d.appendChild(el('b', null, String(v))); d.appendChild(el('small', null, label)); k.appendChild(d); };
    kpi(c.correct, 'correct', 'up');
    kpi(c.incorrect, 'incorrect', 'dn');
    if (c.split) kpi(c.split, 'depends on the villain');
    if (c.graded) kpi(pc(c.correct / c.graded), 'score');
    kpi(c.none, 'not graded');
    box.appendChild(k);
    box.appendChild(el('div', 'dim trNote', ds.length + ' decisions in all. Correct means the solver’s top play, or a play it makes at least 25% of the time. ' +
      'It judges what you could see, not how the cards fell, and it knows nothing of stack depth, payouts or bounties.' +
      (c.split ? ' “Depends on the villain” is a multiway stud spot where your play fit the heads-up read against some opponents but not others.' : '')));

    if (c.graded) {
      const t = el('table', 'tbl stats rvScore');
      const hr = t.createTHead().insertRow();
      ['', 'Correct', 'Incorrect', 'Depends', 'Score', 'Not graded'].filter(x => x !== 'Depends' || c.split).forEach(x => { const th = document.createElement('th'); th.textContent = x; hr.appendChild(th); });
      const games = [...new Set(ds.map(d => d.game))];
      games.forEach(g => {
        const mine = ds.filter(d => d.game === g);
        if (games.length > 1) scoreRow(t, g, mine, 'game', c.split);
        [...new Set(mine.map(d => d.street))].forEach(st => scoreRow(t, st, mine.filter(d => d.street === st), 'street', c.split));
      });
      box.appendChild(t);
    }

    const whys = {};
    ds.forEach(d => { if (d.grade === 'none') whys[d.why] = (whys[d.why] || 0) + 1; });
    const reasons = Object.keys(whys).sort((a, b) => whys[b] - whys[a]);
    if (reasons.length) box.appendChild(el('div', 'dim trNote', 'Not graded: ' + reasons.map(w => whys[w] + ' — ' + w).join('; ') + '.'));

    const bad = ds.filter(d => d.grade === 'incorrect' || d.grade === 'split');
    if (!bad.length) return;
    const det = el('details', 'rvBad');
    det.appendChild(el('summary', null, 'Decisions to review (' + bad.length + ')'));
    const t = el('table', 'tbl stats rvTbl');
    bad.forEach(d => {
      const tr = t.insertRow();
      tr.insertCell().textContent = '#' + d.i;
      tr.insertCell().textContent = d.game;
      tr.insertCell().appendChild(cardsEl(d.cards));
      const w = tr.insertCell(); w.className = 'why';
      w.textContent = d.street + ': you ' + d.you + ', the solver says ' + d.solver + (d.strategy ? ' (' + d.strategy + ')' : '');
      const nc = tr.insertCell(); nc.textContent = sgn(d.net) + ' BB'; nc.className = d.net > 0 ? 'up' : d.net < 0 ? 'dn' : '';
      tr.style.cursor = 'pointer'; tr.onclick = () => openIn(tid, d.id);
    });
    det.appendChild(t);
    box.appendChild(det);
  }

  async function solverPass(box, R, tid) {
    const can = R.rows.filter(r => r.h.hero === R.who && PSSolver.support(r.h.game.key));
    const out = el('div');
    box.innerHTML = '';
    box.appendChild(out);
    out.textContent = 'asking the solver…';
    // nothing but no-limit and pot-limit hands: no question for the solver, so no need for it to be up
    if (can.some(r => !PSSolver.limitOnly(r.h.game.betting))) {
      const ping = await PSSolver.ping();
      if (!ping.ok) { out.textContent = 'The HORSE+ solver is not answering at ' + PSSolver.url() + ' (' + ping.why + '). Start it, or set its address on the replayer’s Solver tab.'; return; }
    }
    const ds = [];
    for (let k = 0; k < can.length; k++) {
      const r = can[k];
      out.textContent = 'asking the solver… hand ' + (k + 1) + ' of ' + can.length + ' · ' + ds.length + ' decisions so far';
      let rows;
      try { rows = await PSSolver.assess(r.h, PSEngine.build(r.h), R.who); } catch (e) { continue; }
      rows.forEach(d => ds.push({
        i: r.i, id: r.id, game: r.game, net: r.net, cards: d.heroCards, street: d.streetLabel || d.street,
        you: d.actualLabel, solver: d.advice.action || '', strategy: d.advice.strategy || '', grade: d.grade, why: d.why,
      }));
    }
    out.textContent = '';
    const saved = { v: SCORE_V, at: Date.now(), d: ds };
    renderScore(out, saved, tid);
    // a run the solver dropped out of is not worth keeping
    if (ds.some(d => d.why === 'solver error')) out.appendChild(el('div', 'dim trNote', 'The solver failed on some decisions, so this run was not saved. Check again to fill them in.'));
    else { try { await PSDB.setMeta(scoreKey(tid), saved); } catch (e) { console.warn('solver score', e); } }
  }

  async function render(box, tid, who, hands, res) {
    // the EV tables for the games in this tournament, so starting hands can be rated
    if (global.PSEV) await Promise.all([...new Set(hands.map(h => h.game.key))].filter(g => PSEV.has(g)).map(g => PSEV.load(g)));
    const R = analyze(hands, who, res), s = PSLuck.summarize(res.recs);
    box.appendChild(el('h4', 'sec', 'Review'));
    const sum = el('div', 'shNotes lkIns');
    summary(R, res, s).forEach(x => sum.appendChild(el('p', null, x)));
    box.appendChild(sum);
    if (global.PSSolver && R.rows.some(r => PSSolver.support(r.h.game.key))) {
      box.appendChild(el('h4', 'sec', 'Solver scorecard'));
      const holder = el('div');
      const b = el('button', 'btn', 'Grade every decision with the solver');
      b.onclick = () => { b.disabled = true; solverPass(holder, R, tid).then(() => { b.disabled = false; b.textContent = 'Check again'; }); };
      const saved = await PSDB.getMeta(scoreKey(tid)).catch(() => null);
      if (saved && saved.v === SCORE_V) { renderScore(holder, saved, tid); b.textContent = 'Check again'; }
      box.appendChild(holder);
      box.appendChild(b);
    }
    stackChart(box, R, tid);
    list(box, 'Key mistakes — money in bad with cards to come', R.mistakes, tid);
    list(box, 'Well played', R.good, tid);
    list(box, 'Luck, not play — bad beats, suckouts, coolers', R.unlucky.concat(R.lucky, R.coolers).sort((a, b) => b.weight - a.weight), tid);
    list(box, 'Worth a second look', R.look, tid);
    box.appendChild(el('div', 'dim trNote', 'Mistakes and good plays at showdown are judged against the hands your opponents turned out to hold, so they are hindsight — a flag to replay the hand, not a verdict. ' +
      'Hands that never reached a showdown can only be rated by the money that went in and the starting hand. Click any hand to replay it inside the tournament.'));
    return R;
  }

  global.PSReview = { analyze, summary, render, openIn };
})(typeof window !== 'undefined' ? window : globalThis);
