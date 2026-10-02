/* ===========================================================================
   engine.js — turns a parsed hand into an array of replayable snapshots.
   Every snapshot is a complete picture of the table at one moment:
   stacks, chips in front, pot, board, per-player cards (with face-up /
   face-down / unknown fidelity), badges and the log lines consumed so far.
   =========================================================================== */
(function (global) {
  'use strict';

  const STUD_TARGET = { '3rd': 3, '4th': 4, '5th': 5, '6th': 6, '7th': 7 };
  const LBL = global.PSParser.STREET_LABEL;

  function clone(p) {
    return {
      seat: p.seat, name: p.name, stack: p.stack, bet: p.bet, ante: p.ante,
      folded: p.folded, allin: p.allin, inHand: p.inHand, sittingOut: p.sittingOut,
      mucked: p.mucked, shown: p.shown, showDesc: p.showDesc, won: p.won,
      badge: p.badge, last: p.last, isHero: p.isHero, isButton: p.isButton,
      pitched: p.pitched ? { n: p.pitched.n, cards: p.pitched.cards ? p.pitched.cards.slice() : null } : null,
      pos: p.pos, cards: p.cards.map(c => ({ c: c.c, up: c.up })),
    };
  }

  function build(h) {
    const fam = h.game.fam;
    const P = {}, order = [];
    for (const s of h.seats) {
      const p = {
        seat: s.seat, name: s.name, stack: s.startStack, bet: 0, ante: 0,
        folded: false, allin: false, inHand: s.inHand, sittingOut: s.sittingOut,
        mucked: false, shown: false, showDesc: null, won: 0, badge: null, last: null,
        isHero: s.name === h.hero, isButton: h.buttonSeat === s.seat, pos: null,
        pitched: null,          // cards thrown on the current draw, shown on the felt
        cards: [],
      };
      P[s.name] = p; order.push(p);
    }
    // blind positions (flop / draw games)
    for (const e of h.events) {
      if (e.t === 'post' && P[e.player]) {
        if (e.kind === 'sb') P[e.player].pos = 'SB';
        else if (e.kind === 'bb') P[e.player].pos = 'BB';
        else if (e.kind === 'sb+bb') P[e.player].pos = 'SB+BB';
      }
    }
    if (h.buttonSeat != null) { const b = order.find(p => p.seat === h.buttonSeat); if (b && !b.pos) b.pos = 'BTN'; }

    let pot = 0, street = 'setup', board = [], contributed = 0, collected = 0;
    let curEi = -1;                     // index of the event this snapshot ends on
    h.drawLog = [];                     // every discard/stand-pat, for equity look-ahead
    let firstStreet = true;   // blinds/antes stay in front until the first betting round ends
    // No-Limit single draw histories carry no "*** FIRST DRAW ***" marker: the
    // draw is implied by the discard/stand-pat lines, so synthesise the street.
    const hasDrawMarkers = h.streets.some(s => /^draw/.test(s));
    let inDraw = false, drawNo = 0;
    const steps = [];
    let pending = [];

    const flush = () => { for (const p of order) { pot += p.bet; p.bet = 0; } };
    const put = (p, amt) => { const d = Math.min(amt, p.stack); p.stack -= d; p.bet += d; contributed += d; };

    function syntheticDraw() {
      if (hasDrawMarkers || inDraw) { inDraw = true; return; }
      inDraw = true;
      flush();
      drawNo++;
      street = 'draw' + drawNo;
      for (const q of order) { q.badge = null; q.pitched = null; q.last = null; }
    }

    function snap(desc, actor, kind) {
      steps.push({
        i: steps.length, ei: curEi, street: street, streetLabel: LBL[street] || street,
        desc: desc, actor: actor || null, kind: kind || '',
        pot: pot, streetBets: order.reduce((a, p) => a + p.bet, 0),
        board: board.slice(), players: order.map(clone), lines: pending,
      });
      pending = [];
    }

    /* --- card helpers --- */
    function padStud(p, target) {
      while (p.cards.length < target) {
        const ix = p.cards.length;
        p.cards.push({ c: null, up: ix >= 2 && ix <= 5 });
      }
    }
    function dealStud(p, all, target) {
      if (all.length >= target) {
        p.cards = all.map((c, ix) => ({ c: c, up: !(ix === 0 || ix === 1 || ix === 6) }));
      } else {
        const cards = [{ c: null, up: false }, { c: null, up: false }];
        all.forEach(c => cards.push({ c: c, up: true }));
        p.cards = cards;
      }
      padStud(p, target);
    }
    function giveUnknown(p, n) {
      p.cards = [];
      for (let k = 0; k < n; k++) p.cards.push({ c: null, up: false });
    }
    function reveal(p, cards, desc) {
      if (cards && cards.length) p.cards = cards.map(c => ({ c: c, up: true }));
      else p.cards.forEach(c => c.up = true);
      p.shown = true;
      if (desc) p.showDesc = desc;
    }

    // Deal the opening frame before the blinds/antes go in, so a hand never opens
    // on a bare table.  In stud that means everyone's door card face-up (plus the
    // hero's two down cards); in flop and draw games it means a face-down holding
    // for each player and the hero's own cards visible.  Re-applying the same deal
    // events later in the loop is idempotent.
    if (fam === 'stud') {
      for (const e of h.events) {
        if (e.t === 'street' && e.id !== '3rd') break;
        if (e.t !== 'deal') continue;
        const q = P[e.player];
        if (!q) continue;
        q.inHand = true;
        dealStud(q, e.all, STUD_TARGET['3rd']);
      }
    } else {
      for (const q of order) if (q.inHand) giveUnknown(q, h.game.cards);
      for (const e of h.events) {
        if (e.t === 'street' && e.id !== 'preflop' && e.id !== 'predraw') break;
        if (e.t !== 'deal') continue;
        const q = P[e.player];
        if (!q) continue;
        q.inHand = true;
        q.cards = e.all.map(c => ({ c: c, up: false }));
      }
    }

    snap('Hand begins — ' + (h.game.label) + (h.levelRoman ? ', Level ' + h.levelRoman : '') +
         ' (' + h.stakes + ')', null, 'start');

    const ev = h.events;
    for (let n = 0; n < ev.length; n++) {
      const e = ev[n], nx = ev[n + 1];
      curEi = n;
      if (e.line) pending.push(e.line);
      if (e.t === 'discard') h.drawLog.push({ ei: n, player: e.player, count: e.count });
      else if (e.t === 'pat') h.drawLog.push({ ei: n, player: e.player, count: 0 });
      const p = e.player ? P[e.player] : null;
      let desc = null, actor = e.player || null, kind = e.t;

      switch (e.t) {
        case 'street': {
          // the very first street marker only *starts* the betting round the
          // blinds already belong to — nothing to sweep into the pot yet.
          if (!firstStreet) flush();
          firstStreet = false;
          street = e.id;
          if (e.board) board = board.concat(e.board);
          if (street === 'summary') {
            for (const r of h.summary) {
              const q = r.name && P[r.name];
              if (!q) continue;
              if (r.cards) reveal(q, r.cards, r.desc);
              if (/mucked/.test(r.text)) q.mucked = true;
            }
            desc = 'Summary';
          } else if (street === 'showdown') {
            desc = 'Showdown';
          } else {
            desc = e.label;
            if (fam === 'stud' && STUD_TARGET[street]) {
              for (const q of order) if (q.inHand && !q.folded) padStud(q, STUD_TARGET[street]);
            }
            if (street === 'preflop' || street === 'predraw') {
              for (const q of order) if (q.inHand) giveUnknown(q, h.game.cards);
            }
            for (const q of order) { q.badge = null; q.pitched = null; }
          }
          for (const q of order) q.last = null;
          break;
        }
        case 'deal': {
          if (!p) break;
          if (fam === 'stud') dealStud(p, e.all, STUD_TARGET[street] || e.all.length);
          else p.cards = e.all.map(c => ({ c: c, up: false }));
          desc = (street === '7th' || fam !== 'stud') ? 'Cards dealt' : LBL[street] + ' dealt';
          actor = null;
          break;
        }
        case 'post': {
          if (!p) break;
          p.inHand = true;
          if (e.kind === 'ante') {
            const d = Math.min(e.amount, p.stack);
            p.stack -= d; p.ante += d; pot += d; contributed += d;
            desc = 'Antes posted';
            actor = null;
          } else {
            put(p, e.amount);
            p.last = (e.kind === 'sb' ? 'small blind ' : e.kind === 'bb' ? 'big blind ' : 'posts ') + fmt(e.amount);
            desc = p.name + ' posts the ' +
              (e.kind === 'sb' ? 'small blind' : e.kind === 'bb' ? 'big blind' : 'blind') + ' ' + fmt(e.amount);
          }
          if (e.allin) p.allin = true;
          break;
        }
        case 'act': {
          if (!p) break;
          inDraw = false;
          p.inHand = true;
          switch (e.verb) {
            case 'fold':   p.folded = true; p.last = 'folds'; desc = p.name + ' folds'; break;
            case 'check':  p.last = 'checks'; desc = p.name + ' checks'; break;
            case 'call':   put(p, e.amount); p.last = 'calls ' + fmt(e.amount); desc = p.name + ' calls ' + fmt(e.amount); break;
            case 'bet':    put(p, e.amount); p.last = 'bets ' + fmt(e.amount); desc = p.name + ' bets ' + fmt(e.amount); break;
            case 'raise':  put(p, e.to - p.bet); p.last = 'raises to ' + fmt(e.to); desc = p.name + ' raises to ' + fmt(e.to); break;
            case 'bringin':put(p, e.to - p.bet); p.last = 'brings in ' + fmt(e.to); desc = p.name + ' brings in for ' + fmt(e.to); break;
          }
          if (e.allin) { p.allin = true; p.last += ' (all-in)'; desc += ' and is all-in'; }
          break;
        }
        case 'discard': {
          if (!p) break;
          syntheticDraw();
          p.badge = e.count === 0 ? 'pat' : 'draws ' + e.count;
          p.pitched = e.count === 0 ? null : { n: e.count, cards: e.cards || null };
          p.last = e.count === 0 ? 'stands pat' : 'discards ' + e.count;
          desc = p.name + (e.count === 0 ? ' stands pat' : ' discards ' + e.count + ' card' + (e.count > 1 ? 's' : '')) +
                 (e.cards ? ' [' + e.cards.join(' ') + ']' : '');
          break;
        }
        case 'pat': {
          if (!p) break;
          syntheticDraw();
          p.badge = 'pat'; p.pitched = null; p.last = 'stands pat';
          desc = p.name + ' stands pat';
          break;
        }
        case 'show': {
          if (!p) break;
          reveal(p, e.cards, e.desc);
          p.last = 'shows';
          desc = p.name + ' shows ' + e.cards.join(' ') + (e.desc ? ' — ' + e.desc : '');
          break;
        }
        case 'muck': {
          if (!p) break;
          p.mucked = true; p.last = e.noShow ? "doesn't show" : 'mucks';
          desc = p.name + (e.noShow ? " doesn't show" : ' mucks');
          break;
        }
        case 'uncalled': {
          if (!p) break;
          p.stack += e.amount; p.bet = Math.max(0, p.bet - e.amount); contributed -= e.amount;
          desc = 'Uncalled ' + fmt(e.amount) + ' returned to ' + p.name;
          break;
        }
        case 'collect': {
          flush();
          if (p) { p.stack += e.amount; p.won += e.amount; }
          pot = Math.max(0, pot - e.amount);
          collected += e.amount;
          desc = e.player + ' wins ' + fmt(e.amount) + (/main|side/.test(e.pot) ? ' from the ' + e.pot : '');
          break;
        }
        case 'info': {
          if (e.kind === 'capped') desc = 'Betting is capped';
          break;
        }
      }

      // ---- decide whether this event ends a visible step ----
      let snapNow = true;
      if (e.t === 'info' || e.t === 'finish') snapNow = false;
      else if (e.t === 'deal' && nx && nx.t === 'deal') snapNow = false;
      else if (e.t === 'street' && nx && nx.t === 'deal') snapNow = false;
      else if (e.t === 'post' && e.kind === 'ante' && nx && nx.t === 'post' && nx.kind === 'ante') snapNow = false;
      else if (e.t === 'collect' && nx && nx.t === 'collect') snapNow = false;
      else if (e.t === 'uncalled' && nx && nx.t === 'collect') snapNow = false;
      else if (e.t === 'street' && e.id === 'showdown' && nx && (nx.t === 'show' || nx.t === 'muck')) snapNow = false;
      if (snapNow) snap(desc || (e.line || ''), actor, kind);
    }
    if (pending.length) snap('End of hand', null, 'end');

    /* ---- consistency checks (nice loud invariants) ---- */
    const warn = h.warnings;
    if (h.totalPot && Math.abs(collected + h.rake - h.totalPot) > 0.005)
      warn.push('pot mismatch: collected ' + collected + ' + rake ' + h.rake + ' ≠ total pot ' + h.totalPot);
    if (h.totalPot && Math.abs(contributed - h.totalPot) > 0.005)
      warn.push('contribution mismatch: players put in ' + contributed + ' but summary total pot is ' + h.totalPot);
    for (const s of h.summary) {
      if (!s.name) continue;
      const q = P[s.name];
      if (q && s.won && Math.abs(q.won - s.won) > 0.005)
        warn.push(s.name + ' summary win ' + s.won + ' ≠ replayed ' + q.won);
    }

    h.result = {};
    for (const q of order) h.result[q.name] = q.stack - (h.players[q.name].startStack);
    h.finalPlayers = order.map(clone);
    return steps;

    function fmt(v) { return global.PSFmt ? global.PSFmt(v) : String(v); }
  }

  /* Per-player chip result without building the whole replay — the hand list
     needs this for thousands of hands at once.  Same betting rules as build():
     blinds stay live into the first betting round, and a draw with no street
     marker still starts a new one.  Keeping this beside build() is the point:
     two copies of these rules is how the list came to disagree with the table. */
  function netFor(h) {
    const m = moneyFor(h);
    const out = {};
    for (const k in m.put) out[k] = m.got[k] - m.put[k];
    return out;
  }

  /* what each player has put in and taken out — over the whole hand, or only
     up to (not including) event `stop`, for "how big was the pot when…" */
  function moneyFor(h, stop) {
    const put = {}, got = {}, bet = {};
    for (const s of h.seats) { put[s.name] = 0; got[s.name] = 0; bet[s.name] = 0; }
    const hasDrawMarkers = (h.streets || []).some(x => /^draw/.test(x));
    let firstStreet = true, inDraw = false;
    const reset = () => { for (const k in bet) bet[k] = 0; };

    for (let ix = 0; ix < h.events.length; ix++) {
      if (stop != null && ix >= stop) break;
      const e = h.events[ix];
      if (e.t === 'street') {
        if (!firstStreet) reset();
        firstStreet = false;
        inDraw = /^draw/.test(e.id || '');
        continue;
      }
      if (e.t === 'discard' || e.t === 'pat') {
        if (!hasDrawMarkers && !inDraw) { reset(); }
        inDraw = true;
        continue;
      }
      const n = e.player;
      if (n == null || put[n] === undefined) continue;
      if (e.t === 'act') {
        inDraw = false;
        if (e.verb === 'call' || e.verb === 'bet') { put[n] += e.amount; bet[n] += e.amount; }
        else if (e.verb === 'raise' || e.verb === 'bringin') {
          const d = e.to - bet[n]; put[n] += d; bet[n] = e.to;
        }
      } else if (e.t === 'post') {
        put[n] += e.amount;
        if (e.kind !== 'ante') bet[n] += e.amount;
      } else if (e.t === 'uncalled') { put[n] -= e.amount; bet[n] -= e.amount; }
      else if (e.t === 'collect') got[n] += e.amount;
    }
    return { put: put, got: got };
  }

  global.PSEngine = { build, netFor, moneyFor };
})(window);
