/* ===========================================================================
   tiers.js — every starting hand sorted into five tiers, and what each tier
   normally makes you, so one tournament can be read against your norm.

   Tiers, where HORSE+ has an EV table (Razz, Stud, Stud Hi/Lo, Omaha Hi/Lo,
   Hold'em): rank every hand by its equity at the table size it was dealt at,
   weight each by how often it is dealt (AA is 6 combinations, AKo 12), and cut
   the list at
       tier 1  the best 5% of deals        tier 4  the next 30%
       tier 2  the next 10%                tier 5  the worst 35%
       tier 3  the next 20%
   Draw games have no table, so their "kinds of hand" are placed in tiers by
   hand (a pat 7 is tier 1 in 2-7; a 1-card badugi draw tier 5).

   The norm: your BB per deal in each game and tier over every other
   tournament in the library — never the one being looked at.
   =========================================================================== */
(function (global) {
  'use strict';
  const el = (t, c, x) => { const e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; };
  const sgn = v0 => { const d = Math.abs(v0) >= 100 ? 0 : 1, v = +v0.toFixed(d) || 0; return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(d); };
  const CUTS = [0.05, 0.15, 0.35, 0.65, 1];
  const NAMES = ['Tier 1 — best 5%', 'Tier 2 — next 10%', 'Tier 3 — next 20%', 'Tier 4 — next 30%', 'Tier 5 — worst 35%'];
  const SHORT = ['Tier 1', 'Tier 2', 'Tier 3', 'Tier 4', 'Tier 5'];

  /* draw and other games with no EV table: their kinds, placed by hand */
  function kindTier(game, kind) {
    if (game === 'badugi') return { 'Pat badugi, 7 or better': 1, 'Pat badugi, 8 to K': 2, '3-card badugi, 5 or better': 2, '3-card badugi, 6 or 7': 3,
      '3-card badugi, 8 or worse': 4 }[kind] || 5;
    if (game === 'td27' || game === 'sd27') return { 'Pat 7': 1, 'Pat 8': 1, '1-card draw to a 7': 1, 'Pat 9': 2, '1-card draw to an 8': 2,
      '2-card draw, with a deuce': 3, '2-card draw, no deuce': 4 }[kind] || 5;
    if (game === 'a5td' || game === 'a5sd') {
      if (/^Pat [5-7A]$|wheel|to a [67]$/.test(kind)) return 1;
      if (/^Pat [89]$|to an 8/.test(kind)) return 2;
      if (/with an ace/.test(kind)) return 3;
      if (/no ace/.test(kind)) return 4;
      return 5;
    }
    if (game === 'fcd') return { 'Pat hand (straight or better)': 1, 'Three of a kind': 1, 'Two pair': 2, 'Big pair (JJ+)': 2, 'Small pair (TT or lower)': 3, 'Four-flush': 3 }[kind] || 5;
    if (game === 'o58') return { 'A2 with a suited ace': 1, 'A2, ace not suited': 1, 'A3': 2, 'AA without a 2 or 3': 2,
      'A4 / A5': 3, 'No ace, three wheel cards': 3, 'Ace with no wheel card': 4 }[kind] || 5;
    if (game === 'omaha' || game === 'o5' || game === 'o6') return { 'Aces': 1, 'KK / QQ': 2, 'Double paired': 2, 'Rundown': 2, 'Broadway cards': 3, 'Double suited, unconnected': 3, 'Other pair': 4 }[kind] || 5;
    return 3;
  }

  /* how often each table key is dealt: every combination of the right number of cards */
  const DECK = [];
  for (const r of '23456789TJQKA') for (const u of 'cdhs') DECK.push(r + u);
  const comboCache = {};
  function combos(game) {
    if (comboCache[game]) return comboCache[game];
    const k = { razz: 3, stud: 3, stud8: 3, omaha8: 4, holdem: 2 }[game];
    const out = {}, pick = [];
    const walk = (start, depth) => {
      if (depth === k) { const key = PSEV.tableKey(game, pick); out[key] = (out[key] || 0) + 1; return; }
      for (let i = start; i < 52; i++) { pick[depth] = DECK[i]; walk(i + 1, depth + 1); }
    };
    walk(0, 0);
    return (comboCache[game] = out);
  }
  /* key -> tier at one table size */
  const tierCache = {};
  function tierMap(game, n) {
    const id = game + '|' + n;
    if (tierCache[id]) return tierCache[id];
    const row = PSEV.table(game).players[String(n)], w = combos(game);
    const keys = Object.keys(row).filter(k => w[k]).sort((a, b) => row[b] - row[a]);
    const total = keys.reduce((a, k) => a + w[k], 0);
    const out = {};
    let before = 0;
    keys.forEach(k => { const f = before / total; out[k] = 1 + CUTS.findIndex(c => f < c); before += w[k]; });
    return (tierCache[id] = out);
  }

  /* one hand -> { game, label, tier, kind, net, played, folded1, cards } or null */
  function handTier(h, who, lite) {
    if (h.hero !== who || !global.PSStart) return null;
    const c = PSStart.classify(h);
    if (!c) return null;
    const g = h.game.key, n = h.seats.filter(z => z.inHand).length;
    let tier = null, how = 'kind';
    if (global.PSEV && PSEV.has(g) && PSEV.table(g)) {
      const key = PSEV.tableKey(g, c.cards), cn = PSEV.clampN(g, n);
      tier = tierMap(g, cn)[key] || null;
      how = 'table';
    }
    if (!tier) tier = kindTier(g, c.group);
    const m = PSEngine.moneyFor(h), unit = h.bb || h.sb || 1;
    const net = (m.got[who] - m.put[who]) / unit;
    if (lite) return { game: g, tier: tier, net: net };               // all the norm needs
    const row = PSStats.rowsFor(h)[who] || {};
    let foldedFirst = false;
    for (const e of h.events) {
      if (e.t === 'street' && !/^(preflop|3rd|predraw)$/.test(e.id)) break;
      if (e.t === 'act' && e.player === who && e.verb === 'fold') { foldedFirst = true; break; }
    }
    return { h: h, game: g, label: h.game.label, tier: tier, how: how, kind: c.group, exact: c.exact, cards: c.cards,
      net: net, played: !!row.vpip, foldedFirst: foldedFirst };
  }

  /* the norm: per game and tier, BB per deal and its spread, over every hand except `skipTid`'s */
  function norms(hands, who, skipTid) {
    const acc = {};
    for (const h of hands) {
      if (h.hero !== who || (skipTid && h.tourney === skipTid)) continue;
      const t = handTier(h, who, true);
      if (!t) continue;
      const k = t.game + '|' + t.tier, a = acc[k] || (acc[k] = { n: 0, s: 0, s2: 0 });
      a.n++; a.s += t.net; a.s2 += t.net * t.net;
    }
    const out = {};
    for (const k in acc) {
      const a = acc[k], mean = a.s / a.n;
      out[k] = { n: a.n, mean: mean, sd: a.n > 1 ? Math.sqrt(Math.max(0, (a.s2 - a.n * mean * mean) / (a.n - 1))) : 0 };
    }
    return out;
  }

  /* ---------- one tournament, on its page ---------- */
  async function render(box, tid, name) {
    if (!global.PSHome || !global.PSStart) return false;
    const lib = await PSHome.library();
    const hs = lib.hands.filter(h => h.tourney === tid);
    if (!hs.length) return false;
    const tally = {};
    hs.forEach(h => { if (h.hero) tally[h.hero] = (tally[h.hero] || 0) + 1; });
    const who = tally[name] ? name : Object.keys(tally).sort((a, b) => tally[b] - tally[a])[0];
    if (!who) return false;
    // EV tables for every game this player has, so the norm and the tournament are tiered the same way
    const games = [...new Set(lib.hands.filter(h => h.hero === who).map(h => h.game.key))];
    if (global.PSEV) await Promise.all(games.filter(g => PSEV.has(g)).map(g => PSEV.load(g)));
    const rows = hs.map(h => handTier(h, who)).filter(Boolean).sort((a, b) => (a.h.dateObj || 0) - (b.h.dateObj || 0));
    if (!rows.length) return false;
    const N = norms(lib.hands, who, tid);
    const idx = {};
    rows.forEach((r, i) => { idx[r.h.id] = i + 1; });

    // per tier, across the games of the tournament: actual, expected from the norm, and the spread
    const T = [1, 2, 3, 4, 5].map(t => ({ t: t, deals: 0, played: 0, folded: 0, net: 0, exp: 0, var: 0, unknown: 0, rows: [] }));
    rows.forEach(r => {
      const x = T[r.tier - 1], nm = N[r.game + '|' + r.tier];
      x.deals++; x.net += r.net; x.rows.push(r);
      if (r.played) x.played++;
      if (r.foldedFirst) x.folded++;
      if (nm && nm.n >= 5) { x.exp += nm.mean; x.var += nm.sd * nm.sd; } else x.unknown++;
    });
    const anyNorm = T.some(x => x.deals > x.unknown);

    box.appendChild(el('h4', 'sec', 'Hand tiers — this tournament against your norm'));
    box.appendChild(el('div', 'dim trNote', 'Every starting hand you were dealt here, in five tiers (best 5% of deals, next 10%, 20%, 30%, worst 35% — by the HORSE+ EV table where there is one). ' +
      'The bar is what each tier made you in this tournament; the marker is what those same deals normally make you, from every other tournament in your library. Net in big bets / big blinds.'));
    chart(box, T, anyNorm);

    const t = el('table', 'tbl stats');
    const hr = t.insertRow();
    ['Tier', 'Deals', 'Played', 'Folded first round', 'Your result BB', 'Your norm BB', 'Difference', 'Read'].forEach(x => { const th = document.createElement('th'); th.textContent = x; hr.appendChild(th); });
    const list = el('div');
    T.forEach((x, i) => {
      if (!x.deals) return;
      const known = x.deals - x.unknown, d = x.net - x.exp, sd = Math.sqrt(x.var);
      const read = !known ? 'no norm yet' : Math.abs(d) <= Math.max(1, sd) ? 'within normal swing' : d > 0 ? 'better than usual' : 'worse than usual';
      const tr = t.insertRow();
      [NAMES[i], x.deals, x.played, x.folded, sgn(x.net), known ? sgn(x.exp) : '—', known ? sgn(d) : '—', read].forEach((v, j) => {
        const c = tr.insertCell(); c.textContent = v;
        if (j === 4) c.className = x.net > 0 ? 'up' : x.net < 0 ? 'dn' : '';
        if (j === 6 && known) c.className = d > 0 ? 'up' : d < 0 ? 'dn' : '';
        if (j === 7) c.className = read === 'within normal swing' || read === 'no norm yet' ? 'dim' : d > 0 ? 'up' : 'dn';
      });
      tr.title = known ? 'Normal swing for ' + x.deals + ' deals is about ±' + sd.toFixed(1) + ' BB' : '';
      tr.style.cursor = 'pointer';
      tr.onclick = () => showTier(list, x, NAMES[i], tid, idx, N);
    });
    const tot = T.reduce((a, x) => ({ deals: a.deals + x.deals, net: a.net + x.net, exp: a.exp + x.exp }), { deals: 0, net: 0, exp: 0 });
    const tr = t.insertRow();
    ['All hands', tot.deals, '', '', sgn(tot.net), anyNorm ? sgn(tot.exp) : '—', anyNorm ? sgn(tot.net - tot.exp) : '—', ''].forEach((v, j) => {
      const c = tr.insertCell(); c.textContent = v; if (j === 6 && anyNorm) c.className = tot.net - tot.exp > 0 ? 'up' : 'dn';
    });
    box.appendChild(t);
    box.appendChild(el('div', 'dim trNote', 'One tournament is a small sample: a tier with a handful of deals swings by several big bets on a single pot. “Within normal swing” means the difference is no bigger than ' +
      'the usual spread for that many deals. Click a tier for its hands.' + (T.some(x => x.unknown) ? ' Tiers marked — have fewer than five deals elsewhere in your library to set a norm.' : '')));
    box.appendChild(list);
    return true;
  }

  function showTier(list, x, name, tid, idx, N) {
    list.innerHTML = '';
    list.appendChild(el('h4', 'sec', name + ' — ' + x.deals + ' deals'));
    const t = el('table', 'tbl stats lkHands');
    const hr = t.insertRow();
    ['#', 'Game', 'Hand', 'Kind', 'What you did', 'Result BB', 'Your norm for it'].forEach(h => { const th = document.createElement('th'); th.textContent = h; hr.appendChild(th); });
    x.rows.forEach(r => {
      const tr = t.insertRow(), nm = N[r.game + '|' + r.tier];
      tr.insertCell().textContent = '#' + idx[r.h.id];
      tr.insertCell().textContent = r.label;
      const cc = tr.insertCell(), w = el('span', 'lkCards');
      r.cards.forEach(c => w.appendChild(el('span', 'cd su-' + c[1], c[0] + { c: '♣', d: '♦', h: '♥', s: '♠' }[c[1]])));
      cc.appendChild(w);
      tr.insertCell().textContent = r.kind;
      tr.insertCell().textContent = r.played ? 'played' : r.foldedFirst ? 'folded first round' : 'no voluntary money';
      const nc = tr.insertCell(); nc.textContent = sgn(r.net); nc.className = r.net > 0 ? 'up' : r.net < 0 ? 'dn' : '';
      tr.insertCell().textContent = nm && nm.n >= 5 ? sgn(nm.mean) + ' a deal' : '—';
      tr.style.cursor = 'pointer'; tr.title = 'Replay this hand inside the tournament';
      tr.onclick = () => { if (global.PSReview) PSReview.openIn(tid, r.h.id); };
    });
    list.appendChild(global.PSTourneys ? PSTourneys.sortable(t) : t);
  }

  /* bars for what each tier made, a marker for the norm — one axis, BB */
  const C_BAR = '#3987e5', C_NORM = '#d95926';
  function chart(box, T, anyNorm) {
    const W = 920, H = 230, L = 52, R = 16, TOP = 14, B = 40;
    const vals = T.flatMap(x => [x.net, x.deals > x.unknown ? x.exp : 0]).concat([0]);
    let lo = Math.min(...vals), hi = Math.max(...vals);
    if (hi - lo < 4) { hi += 2; lo -= 2; }
    const span = hi - lo, y = v => TOP + (H - TOP - B) * (1 - (v - lo) / span);
    const slot = (W - L - R) / 5, bw = Math.min(70, slot * 0.46);
    const NS = 'http://www.w3.org/2000/svg', svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H); svg.setAttribute('class', 'lkSvg'); svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Net BB by hand tier against your norm');
    const mk = (tag, a, text) => { const n = document.createElementNS(NS, tag); for (const k in a) n.setAttribute(k, a[k]); if (text != null) n.textContent = text; svg.appendChild(n); return n; };
    const step = [1, 2, 5, 10, 20, 50, 100].find(s => span / s <= 6) || 200;
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
      mk('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: v === 0 ? 'zero' : 'grid' });
      mk('text', { x: L - 6, y: y(v) + 3.5, class: 'tick', 'text-anchor': 'end' }, (v > 0 ? '+' : '') + v);
    }
    const wrap = el('div', 'lkChart');
    const lg = el('div', 'lkLegend');
    [[C_BAR, 'this tournament'], [C_NORM, 'your norm for those deals']].forEach(([c, t], i) => {
      const s = el('span', 'lg'), sw = el('i'); sw.style.background = c; if (i) { sw.style.height = '3px'; } else { sw.style.height = '10px'; sw.style.width = '10px'; sw.style.borderRadius = '2px'; }
      s.appendChild(sw); s.appendChild(document.createTextNode(t)); lg.appendChild(s);
    });
    wrap.appendChild(lg);
    const tip = el('div', 'lkTip');
    T.forEach((x, i) => {
      const cx = L + slot * i + slot / 2;
      mk('text', { x: cx, y: H - 22, class: 'tick', 'text-anchor': 'middle' }, SHORT[i]);
      mk('text', { x: cx, y: H - 8, class: 'tick', 'text-anchor': 'middle' }, x.deals + ' deal' + (x.deals === 1 ? '' : 's'));
      if (!x.deals) return;
      // the bar: from zero to the result, square at the baseline, 4px rounded at its end
      const y0 = y(0), y1 = y(x.net), top = Math.min(y0, y1), h = Math.max(1, Math.abs(y1 - y0));
      mk('rect', { x: cx - bw / 2, y: top, width: bw, height: h, rx: 3, fill: C_BAR });
      mk('text', { x: cx, y: x.net >= 0 ? top - 5 : top + h + 13, class: 'endLbl', 'text-anchor': 'middle' }, sgn(x.net));
      if (x.deals > x.unknown) {
        const ym = y(x.exp);
        mk('line', { x1: cx - bw / 2 - 8, x2: cx + bw / 2 + 8, y1: ym, y2: ym, stroke: C_NORM, 'stroke-width': 3, 'stroke-linecap': 'round' });
      }
      const hit = mk('rect', { x: L + slot * i, y: TOP, width: slot, height: H - TOP - B, fill: 'transparent' });
      hit.addEventListener('mousemove', () => {
        const b = svg.getBoundingClientRect();
        tip.innerHTML = '';
        tip.appendChild(el('b', null, NAMES[i]));
        tip.appendChild(el('div', null, x.deals + ' deals · played ' + x.played + ' · folded first round ' + x.folded));
        tip.appendChild(el('div', null, 'this tournament ' + sgn(x.net) + ' BB' + (x.deals > x.unknown ? ' · your norm ' + sgn(x.exp) + ' BB · difference ' + sgn(x.net - x.exp) : '')));
        tip.style.display = 'block';
        tip.style.left = Math.min(b.width - 250, Math.max(0, (cx / W) * b.width + 12)) + 'px'; tip.style.top = '30px';
      });
      hit.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
    });
    const holder = el('div', 'lkSvgWrap'); holder.appendChild(svg); holder.appendChild(tip);
    wrap.appendChild(holder);
    box.appendChild(wrap);
  }

  global.PSTiers = { handTier, norms, render, tierMap, combos, NAMES };
})(typeof window !== 'undefined' ? window : globalThis);
