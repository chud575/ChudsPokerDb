/* ===========================================================================
   stats.js — per-player statistics, computed from stored hands.

   One pass over a hand produces a row per player (counters, not percentages);
   rows are then summed per player per game.  Percentages are only formed at
   the end, and every one carries its own denominator so a stat with no
   opportunities reads as "—" rather than 0%.

   Games are kept apart by default: a player's Omaha numbers never land in
   their Stud 8 numbers.
   =========================================================================== */
(function (global) {
  'use strict';

  const FIRST = { stud: '3rd', flop: 'preflop', draw: 'predraw' };

  function newRow() {
    return {
      hands: 0, dealt: 0,
      vpip: 0, vpipOpp: 0,
      pfr: 0, pfrOpp: 0,
      open: 0, openOpp: 0,
      threeBet: 0, threeBetOpp: 0,
      foldTo3Bet: 0, faced3Bet: 0,
      entered: 0, enteredFolded: 0,
      showdown: 0, showdownWon: 0,
      won: 0, wonNoShowdown: 0,
      bets: 0, raises: 0, calls: 0, checks: 0, folds: 0,
      net: 0, potsWon: 0, chipsWon: 0,
      draws: 0, drawCards: 0, pat: 0,
      bringIn: 0, completed: 0,
      allIn: 0,
    };
  }

  /* ---------- one hand -> {player: row} ---------- */
  function rowsFor(h) {
    const fam = h.game.fam;
    const firstStreet = FIRST[fam] || 'preflop';
    const out = {};
    const row = n => out[n] || (out[n] = newRow());

    const dealt = h.seats.filter(s => s.inHand).map(s => s.name);
    for (const n of dealt) { const r = row(n); r.hands = 1; r.dealt = 1; }

    const net = global.PSEngine.netFor(h);
    for (const n in net) if (out[n]) out[n].net = net[n];

    const sawShowdown = h.streets.includes('showdown');
    const folded = new Set();
    let street = 'setup';
    let raisesThisRound = 0;
    const actedFirstRound = new Set();
    const raisedFirstRound = new Set();
    const facing3Bet = new Set();

    for (const e of h.events) {
      if (e.t === 'street') { street = e.id; if (street !== firstStreet) raisesThisRound = 0; continue; }
      if (e.t === 'discard') {
        const r = out[e.player]; if (!r) continue;
        if (e.count === 0) r.pat++; else { r.draws++; r.drawCards += e.count; }
        continue;
      }
      if (e.t === 'pat') { const r = out[e.player]; if (r) r.pat++; continue; }
      if (e.t !== 'act') continue;
      const r = out[e.player];
      if (!r) continue;
      const first = street === firstStreet;

      if (e.verb === 'fold') {
        r.folds++;
        folded.add(e.player);
        if (first && facing3Bet.has(e.player)) r.foldTo3Bet++;
      } else if (e.verb === 'check') r.checks++;
      else if (e.verb === 'call') r.calls++;
      else if (e.verb === 'bet') r.bets++;
      else if (e.verb === 'raise') r.raises++;
      else if (e.verb === 'bringin') r.bringIn++;
      if (e.allin) r.allIn++;

      if (first) {
        const seenBefore = actedFirstRound.has(e.player);
        // a first-round "bets" is a stud completion with no bring-in posted — money in by choice
        const voluntary = e.verb === 'call' || e.verb === 'raise' || e.verb === 'bet';

        if (!seenBefore) {
          // the player's first decision of the hand
          if (e.verb !== 'bringin') {
            r.vpipOpp++;
            r.pfrOpp++;
            if (voluntary) { r.vpip = 1; r.entered = 1; }
            if (e.verb === 'raise') r.pfr = 1;
            if (raisesThisRound === 0) {
              r.openOpp++;
              if (e.verb === 'raise') r.open++;
            } else if (raisesThisRound === 1) {
              r.threeBetOpp++;
              if (e.verb === 'raise') r.threeBet++;
            }
          }
          actedFirstRound.add(e.player);
        } else if (voluntary) { r.vpip = 1; r.entered = 1; }

        if (e.verb === 'raise') {
          // anyone who had already raised is now facing a re-raise
          for (const n of raisedFirstRound) {
            if (n !== e.player && !folded.has(n)) {
              if (!facing3Bet.has(n)) { facing3Bet.add(n); out[n].faced3Bet++; }
            }
          }
          raisedFirstRound.add(e.player);
          raisesThisRound++;
          if (e.verb === 'raise' && r.bringIn) r.completed++;
        }
      }
    }

    for (const n of dealt) {
      const r = out[n];
      const inAtEnd = !folded.has(n);
      if (sawShowdown && inAtEnd) {
        r.showdown = 1;
        if (r.net > 0) r.showdownWon = 1;
      }
      if (r.net > 0) {
        r.won = 1;
        r.chipsWon = r.net;
        if (!r.showdown) r.wonNoShowdown = 1;
      }
      if (r.entered && folded.has(n)) r.enteredFolded = 1;
    }
    return out;
  }

  /* ---------- summing ---------- */
  function add(a, b) {
    for (const k in b) a[k] = (a[k] || 0) + b[k];
    return a;
  }

  /* build {player: {game: row, _all: row}} from parsed hands */
  function collect(hands, into) {
    const db = into || {};
    for (const h of hands) {
      const rows = rowsFor(h);
      for (const name in rows) {
        const p = db[name] || (db[name] = { games: {}, all: newRow(), tourneys: {}, finishes: {} });
        const g = p.games[h.game.key] || (p.games[h.game.key] = newRow());
        g.label = h.game.label;
        add(g, rows[name]);
        add(p.all, rows[name]);
        if (h.tourney) {
          const t = p.tourneys[h.tourney] || (p.tourneys[h.tourney] = { games: {}, hands: 0, mixed: '' });
          t.games[h.game.label] = (t.games[h.game.label] || 0) + 1;
          if (h.mixed) t.mixed = h.mixed;
          t.hands++;
        }
      }
      for (const e of h.events) {
        if (e.t !== 'finish') continue;
        const p = db[e.player] || (db[e.player] = { games: {}, all: newRow(), tourneys: {}, finishes: {} });
        p.finishes[h.tourney || h.id] = { place: e.place, amount: e.amount || 0 };
      }
    }
    return db;
  }

  /* ---------- presentation ---------- */
  const pct = (n, d) => (d > 0 ? (100 * n / d) : null);
  const fmtPct = v => (v == null ? '—' : v.toFixed(1) + '%');

  /* the headline numbers for one row of counters */
  function summary(r) {
    const aggActions = r.bets + r.raises;
    return [
      { k: 'hands',     label: 'Hands',            v: r.hands,                              raw: r.hands },
      { k: 'vpip',      label: 'VPIP',             v: fmtPct(pct(r.vpip, r.dealt)),          raw: pct(r.vpip, r.dealt),          d: r.dealt },
      { k: 'pfr',       label: 'Raise first round',v: fmtPct(pct(r.pfr, r.dealt)),           raw: pct(r.pfr, r.dealt),           d: r.dealt },
      { k: 'open',      label: 'Open raise',       v: fmtPct(pct(r.open, r.openOpp)),        raw: pct(r.open, r.openOpp),        d: r.openOpp },
      { k: '3bet',      label: '3-bet',            v: fmtPct(pct(r.threeBet, r.threeBetOpp)),raw: pct(r.threeBet, r.threeBetOpp),d: r.threeBetOpp },
      { k: 'f3bet',     label: 'Fold to 3-bet',    v: fmtPct(pct(r.foldTo3Bet, r.faced3Bet)),raw: pct(r.foldTo3Bet, r.faced3Bet),d: r.faced3Bet },
      { k: 'wtsd',      label: 'Went to showdown', v: fmtPct(pct(r.showdown, r.entered)),    raw: pct(r.showdown, r.entered),    d: r.entered },
      { k: 'wsd',       label: 'Won at showdown',  v: fmtPct(pct(r.showdownWon, r.showdown)),raw: pct(r.showdownWon, r.showdown),d: r.showdown },
      { k: 'wns',       label: 'Won without SD',   v: fmtPct(pct(r.wonNoShowdown, r.won)),   raw: pct(r.wonNoShowdown, r.won),   d: r.won },
      { k: 'fold',      label: 'Fold after entering', v: fmtPct(pct(r.enteredFolded, r.entered)), raw: pct(r.enteredFolded, r.entered), d: r.entered },
      { k: 'aggf',      label: 'Aggression freq',  v: fmtPct(pct(aggActions, aggActions + r.calls + r.folds)),
        raw: pct(aggActions, aggActions + r.calls + r.folds), d: aggActions + r.calls + r.folds },
      { k: 'aggf2',     label: 'Aggression factor',v: r.calls ? (aggActions / r.calls).toFixed(2) : '—',
        raw: r.calls ? aggActions / r.calls : null, d: r.calls },
      { k: 'wonpct',    label: 'Hands won',        v: fmtPct(pct(r.won, r.hands)),           raw: pct(r.won, r.hands),           d: r.hands },
      { k: 'net',       label: 'Net chips',        v: Math.round(r.net).toLocaleString(),    raw: r.net },
      { k: 'perhand',   label: 'Chips / hand',     v: r.hands ? (r.net / r.hands).toFixed(1) : '—', raw: r.hands ? r.net / r.hands : null },
    ];
  }

  /* extra rows that only mean something in some families */
  function extras(r, gameKey) {
    const fam = (global.PSParser.classifyGame(gameKey) || {}).fam;
    const out = [];
    const drawish = ['td27', 'sd27', 'a5td', 'a5sd', 'badugi', 'fcd'].includes(gameKey);
    const studish = ['razz', 'stud', 'stud8'].includes(gameKey);
    if (drawish) {
      const rounds = r.draws + r.pat;
      out.push({ label: 'Stands pat', v: fmtPct(pct(r.pat, rounds)), d: rounds });
      out.push({ label: 'Cards / draw', v: r.draws ? (r.drawCards / r.draws).toFixed(2) : '—', d: r.draws });
    }
    if (studish) {
      out.push({ label: 'Brought in', v: r.bringIn, d: r.hands });
      out.push({ label: 'Completed', v: r.completed, d: r.bringIn });
    }
    out.push({ label: 'All-in', v: r.allIn, d: r.hands });
    return out;
  }

  function tourneySummary(p) {
    const byGame = {};
    for (const id in p.tourneys) {
      const t = p.tourneys[id];
      const comps = Object.keys(t.games).sort((a, b) => t.games[b] - t.games[a]);
      const name = t.mixed || comps[0] || '—';     // the header names the event
      byGame[name] = (byGame[name] || 0) + 1;
    }
    const known = Object.keys(p.finishes).length;
    let cashed = 0, best = null;
    for (const id in p.finishes) {
      const f = p.finishes[id];
      if (f.amount > 0) cashed++;
      if (f.place && (best == null || f.place < best)) best = f.place;
    }
    return {
      played: Object.keys(p.tourneys).length,
      byGame: byGame,
      finishesKnown: known,
      cashed: cashed,
      cashRate: known ? pct(cashed, known) : null,
      bestPlace: best,
    };
  }

  global.PSStats = { rowsFor, collect, summary, extras, tourneySummary, newRow, add, pct, fmtPct };
})(window);
