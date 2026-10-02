/* ===========================================================================
   tsummary.js — PokerStars "Tournament History" summaries.

   The email PokerStars sends when you ask for your last N tournaments lists,
   for each one, the header (game, buy-in, field, prize pool, start/finish) and
   every entry's finishing place, country and payout.  One line per ENTRY: a
   re-entry shows up again with its entry number in brackets —
       2: SomePlayer [4] (Malta), $1,750.36 (14.23%)
   and "N players" counts people, not entries.

   This file only reads text (or the RTF Mail/TextEdit saves it as) and turns
   it into records; db.js stores them and the Tournament Overview shows them.
   A player's performance record is built from those rows by `perfFrom`, and
   `aggregate` turns a record into the numbers people care about.
   =========================================================================== */
(function (global) {
  'use strict';

  /* ---------- RTF → text (what TextEdit / Mail save) ---------- */
  const SKIP_DEST = new Set(['fonttbl', 'colortbl', 'expandedcolortbl', 'stylesheet', 'info', 'fldinst',
    'pict', 'listtable', 'listoverridetable', 'header', 'footer', 'themedata', 'colorschememapping',
    'latentstyles', 'datastore', 'xmlnstbl', 'generator', 'rsidtbl', 'mmathPr', 'object', 'filetbl']);
  // Windows-1252's 0x80–0x9F block (everything else is Latin-1)
  const W1252 = '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ';
  const cp1252 = code => (code >= 0x80 && code < 0xa0) ? W1252[code - 0x80] : String.fromCharCode(code);

  function rtfToText(s) {
    if (!/^\s*\{\\rtf/.test(s)) return s;
    let out = '', i = 0, skipping = false, uc = 1, uskip = 0;
    const stack = [];
    const emit = ch => {
      if (skipping) return;
      if (uskip > 0) { uskip--; return; }
      out += ch;
    };
    while (i < s.length) {
      const c = s[i];
      if (c === '{') { stack.push([skipping, uc]); i++; continue; }
      if (c === '}') { const st = stack.pop(); if (st) { skipping = st[0]; uc = st[1]; } uskip = 0; i++; continue; }
      if (c === '\r' || c === '\n') { i++; continue; }
      if (c !== '\\') { emit(c); i++; continue; }
      const n = s[i + 1];
      if (n === '\\' || n === '{' || n === '}') { emit(n); i += 2; continue; }
      if (n === '\n' || n === '\r') { if (!skipping) out += '\n'; i += 2; continue; }
      if (n === "'") { emit(cp1252(parseInt(s.substr(i + 2, 2), 16))); i += 4; continue; }
      if (n === '*') { skipping = true; i += 2; continue; }
      if (n === '~') { emit(' '); i += 2; continue; }
      if (n === '-' || n === '_') { i += 2; continue; }
      const m = /^([a-zA-Z]+)(-?\d+)? ?/.exec(s.slice(i + 1, i + 48));
      if (!m) { i += 2; continue; }
      i += 1 + m[0].length;
      const w = m[1], arg = m[2];
      if (SKIP_DEST.has(w)) { skipping = true; continue; }
      if (skipping) continue;
      if (w === 'par' || w === 'line') out += '\n';
      else if (w === 'tab') out += '\t';
      else if (w === 'uc') uc = +arg || 0;
      else if (w === 'u') { let cp = +arg; if (cp < 0) cp += 65536; out += String.fromCharCode(cp); uskip = uc; }
      else if (w === 'emdash') out += '—';
      else if (w === 'endash') out += '–';
      else if (w === 'lquote') out += '‘';
      else if (w === 'rquote') out += '’';
      else if (w === 'ldblquote') out += '“';
      else if (w === 'rdblquote') out += '”';
      else if (w === 'bullet') out += '•';
    }
    return out;
  }

  /* ---------- money ---------- */
  const num = s => {
    const v = parseFloat(String(s == null ? '' : s).replace(/[^\d.\-]/g, ''));
    return isFinite(v) ? v : 0;
  };
  const SYM = { USD: '$', EUR: '€', GBP: '£', CAD: 'C$' };
  function money(v, cur) {
    const neg = v < 0; v = Math.abs(v || 0);
    const s = v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const sym = cur === undefined || cur === 'USD' || cur === '' ? '$' : (SYM[cur] || '');
    return (neg ? '−' : '') + sym + s + (sym ? '' : ' ' + cur);
  }
  function buyinOf(txt) {
    const cm = txt.match(/\b([A-Z]{3})\s*$/);
    const body = cm ? txt.slice(0, cm.index) : txt;
    const parts = body.split('/').map(num);
    const cur = cm ? cm[1] : (/€/.test(txt) ? 'EUR' : /£/.test(txt) ? 'GBP' : /\$/.test(txt) ? 'USD' : '');
    // $prize/$rake, or $prize/$bounty/$rake for knockouts
    const b = { text: txt.trim(), parts: parts, cur: cur, total: parts.reduce((a, x) => a + x, 0) };
    b.rake = parts.length > 1 ? parts[parts.length - 1] : 0;
    b.bounty = parts.length > 2 ? parts[1] : 0;
    b.prize = parts[0] || 0;
    return b;
  }
  const whenOf = s => {
    const d = String(s).match(/(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2}):(\d{2})/);
    return d ? new Date(+d[1], +d[2] - 1, +d[3], +d[4], +d[5], +d[6]).getTime() : 0;
  };

  /* ---------- the summary text ---------- */
  const ROW = /^\s*(\d+):\s+(.*?)(?:\s\[(\d+)\])?\s\(([^()]*)\),\s?(.*?)\s*$/;

  function isSummary(text) {
    const t = String(text).slice(0, 40000);
    return /PokerStars Tournament #\d+,/.test(t) && /^\s*\d+:\s+.+\(.*\),/m.test(rtfToText(t).replace(/\r/g, '')) &&
      !/PokerStars (?:Hand|Game|Zoom Hand) #/.test(t);
  }

  function newT(id, game) {
    return {
      id: id, event: game, tags: [], buyin: null, players: 0, entries: 0, pool: 0, poolCur: '',
      added: 0, target: null, tickets: 0, start: 0, end: 0, startText: '', endText: '',
      results: [], hero: null, you: [], raw: '',
    };
  }

  function parse(text, file) {
    text = rtfToText(String(text)).replace(/\r\n?/g, '\n').replace(/ /g, ' ');
    const out = { requestedBy: '', file: file || '', tourneys: [] };
    const rq = text.match(/Tournament History for .*?requested by (.+?)\s*(?:\(|$)/m);
    if (rq) out.requestedBy = rq[1].trim();
    let cur = null, raw = [];
    const close = () => {
      if (!cur) return;
      while (raw.length && !raw[raw.length - 1].trim()) raw.pop();
      cur.raw = raw.join('\n');
      cur.entries = cur.results.length;
      // play money: chips count for nothing — $100 an entry, paid by the chart
      if (global.PSPlay && cur.buyin && PSPlay.isPlayMoney(cur.buyin.text)) PSPlay.score(cur);
      cur.hero = heroOf(cur, out.requestedBy);
      cur.satellite = cur.tags.some(t => /satellite/i.test(t)) || !!cur.target;
      out.tourneys.push(cur);
      cur = null; raw = [];
    };
    for (const line of text.split('\n')) {
      let m;
      if ((m = line.match(/^\s*PokerStars Tournament #(\d+),\s*(.+?)\s*$/))) {
        close(); cur = newT(m[1], m[2]); raw.push(line.trim()); continue;
      }
      if (!cur) continue;
      if (/^\s*You are receiving this email|^\s*Please note: This email/.test(line)) { close(); continue; }
      raw.push(line.replace(/\s+$/, ''));
      const L = line.trim();
      if (!L) continue;
      if ((m = L.match(ROW))) {
        const rest = m[5] || '';
        const pm = rest.match(/^([^\s(]*[\d][\d.,]*)(?:\s*\(([\d.]+)%\))?/);
        cur.results.push({
          place: +m[1], name: m[2], entry: m[3] ? +m[3] : 1, country: m[4],
          amount: pm ? num(pm[1]) : 0, pct: pm && pm[2] ? +pm[2] : null,
          qualified: /qualified/i.test(rest), note: pm ? '' : rest.replace(/^\(|\)$/g, ''),
        });
        continue;
      }
      if ((m = L.match(/^Buy-In:\s*(.+)$/))) { cur.buyin = buyinOf(m[1]); continue; }
      if ((m = L.match(/^(\d+) players?$/))) { cur.players = +m[1]; continue; }
      if ((m = L.match(/^Total Prize Pool:\s*(.+)$/))) {
        cur.pool = num(m[1].replace(/\b[A-Z]{3}\b/g, ''));
        const c = m[1].match(/\b([A-Z]{3})\b/); cur.poolCur = c ? c[1] : '';
        continue;
      }
      if ((m = L.match(/^(.+?)\s+(?:[A-Z]{3}\s+)?added to the prize pool/i))) { cur.added = num(m[1]); continue; }
      if ((m = L.match(/^Target Tournament #(\d+)\s+Buy-In:\s*(.+)$/))) {
        cur.target = { id: m[1], buyin: buyinOf(m[2]) }; continue;
      }
      if ((m = L.match(/^(\d+) tickets? to the target tournament/i))) { cur.tickets = +m[1]; continue; }
      if ((m = L.match(/^Tournament started\s+(.+)$/))) { cur.startText = m[1]; cur.start = whenOf(m[1]); continue; }
      if ((m = L.match(/^Tournament finished\s+(.+)$/))) { cur.endText = m[1]; cur.end = whenOf(m[1]); continue; }
      if (/^You\b/.test(L)) { cur.you.push(L); continue; }
      if (!cur.buyin) cur.tags.push(L);            // "Super Satellite", and whatever else sits under the title
    }
    close();
    return out;
  }

  /* the "You …" lines are the requester's own: finish, re-entries, bounties */
  function heroOf(t, name) {
    const all = t.you.join(' ');
    const h = { name: name || '', place: null, eliminated: [], reentries: 0, reentryCost: 0, bounties: 0, bountyWon: 0 };
    let m;
    if ((m = all.match(/You finished in (\d+)(?:st|nd|rd|th) place/))) h.place = +m[1];
    const el = /eliminated at ([^)]+)\)/g;
    while ((m = el.exec(all))) h.eliminated.push(m[1]);
    if ((m = all.match(/You made (\d+) re-entr(?:y|ies) for a total of ([^\s]+?)\.?(?:\s|$)/))) {
      h.reentries = +m[1]; h.reentryCost = num(m[2]);
    }
    if ((m = all.match(/You collected (\d+) bount(?:y|ies) for a total of (?:[A-Z]{3}\s*)?([\d.,]+)/))) {
      h.bounties = +m[1]; h.bountyWon = num(m[2]);
    }
    return h;
  }

  /* ---------- performance records ---------- */

  /* one event line per player per tournament — every entry folded together */
  function eventFor(t, name) {
    const rows = t.results.filter(r => r.name === name);
    if (!rows.length) return null;
    const b = t.buyin || { total: 0, cur: '' };
    const entries = Math.max(rows.length, ...rows.map(r => r.entry));
    const tickets = rows.filter(r => r.qualified).length;
    const qualified = tickets > 0;
    const ticket = qualified && t.target ? tickets * t.target.buyin.total : 0;
    const bounty = t.hero && t.hero.name === name ? t.hero.bountyWon : 0;
    return {
      tid: t.id, event: t.event, sat: !!t.satellite, date: t.start || t.end || 0, cur: b.cur || t.poolCur || '',
      buyin: b.total, entries: entries, cost: entries * b.total,
      best: Math.min(...rows.map(r => r.place)), places: rows.map(r => r.place).sort((a, z) => a - z),
      field: t.entries, won: rows.reduce((a, r) => a + r.amount, 0), ticket: ticket, bounty: bounty,
      qualified: qualified, tickets: tickets, country: rows[0].country,
      // where a satellite's seats go — campaigns() follows these links
      target: t.target ? { id: t.target.id, total: t.target.buyin.total } : null,
    };
  }

  /* name -> { name, country, events: { tid: event } } for everyone in these tournaments */
  function perfFrom(tourneys) {
    const out = {};
    for (const t of tourneys) {
      const names = new Set(t.results.map(r => r.name));
      for (const n of names) {
        const ev = eventFor(t, n);
        const p = out[n] || (out[n] = { name: n, country: ev.country, events: {} });
        p.events[t.id] = ev;
      }
    }
    return out;
  }

  /* the numbers: a tournament counts as cashed if it paid money or a ticket */
  function aggregate(rec) {
    const a = {
      tourneys: 0, entries: 0, reentries: 0, cashes: 0, wins: 0, tickets: 0, best: null,
      won: 0, cost: 0, bounty: 0, net: 0, roi: null, itm: null, avgFinish: null, cur: '',
      byEvent: {}, curs: {},
    };
    if (!rec) return a;
    const evs = Object.values(rec.events || {});
    let pctSum = 0, pctN = 0;
    for (const e of evs) {
      a.tourneys++; a.entries += e.entries; a.reentries += e.entries - 1;
      const cashed = e.won > 0 || e.qualified;
      if (cashed) a.cashes++;
      if (e.best === 1 && !e.sat) a.wins++;       // satellite qualifiers are all listed 1st
      if (e.qualified) a.tickets++;
      // a satellite seat is not a finish: best place counts real events only
      if (!e.sat && (a.best == null || e.best < a.best)) a.best = e.best;
      const got = e.won + e.ticket + e.bounty;
      a.won += got; a.cost += e.cost; a.bounty += e.bounty;
      a.curs[e.cur || '?'] = 1;
      if (e.field > 1) { pctSum += (e.best - 1) / (e.field - 1); pctN++; }
      const ek = e.event + (e.sat ? ' — satellites' : '');
      const g = a.byEvent[ek] || (a.byEvent[ek] = { n: 0, entries: 0, cashes: 0, won: 0, cost: 0, best: null, sat: e.sat });
      g.n++; g.entries += e.entries; if (cashed) g.cashes++; g.won += got; g.cost += e.cost;
      if (g.best == null || e.best < g.best) g.best = e.best;
    }
    if (a.best == null && evs.length) a.best = Math.min(...evs.map(e => e.best));
    a.net = a.won - a.cost;
    a.roi = a.cost ? 100 * a.net / a.cost : null;
    a.itm = a.tourneys ? 100 * a.cashes / a.tourneys : null;
    a.avgFinish = pctN ? 100 * pctSum / pctN : null;       // 0% = won it, 100% = first out
    const cs = Object.keys(a.curs);
    a.cur = cs.length === 1 ? cs[0] : '';
    return a;
  }

  /* ---------- satellites linked to the tournament they feed ----------

     A campaign is one tournament plus every satellite that led to it — step
     satellites included (a $5.50 seat into a $55 satellite into the $530 main).
     Seats are spent where they point: an entry paid with a ticket costs no
     cash; a seat that was never used (or whose target is not in the history)
     is worth its face value.  So

         net = payouts + unused seats − cash actually spent

     which, summed over all campaigns, equals the plain per-tournament net
     (where each seat is a win at face value and each entry a full buy-in). */
  function campaigns(rec) {
    const E = (rec && rec.events) || {};
    const rootOf = ev => {
      let cur = ev;
      const seen = new Set();
      while (cur.target && E[cur.target.id] && !seen.has(cur.tid)) { seen.add(cur.tid); cur = E[cur.target.id]; }
      return cur.target && !E[cur.target.id] ? cur.target.id : cur.tid;
    };
    const groups = {};
    for (const tid in E) (groups[rootOf(E[tid])] = groups[rootOf(E[tid])] || []).push(E[tid]);

    const out = [];
    for (const root in groups) {
      const nodes = groups[root];
      const main = E[root] || null;
      const ticketsIn = {}, faceOf = {};
      nodes.forEach(n => {
        if (!n.target || !n.tickets) return;
        ticketsIn[n.target.id] = (ticketsIn[n.target.id] || 0) + n.tickets;
        faceOf[n.target.id] = n.target.total;
      });
      let cost = 0, payout = 0, unused = 0, unusedValue = 0;
      const legs = nodes.map(n => {
        const tin = ticketsIn[n.tid] || 0;
        const viaTicket = Math.min(tin, n.entries);
        const cash = (n.entries - viaTicket) * n.buyin;
        cost += cash;
        payout += n.won + n.bounty;
        if (tin > viaTicket) { unused += tin - viaTicket; unusedValue += (tin - viaTicket) * n.buyin; }
        return { ev: n, viaTicket: viaTicket, cashEntries: n.entries - viaTicket, cash: cash, isMain: n === main };
      });
      if (!main && ticketsIn[root]) { unused += ticketsIn[root]; unusedValue += ticketsIn[root] * faceOf[root]; }
      const sats = legs.filter(l => !l.isMain).sort((a, b) => a.ev.date - b.ev.date);
      const mainLeg = legs.find(l => l.isMain) || null;
      out.push({
        id: root, main: main, mainLeg: mainLeg, sats: sats, missing: !main,
        event: main ? main.event : (sats[0] ? sats[0].ev.event : ''),
        date: main ? main.date : Math.max(...nodes.map(n => n.date)),
        cur: nodes[0].cur, face: main ? main.buyin : (faceOf[root] || 0),
        satCost: sats.reduce((a, l) => a + l.cash, 0),
        ticketsWon: sats.reduce((a, l) => a + l.ev.tickets, 0),
        cost: cost, payout: payout, unused: unused, unusedValue: unusedValue,
        net: payout + unusedValue - cost,
      });
    }
    return out.sort((a, b) => b.date - a.date);
  }

  /* the one-line story, in the shape
       $500 (Single Entry) + 2 x $50 (Satellites) = $600 Total Entry, $1,000 Payout, $400 Net Profit
       2 x $50 (Satellites, 1 ticket won), $0 Entry ($500 via Satellite), Busted out of the money, −$100 */
  function describe(c) {
    const M = v => money(Math.round(v * 100) / 100, c.cur).replace(/\.00(?=$|\s)/, '');
    const pl = (n, one, many) => n + ' ' + (n === 1 ? one : many);
    // satellites: cash entries grouped by price, then what came of them
    const byPrice = {};
    let satTickets = 0, satViaTicket = 0;
    c.sats.forEach(l => {
      if (l.cashEntries) byPrice[l.ev.buyin] = (byPrice[l.ev.buyin] || 0) + l.cashEntries;
      satViaTicket += l.viaTicket;
    });
    satTickets = c.ticketsWon;
    const prices = Object.keys(byPrice).map(Number).sort((a, b) => a - b);
    let satSeg = '';
    if (c.sats.length) {
      const n = c.sats.reduce((a, l) => a + l.ev.entries, 0);
      const cash = prices.map(p => byPrice[p] + ' x ' + M(p)).join(' + ') || '$0';
      const bits = [n === 1 ? 'Satellite' : 'Satellites'];
      if (satViaTicket) bits.push(pl(satViaTicket, 'entered with a ticket', 'entered with tickets'));
      if (satTickets) bits.push(pl(satTickets, 'ticket won', 'tickets won'));
      satSeg = cash + ' (' + bits.join(', ') + ')';
    }
    let entrySeg = '', result = '';
    if (c.mainLeg) {
      const l = c.mainLeg, e = l.ev;
      const parts = [];
      if (l.viaTicket) parts.push('$0 Entry (' + (l.viaTicket > 1 ? l.viaTicket + ' x ' : '') + M(e.buyin) + ' via Satellite)');
      if (l.cashEntries) {
        parts.push(l.cashEntries === 1 && e.entries === 1 ? M(e.buyin) + ' (Single Entry)'
          : l.cashEntries + ' x ' + M(e.buyin) + ' (' + (l.viaTicket ? pl(l.cashEntries, 'Re-entry', 'Re-entries')
            : 'Entry + ' + pl(l.cashEntries - 1, 'Re-entry', 'Re-entries')) + ')');
      }
      entrySeg = parts.join(' + ');
      const got = e.won + e.bounty;
      result = got > 0 ? PSTSum.ord(e.best) + ' — ' + M(got) + ' payout' : 'Busted out of the money (' + PSTSum.ord(e.best) + ')';
    } else {
      result = c.unused ? pl(c.unused, 'seat', 'seats') + ' to #' + c.id + ' (not in this history) worth ' + M(c.unusedValue)
        : 'No seat won — #' + c.id + ' is not in this history';
    }
    const segs = c.mainLeg && c.mainLeg.viaTicket ? [satSeg, entrySeg] : [entrySeg, satSeg];
    const lhs = segs.filter(Boolean).join(' + ');
    const tail = M(c.cost) + ' Total Entry, ' + M(c.payout) + ' Payout' +
      (c.unusedValue ? ', ' + M(c.unusedValue) + ' in unused seats' : '') + ', ' +
      M(c.net) + (c.net >= 0 ? ' Net Profit' : ' Net Loss');
    return { lhs: lhs, result: result, tail: tail, text: lhs + ' = ' + tail + ' · ' + result };
  }

  const ord = n => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');

  // bump when event records gain fields; the app rebuilds stored records from the summaries
  const PERF_VERSION = 3;   // 3: play-money summaries scored by the payout chart

  global.PSTSum = { rtfToText, isSummary, parse, perfFrom, eventFor, aggregate, campaigns, describe, money, ord, num, PERF_VERSION };
})(typeof window !== 'undefined' ? window : globalThis);
