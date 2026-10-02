/* ===========================================================================
   playmoney.js — play-money tournaments, scored as if they were real.

   A play-money tournament has no summary email and its chips mean nothing, so
   every one is treated as a $100 buy-in paying out by the chart below (rows =
   number of entries, columns = 1st, 2nd, …; each row sums to entries x $100).
   The tournament itself comes from the hand histories: who was seen, who was
   seen busting and in what place.

   Nothing PokerStars paid in play chips is used — not the buy-in, not the
   prize pool, not the payouts.  Only two facts matter: how many entered and
   where each player finished.

   A "Tournament History" email lists every entry, so the number of entries is
   simply the last finishing place (score()).  With only hand histories the
   field has to be estimated (synth()): the highest place anyone was seen
   finishing in — or more, if more different players were seen — unless you
   type the real number in.
   =========================================================================== */
(function (global) {
  'use strict';

  const BUYIN = 100;

  // entries -> payouts by place, for a $100 buy-in.  "6 handed" sheet.
  const CHART_6 = {
    2: [200], 3: [300], 4: [300, 100], 5: [350, 150], 6: [400, 200], 7: [450, 250],
    8: [400, 240, 160], 9: [450, 270, 180], 10: [500, 300, 200], 11: [550, 330, 220], 12: [600, 360, 240],
    13: [590, 350, 220, 140], 14: [630, 380, 240, 150], 15: [680, 410, 250, 160], 16: [720, 440, 270, 170],
    17: [770, 460, 290, 180], 18: [810, 490, 310, 190], 19: [860, 510, 320, 210], 20: [900, 540, 340, 220],
    21: [860, 550, 310, 210, 170], 22: [900, 570, 330, 220, 180], 23: [950, 600, 340, 230, 180],
    24: [990, 620, 360, 240, 190], 25: [1030, 650, 380, 250, 190], 26: [1070, 680, 390, 260, 200],
    27: [1110, 710, 400, 270, 210], 28: [1150, 730, 420, 280, 220],
    29: [1074, 726, 432, 290, 218, 160], 30: [1110, 750, 450, 300, 224, 166], 31: [1148, 776, 464, 310, 232, 170],
    32: [1184, 800, 480, 320, 240, 176], 33: [1220, 824, 496, 330, 248, 182],
    34: [1020, 680, 510, 340, 256, 186, 136, 136, 136], 35: [1050, 700, 524, 350, 264, 192, 140, 140, 140],
    36: [1080, 720, 540, 360, 270, 198, 144, 144, 144], 37: [1110, 740, 554, 370, 278, 204, 148, 148, 148],
    38: [1140, 760, 570, 380, 286, 208, 152, 152, 152], 39: [1170, 780, 586, 390, 292, 214, 156, 156, 156],
  };
  // "7,8,9 handed" sheet — not entered yet; those tables use the 6-handed chart until it is
  const CHART_789 = null;

  const chartFor = maxSeats => (maxSeats > 6 && CHART_789) ? { c: CHART_789, own: true } : { c: CHART_6, own: !(maxSeats > 6) };
  const maxEntries = maxSeats => Math.max(...Object.keys(chartFor(maxSeats).c).map(Number));

  // payouts for a field, or null when the chart does not reach it
  const payouts = (entries, maxSeats) => chartFor(maxSeats).c[entries] || null;
  function payout(entries, place, maxSeats) {
    const p = payouts(entries, maxSeats);
    return p ? (p[place - 1] || 0) : null;
  }

  // "17000+3000" — no currency anywhere means play chips
  const isPlayMoney = buyin => !!buyin && !/[$€£]|USD|EUR|GBP|CAD/i.test(buyin) && /\d/.test(buyin);

  // a summary does not say the table size; the game does (stud is 8-handed)
  const seatsFor = event => /Stud|Razz|HORSE|TORSE|HOSE/i.test(event) ? 8 : 6;

  /* Re-score a play-money summary in place: $100 an entry, entries = the last
     finishing place, payouts from the chart.  The chips PokerStars printed
     stay in the raw text and on each row (r.chips) but count for nothing. */
  function score(t) {
    const n = t.results.length ? Math.max(t.results.length, ...t.results.map(r => r.place)) : (t.players || 0);
    const seats = seatsFor(t.event);
    const ch = chartFor(seats);
    const pays = payouts(n, seats);
    t.results.forEach(r => {
      r.chips = r.amount;
      r.amount = pays ? (pays[r.place - 1] || 0) : 0;
      r.pct = r.amount ? Math.round(r.amount / (n * BUYIN) * 100000) / 1000 : null;
    });
    t.playMoney = true;
    t.chipBuyin = t.buyin ? t.buyin.text : '';
    t.buyin = { text: '$' + BUYIN, parts: [BUYIN], cur: 'USD', total: BUYIN, rake: 0, bounty: 0, prize: BUYIN };
    t.pool = n * BUYIN; t.poolCur = 'USD'; t.added = 0;
    t.entries = n;
    t.paid = pays ? pays.length : 0;
    t.covered = !!pays; t.chartOwn = ch.own;
    t.scoring = '$' + BUYIN + ' buy-in · ' + n + ' entries · ' + (pays
      ? 'pays ' + pays.length + ': ' + pays.map(v => '$' + v).join(' / ') + (ch.own ? '' : '  (6-handed chart; the 7-9 handed one is not entered yet)')
      : 'the payout chart stops at ' + maxEntries(seats) + ' entries, so nothing is paid');
    return t;
  }

  /* how many entered — see the note at the top */
  function estimateEntries(t, override) {
    const fin = t.finishes || {};
    const places = Object.values(fin).map(f => f.place || 0);
    const me = fin[t.hero] || {};
    const floor = Math.max(2, (t.names || []).length, me.place || 0, ...places);
    if (override) return { n: +override, how: 'set by you', floor: floor };
    return { n: floor, how: 'the last place seen in the hand histories — it may have had more', floor: floor };
  }

  const fmtWhen = ms => {
    if (!ms) return '—';
    const d = new Date(ms), z = n => String(n).padStart(2, '0');
    return d.getFullYear() + '/' + z(d.getMonth() + 1) + '/' + z(d.getDate()) + ' ' + z(d.getHours()) + ':' + z(d.getMinutes()) + ':' + z(d.getSeconds()) + ' ET';
  };

  /* a hand-history tournament, in the shape of a summary (tsummary.js) */
  function synth(t, override) {
    const est = estimateEntries(t, override);
    const ch = chartFor(t.maxSeats);
    const pays = payouts(est.n, t.maxSeats);
    const comps = Object.keys(t.games || {}).sort((a, b) => t.games[b] - t.games[a]);
    const event = t.mixed || comps[0] || 'Tournament';
    const results = Object.keys(t.finishes || {})
      .filter(n => t.finishes[n].place)
      .map(n => {
        const place = t.finishes[n].place;
        const amount = pays ? (pays[place - 1] || 0) : 0;
        return { place: place, name: n, entry: 1, country: '', amount: amount,
          pct: amount ? Math.round(amount / (est.n * BUYIN) * 100000) / 1000 : null, qualified: false, note: '' };
      })
      .sort((a, b) => a.place - b.place);
    const me = results.find(r => r.name === t.hero);
    const you = [];
    if (me) you.push('You finished in ' + PSTSum.ord(me.place) + ' place.');
    else you.push('Your finish is not in the hand histories — this one is left out of your numbers.');
    const head = [
      'PokerStars Tournament #' + t.id + ', ' + event,
      'Play money — from hand histories',
      'Buy-In: $' + BUYIN + ' assumed (' + t.buyin + ' play chips)',
      est.n + ' entries (' + est.how + ')',
      'Total Prize Pool: $' + est.n * BUYIN + ' assumed' + (pays ? '' : ' — the payout chart stops at ' + maxEntries(t.maxSeats) + ' entries'),
      pays ? 'Pays ' + pays.length + ': ' + pays.map(v => '$' + v).join(' / ') +
        (ch.own ? '' : '  (6-handed chart; the 7-9 handed one is not entered yet)') : '',
      'First hand seen ' + fmtWhen(t.first),
      'Last hand seen ' + fmtWhen(t.last),
    ].filter(Boolean);
    return {
      id: t.id, event: event, tags: ['Play money — from hand histories'], synthetic: true, satellite: false,
      buyin: { text: '$' + BUYIN + ' assumed', parts: [BUYIN], cur: 'USD', total: BUYIN, rake: 0, bounty: 0, prize: BUYIN },
      players: est.n, entries: est.n, pool: est.n * BUYIN, poolCur: 'USD', added: 0, target: null, tickets: 0,
      start: t.first || t.last || 0, end: t.last || 0, startText: fmtWhen(t.first), endText: fmtWhen(t.last),
      results: results, paid: pays ? pays.length : 0, est: est, chartOwn: ch.own, covered: !!pays,
      hero: { name: t.hero, place: me ? me.place : null, eliminated: [], reentries: 0, reentryCost: 0, bounties: 0, bountyWon: 0 },
      you: you,
      raw: head.concat(results.map(r => ' ' + r.place + ': ' + r.name + ', ' + (r.amount ? '$' + r.amount : ''))).concat(['', you.join(' ')]).join('\n'),
    };
  }

  /* every play-money tournament in the library that has no real summary */
  function synthAll(tourneys, overrides, haveSummary) {
    return tourneys
      .filter(t => isPlayMoney(t.buyin) && !(haveSummary && haveSummary.has(t.id)))
      .map(t => synth(t, overrides && overrides[t.id]));
  }

  global.PSPlay = { BUYIN, CHART_6, CHART_789, payouts, payout, isPlayMoney, estimateEntries, score, synth, synthAll, maxEntries };
})(typeof window !== 'undefined' ? window : globalThis);
