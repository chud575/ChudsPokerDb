/* ===========================================================================
   parser.js — PokerStars hand-history parser
   Handles every game found in PokerStars .txt histories:
     stud family : Razz, 7 Card Stud, 7 Card Stud Hi/Lo
     flop family : Hold'em, Omaha, Omaha Hi/Lo  (Limit / Pot Limit / No Limit)
     draw family : 2-7 Triple Draw, 2-7 Single Draw, A-5 Triple Draw,
                   Badugi, 5 Card Draw
     mixed       : HORSE / 8-Game / Mixed events (per-hand game switch)
   Tournament and cash formats.
   =========================================================================== */
(function (global) {
  'use strict';

  /* ---------- game table ------------------------------------------------ */
  const GAME_DEFS = [
    { re: /Razz/i,                       key: 'razz',   label: 'Razz',            fam: 'stud', cards: 7 },
    { re: /Stud\s*Hi\/?-?Lo/i,           key: 'stud8',  label: 'Stud Hi/Lo',      fam: 'stud', cards: 7 },
    { re: /Card\s*Stud/i,                key: 'stud',   label: 'Stud Hi',         fam: 'stud', cards: 7 },
    { re: /Omaha\s*Hi\/?-?Lo/i,          key: 'omaha8', label: 'Omaha Hi/Lo',     fam: 'flop', cards: 4 },
    { re: /5\s*Card\s*Omaha/i,           key: 'o5',     label: '5-Card Omaha',    fam: 'flop', cards: 5 },
    { re: /Omaha/i,                      key: 'omaha',  label: 'Omaha',           fam: 'flop', cards: 4 },
    { re: /Hold\s*'?em/i,                key: 'holdem', label: "Hold'em",         fam: 'flop', cards: 2 },
    // draw games — sites write these in either word order ("Triple Draw 2-7" /
    // "2-7 Triple Draw"), and some spell the lowball out, so match both.
    { re: /Badugi/i,                                              key: 'badugi', label: 'Badugi',          fam: 'draw', cards: 4, draws: 3 },
    { re: /(?:Triple\s*Draw\s*2-7|2-7\s*Triple\s*Draw|Deuce[\s-]*to[\s-]*Seven\s*Triple)/i,
                                                                  key: 'td27',   label: '2-7 Triple Draw', fam: 'draw', cards: 5, draws: 3 },
    { re: /(?:Single\s*Draw\s*2-7|2-7\s*Single\s*Draw|Deuce[\s-]*to[\s-]*Seven\s*Single)/i,
                                                                  key: 'sd27',   label: '2-7 Single Draw', fam: 'draw', cards: 5, draws: 1 },
    { re: /(?:Triple\s*Draw\s*A-5|A-5\s*Triple\s*Draw|Ace[\s-]*to[\s-]*Five\s*Triple)/i,
                                                                  key: 'a5td',   label: 'A-5 Triple Draw', fam: 'draw', cards: 5, draws: 3 },
    { re: /(?:Single\s*Draw\s*A-5|A-5\s*Single\s*Draw|Ace[\s-]*to[\s-]*Five\s*Single)/i,
                                                                  key: 'a5sd',   label: 'A-5 Single Draw', fam: 'draw', cards: 5, draws: 1 },
    { re: /(?:5|Five)\s*Card\s*Draw/i,                            key: 'fcd',    label: '5 Card Draw',     fam: 'draw', cards: 5, draws: 1 },
    // last resort: an unqualified "Triple Draw" / "Single Draw" is 2-7 in practice
    { re: /Triple\s*Draw/i,                                       key: 'td27',   label: '2-7 Triple Draw', fam: 'draw', cards: 5, draws: 3 },
    { re: /Single\s*Draw/i,                                       key: 'sd27',   label: '2-7 Single Draw', fam: 'draw', cards: 5, draws: 1 },
  ];

  function classifyGame(desc) {
    for (const g of GAME_DEFS) if (g.re.test(desc)) {
      return Object.assign({}, g, { desc: desc });
    }
    return { key: 'unknown', label: desc, fam: 'flop', cards: 2, desc: desc };
  }

  /* ---------- small helpers --------------------------------------------- */
  const num = s => s == null ? 0 : parseFloat(String(s).replace(/[$£€,\s]/g, '')) || 0;
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const cardsIn = s => {
    const out = [];
    const re = /\[([^\]]*)\]/g; let m;
    while ((m = re.exec(s))) out.push(m[1].trim() ? m[1].trim().split(/\s+/) : []);
    return out;                                   // array of bracket groups
  };

  const ROMAN = { I:1, V:5, X:10, L:50, C:100 };
  function roman(s) {
    if (!s) return null;
    let t = 0;
    for (let i = 0; i < s.length; i++) {
      const v = ROMAN[s[i]] || 0, n = ROMAN[s[i + 1]] || 0;
      t += v < n ? -v : v;
    }
    return t;
  }

  /* ---------- street naming --------------------------------------------- */
  // canonical street ids, in play order, per family
  const STREETS = {
    stud: ['3rd', '4th', '5th', '6th', '7th'],
    flop: ['preflop', 'flop', 'turn', 'river'],
    draw: ['predraw', 'draw1', 'draw2', 'draw3'],
  };
  const STREET_LABEL = {
    '3rd': '3rd Street', '4th': '4th Street', '5th': '5th Street',
    '6th': '6th Street', '7th': '7th Street (River)',
    preflop: 'Preflop', flop: 'Flop', turn: 'Turn', river: 'River',
    predraw: 'Deal', draw1: 'After 1st Draw', draw2: 'After 2nd Draw', draw3: 'After 3rd Draw',
    showdown: 'Showdown', summary: 'Summary', setup: 'Posting',
  };

  /* =======================================================================
     parse one hand block
     ======================================================================= */
  function parseHand(block, source) {
    const lines = block.split('\n').map(l => l.replace(/\s+$/, '')).filter(l => l !== '');
    if (!lines.length) return null;

    const h = {
      raw: block.trim(), source: source || '',
      id: null, site: 'PokerStars', tourney: null, buyin: null,
      levelRoman: null, level: null, stakes: '', sb: 0, bb: 0, isCash: false,
      date: '', dateObj: null, mixed: null, game: null,
      table: '', maxSeats: 9, buttonSeat: null,
      seats: [], players: {}, events: [], board: [],
      totalPot: 0, rake: 0, potBreakdown: '', summary: [], warnings: [],
      hero: null, heroSeat: null,
    };

    /* ---- header ---- */
    const hm = lines[0].match(
      /^PokerStars (?:Hand|Game) #(\d+):\s+(.*?)\s+-\s+(?:Level\s+([IVXLC]+)\s+)?\(([^)]*)\)\s+-\s+(.+)$/
    );
    if (!hm) return null;
    h.id = hm[1];
    let mid = hm[2];
    h.levelRoman = hm[3] || null;
    h.level = roman(hm[3]);
    h.stakes = hm[4];
    h.date = hm[5].trim();

    const tm = mid.match(/^(?:Zoom |Home Game |Rush )?Tournament #(\d+),\s+(.*)$/);
    if (tm) {
      h.tourney = tm[1];
      let rest = tm[2];
      // buy-in may be "17000+3000", "$10+$1 USD" or bounty style "$0.00+$20.95+$1.05 USD"
      const bm = rest.match(/^(Freeroll|\S*[\d.,]+(?:\+\S*[\d.,]+)+(?:\s+[A-Z]{3})?)\s+(.*)$/);
      if (bm) { h.buyin = bm[1]; rest = bm[2]; }
      mid = rest;
    }
    // Mixed-event wrapper: HORSE (Razz Limit), TORSE (…), HOSE, 8-Game, 10-Game,
    // Mixed NLH/PLO — anything of the form "<event> (<game>)" whose inner part
    // names a game we know.  No list of acronyms to keep up with.
    const mx = mid.match(/^(.+?)\s*\((.+)\)\s*$/);
    if (mx && classifyGame(mx[2]).key !== 'unknown') {
      h.mixed = mx[1].trim();
      mid = mx[2].trim();
    }
    h.game = classifyGame(mid);
    h.game.betting = /No Limit/i.test(mid) ? 'NL' : /Pot Limit/i.test(mid) ? 'PL' : 'FL';
    h.isCash = !h.tourney;
    const st = h.stakes.match(/([\d$.,]+)\s*\/\s*([\d$.,]+)/);
    if (st) { h.sb = num(st[1]); h.bb = num(st[2]); }
    h.dateObj = (function (s) {
      const d = s.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2}):(\d{2})/);
      return d ? new Date(+d[1], +d[2] - 1, +d[3], +d[4], +d[5], +d[6]) : null;
    })(h.date);

    /* ---- table ---- */
    let i = 1;
    const tl = lines[i] && lines[i].match(/^Table\s+'(.+)'\s+(\d+)-max(?:\s+Seat #(\d+) is the button)?/);
    if (tl) { h.table = tl[1]; h.maxSeats = +tl[2]; h.buttonSeat = tl[3] ? +tl[3] : null; i++; }

    /* ---- seats ---- */
    for (; i < lines.length; i++) {
      const sm = lines[i].match(/^Seat (\d+): (.*) \(\$?([\d.,]+) in chips(?:,\s*\$?[\d.,]+ bounty)?\)(.*)$/);
      if (!sm) break;
      const p = {
        seat: +sm[1], name: sm[2], startStack: num(sm[3]),
        sittingOut: /sitting out/i.test(sm[4] || ''), inHand: false,
      };
      h.seats.push(p); h.players[p.name] = p;
    }
    if (!h.seats.length) return null;

    const names = h.seats.map(s => s.name).sort((a, b) => b.length - a.length);
    const nameAlt = names.map(esc).join('|');
    const reActor = new RegExp('^(' + nameAlt + '): (.*)$');
    const reBare  = new RegExp('^(' + nameAlt + ')\\s+(.*)$');

    /* ---- body ---- */
    const ev = h.events;
    const push = (o, line) => { o.line = line; ev.push(o); return o; };
    let inSummary = false;
    const streetsSeen = [];

    for (; i < lines.length; i++) {
      const L = lines[i];

      /* --- street markers --- */
      if (L.startsWith('***')) {
        const nm = L.replace(/\*/g, '').trim();
        const groups = cardsIn(L);
        let id = null, board = null;
        if (/^3rd STREET/.test(nm)) id = '3rd';
        else if (/^4th STREET/.test(nm)) id = '4th';
        else if (/^5th STREET/.test(nm)) id = '5th';
        else if (/^6th STREET/.test(nm)) id = '6th';
        else if (/^HOLE CARDS/.test(nm)) id = 'preflop';
        else if (/^FLOP/.test(nm)) { id = 'flop'; board = groups[groups.length - 1] || []; }
        else if (/^TURN/.test(nm)) { id = 'turn'; board = groups[groups.length - 1] || []; }
        else if (/^RIVER/.test(nm)) {
          if (h.game.fam === 'stud' && !groups.length) id = '7th';
          else { id = 'river'; board = groups[groups.length - 1] || []; }
        }
        else if (/^DEALING HANDS/.test(nm)) id = 'predraw';
        else if (/^FIRST DRAW/.test(nm)) id = 'draw1';
        else if (/^SECOND DRAW/.test(nm)) id = 'draw2';
        else if (/^THIRD DRAW/.test(nm)) id = 'draw3';
        else if (/^SHOW DOWN/.test(nm)) id = 'showdown';
        else if (/^SUMMARY/.test(nm)) { id = 'summary'; inSummary = true; }
        else id = nm.toLowerCase();
        if (id) streetsSeen.push(id);
        push({ t: 'street', id: id, board: board, label: STREET_LABEL[id] || nm }, L);
        continue;
      }

      /* --- summary block --- */
      if (inSummary) {
        let m;
        if ((m = L.match(/^Total pot \$?([\d.,]+)(.*?)(?:\|\s*Rake \$?([\d.,]+))?\s*$/))) {
          h.totalPot = num(m[1]); h.potBreakdown = (m[2] || '').trim(); h.rake = num(m[3]);
        } else if ((m = L.match(/^Board \[([^\]]*)\]/))) {
          h.board = m[1].split(/\s+/).filter(Boolean);
        } else if ((m = L.match(/^Seat (\d+): (.*)$/))) {
          const seatNo = +m[1]; let rest = m[2];
          let pname = null;
          for (const n of names) if (rest.startsWith(n)) { pname = n; break; }
          if (pname) rest = rest.slice(pname.length).trim();
          const rec = { seat: seatNo, name: pname, text: rest, cards: null, won: 0, desc: null };
          const cm = rest.match(/\[([^\]]+)\]/);
          if (cm) rec.cards = cm[1].split(/\s+/);
          const wm = rest.match(/won \(\$?([\d.,]+)\)/) || rest.match(/collected \(\$?([\d.,]+)\)/);
          if (wm) rec.won = num(wm[1]);
          const dm = rest.match(/with (.+)$/);
          if (dm) rec.desc = dm[1];
          const posm = rest.match(/^\((button|small blind|big blind)\)/);
          if (posm) rec.pos = posm[1];
          h.summary.push(rec);
        }
        continue;
      }

      /* --- dealt cards --- */
      let m;
      if ((m = L.match(/^Dealt to (.+?) (\[.*\])\s*$/))) {
        const who = m[1];
        const gs = cardsIn(m[2]);
        push({ t: 'deal', player: who, groups: gs, all: gs.flat() }, L);
        continue;
      }
      if ((m = L.match(/^Uncalled bet \(\$?([\d.,]+)\) returned to (.+)$/))) {
        push({ t: 'uncalled', player: m[2], amount: num(m[1]) }, L); continue;
      }
      if ((m = L.match(/^(.+?) collected \$?([\d.,]+) from (.+)$/))) {
        push({ t: 'collect', player: m[1], amount: num(m[2]), pot: m[3] }, L); continue;
      }
      if (/^Betting is capped/i.test(L)) { push({ t: 'info', kind: 'capped', text: 'Betting is capped' }, L); continue; }
      if (/^No low hand qualified/i.test(L)) { push({ t: 'info', kind: 'nolow', text: 'No low hand qualified' }, L); continue; }

      /* --- "<name>: <action>" --- */
      if ((m = L.match(reActor))) {
        const who = m[1], act = m[2].trim();
        let a;
        if ((a = act.match(/^posts the ante \$?([\d.,]+)/)))
          push({ t: 'post', player: who, kind: 'ante', amount: num(a[1]), allin: /all-in/.test(act) }, L);
        else if ((a = act.match(/^posts small (?:&|and) big blinds? \$?([\d.,]+)/)))
          push({ t: 'post', player: who, kind: 'sb+bb', amount: num(a[1]), allin: /all-in/.test(act) }, L);
        else if ((a = act.match(/^posts small blind \$?([\d.,]+)/)))
          push({ t: 'post', player: who, kind: 'sb', amount: num(a[1]), allin: /all-in/.test(act) }, L);
        else if ((a = act.match(/^posts big blind \$?([\d.,]+)/)))
          push({ t: 'post', player: who, kind: 'bb', amount: num(a[1]), allin: /all-in/.test(act) }, L);
        else if ((a = act.match(/^posts \$?([\d.,]+)/)))
          push({ t: 'post', player: who, kind: 'post', amount: num(a[1]), allin: /all-in/.test(act) }, L);
        else if ((a = act.match(/^brings in for \$?([\d.,]+)/)))
          push({ t: 'act', player: who, verb: 'bringin', to: num(a[1]), allin: /all-in/.test(act) }, L);
        else if (/^checks/.test(act)) push({ t: 'act', player: who, verb: 'check' }, L);
        else if (/^folds/.test(act))  push({ t: 'act', player: who, verb: 'fold' }, L);
        else if ((a = act.match(/^calls \$?([\d.,]+)/)))
          push({ t: 'act', player: who, verb: 'call', amount: num(a[1]), allin: /all-in/.test(act) }, L);
        else if ((a = act.match(/^bets \$?([\d.,]+)/)))
          push({ t: 'act', player: who, verb: 'bet', amount: num(a[1]), allin: /all-in/.test(act) }, L);
        else if ((a = act.match(/^raises \$?([\d.,]+) to \$?([\d.,]+)/)))
          push({ t: 'act', player: who, verb: 'raise', amount: num(a[1]), to: num(a[2]), allin: /all-in/.test(act) }, L);
        else if ((a = act.match(/^discards (\d+) cards?(?:\s*\[([^\]]*)\])?/)))
          push({ t: 'discard', player: who, count: +a[1], cards: a[2] ? a[2].split(/\s+/) : null }, L);
        else if (/^stands pat/.test(act)) {
          const c = act.match(/\[([^\]]*)\]/);
          push({ t: 'pat', player: who, cards: c ? c[1].split(/\s+/) : null }, L);
        }
        else if ((a = act.match(/^shows \[([^\]]*)\](?:\s*\((.*)\))?/)))
          push({ t: 'show', player: who, cards: a[1].split(/\s+/).filter(Boolean), desc: a[2] || null }, L);
        else if ((a = act.match(/^mucks hand/)))    push({ t: 'muck', player: who }, L);
        else if (/^doesn't show hand/.test(act))    push({ t: 'muck', player: who, noShow: true }, L);
        else if ((a = act.match(/^collected \$?([\d.,]+)/)))
          push({ t: 'collect', player: who, amount: num(a[1]), pot: 'pot' }, L);
        else if (/^(sits out|is sitting out|has timed out|said|joins|leaves|is connected|is disconnected|will be allowed)/.test(act))
          push({ t: 'info', player: who, kind: 'status', text: act }, L);
        else push({ t: 'info', player: who, kind: 'other', text: act }, L);
        continue;
      }

      /* --- "<name> <info>" (no colon) --- */
      if ((m = L.match(reBare))) {
        const who = m[1], rest = m[2];
        let fm;
        if ((fm = rest.match(/^finished the tournament(?: in (\d+)(?:st|nd|rd|th) place)?(?: and received \$?([\d.,]+))?/)))
          push({ t: 'finish', player: who, place: fm[1] ? +fm[1] : null, amount: num(fm[2]) }, L);
        else if ((fm = rest.match(/^wins the tournament and receives \$?([\d.,]+)/)))
          push({ t: 'finish', player: who, place: 1, amount: num(fm[1]) }, L);
        else push({ t: 'info', player: who, kind: 'status', text: rest }, L);
        continue;
      }
      push({ t: 'info', kind: 'other', text: L }, L);
    }

    /* ---- who was actually dealt in / who is the hero ---- */
    for (const e of ev) {
      if (e.player && h.players[e.player] && ['post', 'act', 'deal', 'discard', 'pat', 'show'].includes(e.t))
        h.players[e.player].inHand = true;
    }
    const full = h.game.fam === 'stud' ? 3 : h.game.cards;
    for (const e of ev) {
      if (e.t === 'deal' && e.all.length >= full) { h.hero = e.player; break; }
    }
    if (!h.hero) { const d = ev.find(e => e.t === 'deal'); if (d) h.hero = d.player; }
    if (h.hero && h.players[h.hero]) h.heroSeat = h.players[h.hero].seat;

    // everything the observer ever learns about a hand (shown, or mucked-but-listed)
    h.revealed = {};
    for (const e of ev) if (e.t === 'show' && e.cards && e.cards.length) h.revealed[e.player] = e.cards;
    for (const r of h.summary) if (r.name && r.cards) h.revealed[r.name] = r.cards;

    h.streets = streetsSeen;
    return h;
  }

  /* =======================================================================
     parse a whole file
     ======================================================================= */
  function parseFile(text, filename) {
    text = String(text).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
    const blocks = text.split(/\n(?=PokerStars (?:Hand|Game) #)/);
    const hands = [];
    for (const b of blocks) {
      if (!/^PokerStars (?:Hand|Game) #/.test(b.trim())) continue;
      try {
        const hh = parseHand(b, filename);
        if (hh) hands.push(hh);
      } catch (err) {
        console.warn('parse failure in', filename, err);
      }
    }
    return hands;
  }

  global.PSParser = { parseFile, parseHand, STREETS, STREET_LABEL, classifyGame, num };
})(window);
