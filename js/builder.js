/* ===========================================================================
   builder.js — compose a hand from scratch.

   The builder does not invent a second data path: it writes real PokerStars
   hand-history text, which then goes through the same parser, engine, equity
   and markup as an imported hand.  Anything the replayer can do with a hand
   off the site, it can do with one you made up.

   It also does the bookkeeping for you — call amounts, raise increments,
   all-ins, the uncalled bet, the pot, who wins at showdown (via the same
   evaluators that reproduce PokerStars' own payouts) and the summary block.
   =========================================================================== */
(function (global) {
  'use strict';

  const GAMES = [
    { key: 'razz',   label: 'Razz',             fam: 'stud', cards: 7, bet: ['FL'] },
    { key: 'stud',   label: '7 Card Stud',      fam: 'stud', cards: 7, bet: ['FL'] },
    { key: 'stud8',  label: 'Stud Hi/Lo',       fam: 'stud', cards: 7, bet: ['FL'] },
    { key: 'holdem', label: "Hold'em",          fam: 'flop', cards: 2, bet: ['NL', 'FL', 'PL'] },
    { key: 'omaha',  label: 'Omaha',            fam: 'flop', cards: 4, bet: ['PL', 'NL', 'FL'] },
    { key: 'omaha8', label: 'Omaha Hi/Lo',      fam: 'flop', cards: 4, bet: ['FL', 'PL'] },
    { key: 'td27',   label: '2-7 Triple Draw',  fam: 'draw', cards: 5, draws: 3, bet: ['FL'] },
    { key: 'sd27',   label: '2-7 Single Draw',  fam: 'draw', cards: 5, draws: 1, bet: ['NL', 'FL'] },
    { key: 'a5td',   label: 'A-5 Triple Draw',  fam: 'draw', cards: 5, draws: 3, bet: ['FL'] },
    { key: 'a5sd',   label: 'A-5 Single Draw',  fam: 'draw', cards: 5, draws: 1, bet: ['FL', 'NL'] },
    { key: 'badugi', label: 'Badugi',           fam: 'draw', cards: 4, draws: 3, bet: ['FL', 'PL', 'NL'] },
    { key: 'fcd',    label: '5 Card Draw',      fam: 'draw', cards: 5, draws: 1, bet: ['FL', 'NL', 'PL'] },
  ];
  const gameByKey = k => GAMES.find(g => g.key === k) || GAMES[0];

  function descFor(g, betting) {
    const b = betting === 'NL' ? 'No Limit' : betting === 'PL' ? 'Pot Limit' : 'Limit';
    switch (g.key) {
      case 'razz':   return 'Razz Limit';
      case 'stud':   return '7 Card Stud Limit';
      case 'stud8':  return '7 Card Stud Hi/Lo Limit';
      case 'holdem': return "Hold'em " + b;
      case 'omaha':  return 'Omaha ' + b;
      case 'omaha8': return 'Omaha Hi/Lo ' + b;
      case 'td27':   return 'Triple Draw 2-7 Lowball Limit';
      case 'sd27':   return 'Single Draw 2-7 Lowball ' + b;
      case 'a5td':   return 'Triple Draw A-5 Lowball Limit';
      case 'a5sd':   return 'Single Draw A-5 Lowball ' + b;
      case 'badugi': return 'Badugi ' + b;
      case 'fcd':    return '5 Card Draw ' + b;
    }
    return "Hold'em " + b;
  }

  const STREETS = {
    stud: [
      { id: '3rd', mark: '*** 3rd STREET ***', label: '3rd street', deal: 3 },
      { id: '4th', mark: '*** 4th STREET ***', label: '4th street', deal: 1 },
      { id: '5th', mark: '*** 5th STREET ***', label: '5th street', deal: 1 },
      { id: '6th', mark: '*** 6th STREET ***', label: '6th street', deal: 1 },
      { id: '7th', mark: '*** RIVER ***',      label: '7th street', deal: 1 },
    ],
    flop: [
      { id: 'preflop', mark: '*** HOLE CARDS ***', label: 'preflop', hole: true },
      { id: 'flop',    mark: '*** FLOP ***',       label: 'flop',  board: 3 },
      { id: 'turn',    mark: '*** TURN ***',       label: 'turn',  board: 1 },
      { id: 'river',   mark: '*** RIVER ***',      label: 'river', board: 1 },
    ],
    draw: [
      { id: 'predraw', mark: '*** DEALING HANDS ***', label: 'deal', hole: true },
      { id: 'draw1',   mark: '*** FIRST DRAW ***',    label: '1st draw', drawRound: 0 },
      { id: 'draw2',   mark: '*** SECOND DRAW ***',   label: '2nd draw', drawRound: 1 },
      { id: 'draw3',   mark: '*** THIRD DRAW ***',    label: '3rd draw', drawRound: 2 },
    ],
  };
  function streetsFor(g) {
    const list = STREETS[g.fam];
    if (g.fam === 'draw') return list.slice(0, 1 + (g.draws || 1));
    return list;
  }

  const RS = '23456789TJQKA', SS = 'cdhs';
  const validCard = c => typeof c === 'string' && c.length === 2 &&
    RS.indexOf(c[0]) >= 0 && SS.indexOf(c[1]) >= 0;

  function blank(gameKey) {
    const g = gameByKey(gameKey || 'razz');
    return {
      gameKey: g.key, betting: g.bet[0], level: 'I',
      ante: g.fam === 'stud' ? 25 : 0, sb: 100, bb: 200, bringIn: 50,
      maxSeats: 8, buttonSeat: 1,
      seats: [
        { seat: 1, name: 'Hero', stack: 10000, hero: true, cards: [] },
        { seat: 2, name: 'Villain', stack: 10000, hero: false, cards: [] },
      ],
      board: [],
      draws: {},          // name -> [{n, cards:[…]}, …] per draw round
      actions: {},        // streetId -> [{name, verb, amount}]
    };
  }

  /* ---------- how many cards each seat needs, per street --------------- */
  function needsFor(m) {
    const g = gameByKey(m.gameKey);
    const out = [];
    for (const st of streetsFor(g)) {
      if (st.deal) out.push({ street: st.id, per: st.deal, label: st.label });
      else if (st.hole) out.push({ street: st.id, per: g.cards, label: st.label });
    }
    return out;
  }
  // total cards a seat needs for the whole hand (stud deals across streets)
  function seatCardCount(m) {
    const g = gameByKey(m.gameKey);
    return g.fam === 'stud' ? 7 : g.cards;
  }

  /* =====================================================================
     generate PokerStars text
     ===================================================================== */
  function generate(m) {
    const g = gameByKey(m.gameKey);
    const errors = [], warn = [];
    const seats = (m.seats || []).filter(s => s.name && s.name.trim());
    if (seats.length < 2) errors.push('Add at least two players.');

    const used = {};
    const noteCard = (c, where) => {
      if (!validCard(c)) { errors.push('Bad card "' + c + '" in ' + where + '.'); return; }
      if (used[c]) errors.push(c + ' is used twice (' + used[c] + ' and ' + where + ').');
      used[c] = where;
    };
    const need = seatCardCount(m);
    for (const s of seats) {
      const cs = (s.cards || []).filter(Boolean);
      if (cs.length < need) errors.push(s.name + ' needs ' + need + ' cards (has ' + cs.length + ').');
      cs.forEach(c => noteCard(c, s.name));
    }
    if (g.fam === 'flop') (m.board || []).forEach((c, i) => c && noteCard(c, 'board'));
    if (g.fam === 'draw') {
      for (const s of seats) for (const r of (m.draws[s.name] || []))
        (r.cards || []).forEach(c => c && noteCard(c, s.name + ' draw'));
    }
    if (errors.length) return { text: '', errors: errors };

    /* ---- state ---- */
    const P = {};
    seats.forEach(s => { P[s.name] = { seat: s.seat, bet: 0, put: 0, stack: +s.stack || 0, folded: false, allin: false, name: s.name }; });
    const order = seats.slice().sort((a, b) => a.seat - b.seat);
    const hero = seats.find(s => s.hero) || seats[0];
    const L = [];
    const id = m.handId || ('9' + String(Date.now()).slice(-11));
    const stamp = m.date || (function () {
      const d = new Date();
      const p = n => String(n).padStart(2, '0');
      return d.getFullYear() + '/' + p(d.getMonth() + 1) + '/' + p(d.getDate()) + ' ' +
        d.getHours() + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
    })();

    L.push('PokerStars Hand #' + id + ': Tournament #' + (m.tourneyId || '990000001') +
      ', Freeroll ' + descFor(g, m.betting) + ' - Level ' + (m.level || 'I') +
      ' (' + (m.sb || 0) + '/' + (m.bb || 0) + ') - ' + stamp + ' ET');
    L.push("Table '" + (m.table || 'Practice') + "' " + (m.maxSeats || order.length) + '-max' +
      (g.fam === 'stud' ? '' : ' Seat #' + (m.buttonSeat || order[0].seat) + ' is the button'));
    order.forEach(s => L.push('Seat ' + s.seat + ': ' + s.name + ' (' + (+s.stack || 0) + ' in chips) '));

    const pay = (p, amt) => { const d = Math.max(0, Math.min(amt, p.stack)); p.stack -= d; p.bet += d; p.put += d; if (!p.stack) p.allin = true; return d; };

    /* ---- forced bets ---- */
    if (+m.ante > 0) order.forEach(s => {
      const p = P[s.name], d = Math.min(+m.ante, p.stack);
      p.stack -= d; p.put += d;
      if (!p.stack) p.allin = true;
      L.push(s.name + ': posts the ante ' + d);
    });
    let sbName = null, bbName = null;
    if (g.fam !== 'stud') {
      const n = order.length;
      let bi = order.findIndex(s => s.seat === (m.buttonSeat || order[0].seat));
      if (bi < 0) bi = 0;
      const sbSeat = n === 2 ? order[bi] : order[(bi + 1) % n];
      const bbSeat = n === 2 ? order[(bi + 1) % n] : order[(bi + 2) % n];
      sbName = sbSeat.name; bbName = bbSeat.name;
      const a = pay(P[sbName], +m.sb || 0);
      L.push(sbName + ': posts small blind ' + a + (P[sbName].allin ? ' and is all-in' : ''));
      const b = pay(P[bbName], +m.bb || 0);
      L.push(bbName + ': posts big blind ' + b + (P[bbName].allin ? ' and is all-in' : ''));
    }

    /* ---- streets ---- */
    const streets = streetsFor(g);
    const live = () => order.filter(s => !P[s.name].folded);
    const maxBet = () => order.reduce((mx, s) => Math.max(mx, P[s.name].bet), 0);
    let reached = [];
    let boardOut = [];

    for (let si = 0; si < streets.length; si++) {
      const st = streets[si];
      const acts = (m.actions && m.actions[st.id]) || [];
      // a street happens if it has actions, or an earlier street's action list ran on
      if (si > 0 && !acts.length && !reached.includes(streets[si - 1].id)) break;
      if (si > 0 && !acts.length) {
        // no actions here and none later -> stop after the previous street
        const laterHasActs = streets.slice(si).some(x => ((m.actions || {})[x.id] || []).length);
        if (!laterHasActs) break;
      }
      reached.push(st.id);
      if (si > 0) order.forEach(s => { P[s.name].bet = 0; });

      // marker (+ board)
      if (st.board) {
        const start = boardOut.length;
        const fresh = (m.board || []).slice(start, start + st.board).filter(Boolean);
        if (fresh.length < st.board) return { text: '', errors: ['The ' + st.label + ' needs ' + st.board + ' card(s).'] };
        L.push(st.mark + ' [' + (boardOut.length ? boardOut.join(' ') + '] [' + fresh.join(' ') : fresh.join(' ')) + ']');
        boardOut = boardOut.concat(fresh);
      } else L.push(st.mark);

      // deals
      if (g.fam === 'stud') {
        const upto = st.id === '3rd' ? 3 : ({ '4th': 4, '5th': 5, '6th': 6, '7th': 7 })[st.id];
        for (const s of live()) {
          const cs = s.cards;
          if (s.name === hero.name) {
            if (st.id === '3rd') L.push('Dealt to ' + s.name + ' [' + cs.slice(0, 3).join(' ') + ']');
            else L.push('Dealt to ' + s.name + ' [' + cs.slice(0, upto - 1).join(' ') + '] [' + cs[upto - 1] + ']');
          } else if (st.id !== '7th') {
            // villains show only their up-cards, exactly as the site writes them
            if (st.id === '3rd') L.push('Dealt to ' + s.name + ' [' + cs[2] + ']');
            else L.push('Dealt to ' + s.name + ' [' + cs.slice(2, upto - 1).join(' ') + '] [' + cs[upto - 1] + ']');
          }
        }
      } else if (st.hole) {
        L.push('Dealt to ' + hero.name + ' [' + hero.cards.slice(0, g.cards).join(' ') + ']');
      }

      // draw round: discards then replacements
      if (st.drawRound != null) {
        for (const s of live()) {
          const r = ((m.draws || {})[s.name] || [])[st.drawRound] || { n: 0, cards: [] };
          const n = Math.max(0, Math.min(+r.n || 0, g.cards));
          if (!n) { L.push(s.name + ': stands pat '); continue; }
          const kept = s.cards.slice(0, g.cards - n);
          const gone = s.cards.slice(g.cards - n, g.cards);
          if (s.name === hero.name) {
            L.push(s.name + ': discards ' + n + ' card' + (n > 1 ? 's' : '') + ' [' + gone.join(' ') + ']');
            L.push('Dealt to ' + s.name + ' [' + kept.join(' ') + '] [' + (r.cards || []).slice(0, n).join(' ') + ']');
          } else {
            L.push(s.name + ': discards ' + n + ' card' + (n > 1 ? 's' : ''));
          }
          s.cards = kept.concat((r.cards || []).slice(0, n));   // the hand going forward
        }
      }

      // actions
      for (const a of acts) {
        const p = P[a.name];
        if (!p) { errors.push('Unknown player "' + a.name + '".'); continue; }
        if (a.verb === 'fold') { p.folded = true; L.push(a.name + ': folds '); }
        else if (a.verb === 'check') L.push(a.name + ': checks ');
        else if (a.verb === 'call') {
          const d = pay(p, maxBet() - p.bet);
          L.push(a.name + ': calls ' + d + (p.allin ? ' and is all-in' : ''));
        } else if (a.verb === 'bet') {
          const d = pay(p, +a.amount || 0);
          L.push(a.name + ': bets ' + d + (p.allin ? ' and is all-in' : ''));
        } else if (a.verb === 'raise') {
          const prev = maxBet();
          const to = Math.max(+a.amount || 0, prev + 1);
          const d = pay(p, to - p.bet);
          L.push(a.name + ': raises ' + (p.bet - prev) + ' to ' + p.bet + (p.allin ? ' and is all-in' : ''));
        } else if (a.verb === 'bringin') {
          const d = pay(p, (+a.amount || +m.bringIn || 0) - p.bet);
          L.push(a.name + ': brings in for ' + p.bet);
        }
      }
      if (live().length < 2) break;
    }

    /* ---- uncalled bet ---- */
    const bets = order.map(s => P[s.name].bet).sort((a, b) => b - a);
    if (bets.length > 1 && bets[0] > bets[1]) {
      const back = bets[0] - bets[1];
      const s = order.find(x => P[x.name].bet === bets[0]);
      const p = P[s.name];
      p.stack += back; p.bet -= back; p.put -= back; p.allin = false;
      L.push('Uncalled bet (' + back + ') returned to ' + s.name);
    }

    const total = order.reduce((t, s) => t + P[s.name].put, 0);
    const remaining = live();
    const wins = {};

    if (remaining.length === 1) {
      const w = remaining[0].name;
      wins[w] = total;
      L.push(w + ' collected ' + total + ' from pot');
      L.push(w + ": doesn't show hand ");
    } else if (remaining.length > 1) {
      L.push('*** SHOW DOWN ***');
      const hands = remaining.map(s => s.cards.slice(0, g.fam === 'stud' ? 7 : g.cards));
      remaining.forEach((s, i) => L.push(s.name + ': shows [' + hands[i].join(' ') + ']'));
      const out = new Array(remaining.length).fill(0);
      try {
        global.PSEquity.sharesInto(g.key, hands.map(h => h.map(global.PSEquity.cid)),
          boardOut.map(global.PSEquity.cid), out);
      } catch (e) { out[0] = 1; warn.push('could not score the showdown: ' + e.message); }
      let given = 0;
      remaining.forEach((s, i) => {
        if (out[i] <= 1e-9) return;
        let amt = Math.floor(total * out[i]);
        wins[s.name] = amt; given += amt;
      });
      const first = Object.keys(wins)[0];
      if (first && given < total) wins[first] += total - given;      // odd chip
      Object.keys(wins).forEach(n => L.push(n + ' collected ' + wins[n] + ' from pot'));
      remaining.forEach(s => { if (!wins[s.name]) L.push(s.name + ': mucks hand '); });
    }

    /* ---- summary ---- */
    L.push('*** SUMMARY ***');
    L.push('Total pot ' + total + ' | Rake 0 ');
    if (boardOut.length) L.push('Board [' + boardOut.join(' ') + ']');
    order.forEach(s => {
      const p = P[s.name];
      const pos = g.fam === 'stud' ? ''
        : s.seat === (m.buttonSeat || order[0].seat) ? ' (button)'
        : s.name === sbName ? ' (small blind)' : s.name === bbName ? ' (big blind)' : '';
      let tail;
      if (wins[s.name] != null && remaining.length > 1)
        tail = 'showed [' + s.cards.slice(0, g.fam === 'stud' ? 7 : g.cards).join(' ') + '] and won (' + wins[s.name] + ')';
      else if (wins[s.name] != null) tail = 'collected (' + wins[s.name] + ')';
      else if (p.folded) tail = 'folded';
      else tail = 'mucked [' + s.cards.slice(0, g.fam === 'stud' ? 7 : g.cards).join(' ') + ']';
      L.push('Seat ' + s.seat + ': ' + s.name + pos + ' ' + tail);
    });

    return { text: L.join('\n') + '\n', errors: errors, warnings: warn, pot: total, id: id };
  }

  global.PSBuilder = {
    GAMES, gameByKey, descFor, streetsFor, needsFor, seatCardCount, blank, generate, validCard,
  };
})(window);
