/* ===========================================================================
   buildui.js — the hand-builder screen.
   Edits a model, shows the generated PokerStars text live, and saves finished
   hands into the same list as imported ones.
   =========================================================================== */
(function (global) {
  'use strict';
  const $ = s => document.querySelector(s);
  const el = (t, c, x) => { const e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; };
  const RS = '23456789TJQKA', SS = 'cdhs';
  const SUIT = { c: '♣', d: '♦', h: '♥', s: '♠' };
  const KEY = 'psreplayer.built.v1';

  let m = null, slot = null, lastText = '';

  /* ---------- saved-hand library ---------- */
  const readLib = () => { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) { return []; } };
  const writeLib = a => { try { localStorage.setItem(KEY, JSON.stringify(a)); } catch (e) { console.warn(e); } };

  function loadSaved() {
    const lib = readLib();
    for (const rec of lib) { try { PSApp.addHandText(rec.text, 'built'); } catch (e) { } }
    return lib.length;
  }

  /* ---------- open / close ---------- */
  function open(model) {
    m = model || PSBuilder.blank('razz');
    slot = null;
    $('#bldModal').classList.add('open');
    render();
  }
  const close = () => $('#bldModal').classList.remove('open');

  /* =====================================================================
     render
     ===================================================================== */
  function render() {
    const g = PSBuilder.gameByKey(m.gameKey);
    const form = $('#bldForm');
    form.innerHTML = '';

    /* ---- setup ---- */
    form.appendChild(el('h4', 'sec', 'Game'));
    const row1 = el('div', 'bldRow');
    const gsel = el('select');
    PSBuilder.GAMES.forEach(x => gsel.appendChild(new Option(x.label, x.key)));
    gsel.value = m.gameKey;
    gsel.onchange = () => {
      const keep = m.seats.map(s => ({ seat: s.seat, name: s.name, stack: s.stack, hero: s.hero, cards: [] }));
      const nm = PSBuilder.blank(gsel.value);
      nm.seats = keep; m = nm; slot = null; render();
    };
    row1.appendChild(lab('game', gsel));
    const bsel = el('select');
    g.bet.forEach(b => bsel.appendChild(new Option({ FL: 'Limit', NL: 'No Limit', PL: 'Pot Limit' }[b], b)));
    bsel.value = m.betting; bsel.onchange = () => { m.betting = bsel.value; render(); };
    row1.appendChild(lab('betting', bsel));
    row1.appendChild(lab('ante', num(m.ante, v => m.ante = v)));
    if (g.fam === 'stud') row1.appendChild(lab('bring-in', num(m.bringIn, v => m.bringIn = v)));
    row1.appendChild(lab(g.fam === 'stud' ? 'small bet' : 'small blind', num(m.sb, v => m.sb = v)));
    row1.appendChild(lab(g.fam === 'stud' ? 'big bet' : 'big blind', num(m.bb, v => m.bb = v)));
    form.appendChild(row1);

    /* ---- seats ---- */
    form.appendChild(el('h4', 'sec', 'Players'));
    const need = PSBuilder.seatCardCount(m);
    m.seats.forEach((s, i) => {
      const r = el('div', 'bldSeat');
      const nm = el('input', 'bldName'); nm.value = s.name;
      nm.oninput = () => { renameSeat(s, nm.value); };
      r.appendChild(nm);
      r.appendChild(num(s.stack, v => s.stack = v, 'bldStack'));
      const h = el('button', 'bldTag' + (s.hero ? ' on' : ''), 'hero');
      h.title = 'Whose hole cards the replay shows';
      h.onclick = () => { m.seats.forEach(x => x.hero = false); s.hero = true; render(); };
      r.appendChild(h);
      if (g.fam !== 'stud') {
        const b = el('button', 'bldTag' + (m.buttonSeat === s.seat ? ' on' : ''), 'button');
        b.onclick = () => { m.buttonSeat = s.seat; render(); };
        r.appendChild(b);
      }
      const cw = el('div', 'bldCards');
      for (let k = 0; k < need; k++) cw.appendChild(cardSlot(s.cards[k], { kind: 'seat', name: s.name, idx: k },
        g.fam === 'stud' ? (k < 2 || k === 6 ? 'down' : 'up') : ''));
      r.appendChild(cw);
      const del = el('button', 'bldX', '✕');
      del.onclick = () => { m.seats.splice(i, 1); render(); };
      if (m.seats.length > 2) r.appendChild(del);
      form.appendChild(r);
    });
    const add = el('button', 'btn', '+ player');
    add.onclick = () => {
      const seat = Math.max(0, ...m.seats.map(s => s.seat)) + 1;
      m.seats.push({ seat: seat, name: 'Player ' + seat, stack: 10000, hero: false, cards: [] });
      render();
    };
    form.appendChild(add);

    /* ---- board ---- */
    if (g.fam === 'flop') {
      form.appendChild(el('h4', 'sec', 'Board'));
      const bw = el('div', 'bldCards');
      ['flop', 'flop', 'flop', 'turn', 'river'].forEach((lbl, k) =>
        bw.appendChild(cardSlot(m.board[k], { kind: 'board', idx: k })));
      form.appendChild(bw);
    }

    /* ---- draws ---- */
    if (g.fam === 'draw') {
      form.appendChild(el('h4', 'sec', 'Draws'));
      for (let round = 0; round < (g.draws || 1); round++) {
        const sec = el('div', 'bldDraw');
        sec.appendChild(el('b', null, ['1st', '2nd', '3rd'][round] + ' draw'));
        m.seats.forEach(s => {
          const rec = ((m.draws[s.name] = m.draws[s.name] || []))[round] || (m.draws[s.name][round] = { n: 0, cards: [] });
          const line = el('div', 'bldDrawRow');
          line.appendChild(el('span', 'bldWho', s.name));
          const n = el('select');
          for (let k = 0; k <= g.cards; k++) n.appendChild(new Option(k === 0 ? 'pat' : 'draw ' + k, k));
          n.value = rec.n;
          n.onchange = () => { rec.n = +n.value; rec.cards = rec.cards.slice(0, rec.n); render(); };
          line.appendChild(n);
          const cw = el('div', 'bldCards');
          for (let k = 0; k < rec.n; k++)
            cw.appendChild(cardSlot(rec.cards[k], { kind: 'draw', name: s.name, round: round, idx: k }));
          line.appendChild(cw);
          sec.appendChild(line);
        });
        form.appendChild(sec);
      }
    }

    /* ---- actions ---- */
    form.appendChild(el('h4', 'sec', 'Action'));
    PSBuilder.streetsFor(g).forEach(st => {
      const box = el('div', 'bldStreet');
      box.appendChild(el('b', null, st.label));
      const list = (m.actions[st.id] = m.actions[st.id] || []);
      list.forEach((a, i) => {
        const r = el('div', 'bldAct');
        r.appendChild(el('span', 'bldWho', a.name));
        r.appendChild(el('span', 'bldVerb', a.verb === 'raise' ? 'raises to ' + (a.amount || 0)
          : a.verb === 'bet' ? 'bets ' + (a.amount || 0)
          : a.verb === 'bringin' ? 'brings in ' + (a.amount || m.bringIn)
          : a.verb === 'call' ? 'calls' : a.verb + 's'));
        const x = el('button', 'bldX', '✕');
        x.onclick = () => { list.splice(i, 1); render(); };
        r.appendChild(x);
        box.appendChild(r);
      });
      const addr = el('div', 'bldAdd');
      const who = el('select');
      m.seats.forEach(s => who.appendChild(new Option(s.name, s.name)));
      const verb = el('select');
      const verbs = (g.fam === 'stud' && st.id === '3rd')
        ? ['bringin', 'fold', 'call', 'raise'] : ['check', 'bet', 'call', 'raise', 'fold'];
      verbs.forEach(v => verb.appendChild(new Option(v, v)));
      const amt = el('input', 'bldAmt'); amt.type = 'number'; amt.placeholder = 'amount';
      amt.value = defaultAmount(g, st, verb.value);
      verb.onchange = () => { amt.value = defaultAmount(g, st, verb.value); amt.style.display = /bet|raise|bringin/.test(verb.value) ? '' : 'none'; };
      amt.style.display = /bet|raise|bringin/.test(verb.value) ? '' : 'none';
      const go = el('button', 'btn', 'add');
      go.onclick = () => {
        list.push({ name: who.value, verb: verb.value, amount: +amt.value || 0 });
        render();
      };
      addr.appendChild(who); addr.appendChild(verb); addr.appendChild(amt); addr.appendChild(go);
      box.appendChild(addr);
      form.appendChild(box);
    });

    /* ---- card picker ---- */
    const pick = $('#bldPick');
    pick.innerHTML = '';
    if (slot) {
      pick.appendChild(el('div', 'bldPickHead', 'pick a card for ' +
        (slot.kind === 'board' ? 'the board' : slot.name + (slot.kind === 'draw' ? ' (draw)' : ''))));
      const used = usedCards();
      for (const s of SS) {
        const row = el('div', 'bldPickRow');
        for (const r of RS) {
          const code = r + s;
          const b = el('button', 'bldCard c' + s + (used[code] ? ' used' : ''),
            (r === 'T' ? '10' : r) + SUIT[s]);
          b.disabled = !!used[code];
          b.onclick = () => { setCard(code); };
          row.appendChild(b);
        }
        pick.appendChild(row);
      }
      const clr = el('button', 'btn', 'clear this slot');
      clr.onclick = () => setCard(null);
      pick.appendChild(clr);
    }

    preview();
  }

  function defaultAmount(g, st, verb) {
    if (verb === 'bringin') return m.bringIn;
    const big = /5th|6th|7th|turn|river|draw2|draw3/.test(st.id);
    const unit = big ? (+m.bb || 0) * (g.fam === 'stud' ? 2 : 1) : (+m.bb || 0);
    return verb === 'raise' ? unit * 2 : unit;
  }

  const lab = (t, node) => { const w = el('label', 'bldLab'); w.appendChild(el('span', null, t)); w.appendChild(node); return w; };
  function num(v, set, cls) {
    const i = el('input', cls || 'bldNum'); i.type = 'number'; i.value = v == null ? '' : v;
    i.oninput = () => { set(+i.value || 0); preview(); };
    return i;
  }
  function renameSeat(s, name) {
    const old = s.name;
    s.name = name;
    if (m.draws[old]) { m.draws[name] = m.draws[old]; delete m.draws[old]; }
    Object.values(m.actions).forEach(list => list.forEach(a => { if (a.name === old) a.name = name; }));
    preview();
  }

  function usedCards() {
    const u = {};
    m.seats.forEach(s => (s.cards || []).forEach(c => { if (c) u[c] = 1; }));
    (m.board || []).forEach(c => { if (c) u[c] = 1; });
    Object.values(m.draws || {}).forEach(rs => (rs || []).forEach(r => (r.cards || []).forEach(c => { if (c) u[c] = 1; })));
    return u;
  }

  function cardSlot(code, ref, kind) {
    const active = slot && slot.kind === ref.kind && slot.idx === ref.idx &&
      slot.name === ref.name && slot.round === ref.round;
    const b = el('button', 'bldSlot' + (code ? ' has c' + code[1] : '') + (active ? ' on' : '') +
      (kind ? ' ' + kind : ''), code ? (code[0] === 'T' ? '10' : code[0]) + SUIT[code[1]] : '+');
    if (kind) b.title = kind === 'up' ? 'face up' : 'face down';
    b.onclick = () => { slot = ref; render(); };
    return b;
  }

  function setCard(code) {
    if (!slot) return;
    if (slot.kind === 'seat') {
      const s = m.seats.find(x => x.name === slot.name);
      if (s) { s.cards = s.cards.slice(); s.cards[slot.idx] = code; }
    } else if (slot.kind === 'board') {
      m.board = m.board.slice(); m.board[slot.idx] = code;
    } else if (slot.kind === 'draw') {
      const rec = (m.draws[slot.name] || [])[slot.round];
      if (rec) { rec.cards = rec.cards.slice(); rec.cards[slot.idx] = code; }
    }
    if (code) slot = nextSlot(slot);
    render();
  }

  // walk to the next empty slot so a whole hand can be clicked in without pauses
  function nextSlot(cur) {
    const need = PSBuilder.seatCardCount(m);
    const list = [];
    m.seats.forEach(s => { for (let k = 0; k < need; k++) list.push({ kind: 'seat', name: s.name, idx: k }); });
    if (PSBuilder.gameByKey(m.gameKey).fam === 'flop') for (let k = 0; k < 5; k++) list.push({ kind: 'board', idx: k });
    Object.keys(m.draws || {}).forEach(n => (m.draws[n] || []).forEach((r, ri) => {
      for (let k = 0; k < (r.n || 0); k++) list.push({ kind: 'draw', name: n, round: ri, idx: k });
    }));
    const at = list.findIndex(x => x.kind === cur.kind && x.idx === cur.idx && x.name === cur.name && x.round === cur.round);
    const valOf = r => r.kind === 'seat' ? (m.seats.find(s => s.name === r.name) || { cards: [] }).cards[r.idx]
      : r.kind === 'board' ? m.board[r.idx]
      : ((m.draws[r.name] || [])[r.round] || { cards: [] }).cards[r.idx];
    for (let i = at + 1; i < list.length; i++) if (!valOf(list[i])) return list[i];
    return null;
  }

  /* ---------- live preview ---------- */
  function preview() {
    const r = PSBuilder.generate(m);
    const box = $('#bldStatus'), pre = $('#bldText');
    lastText = r.text || '';
    pre.textContent = lastText || '(nothing yet)';
    if (r.errors && r.errors.length) {
      box.className = 'bldStatus bad';
      box.textContent = r.errors.join('  ·  ');
      $('#bldSave').disabled = true; $('#bldOpen').disabled = true; $('#bldDl').disabled = true;
      return;
    }
    // the real test: does it survive the parser and the engine's invariants?
    let msg = '';
    try {
      const h = PSParser.parseFile(r.text, 'built')[0];
      if (!h) throw new Error('the parser could not read it');
      h.warnings = [];
      const steps = PSEngine.build(h);
      msg = '✓ valid · ' + steps.length + ' steps · pot ' + r.pot +
        (h.warnings.length ? ' · ⚠ ' + h.warnings.join('; ') : '');
      box.className = 'bldStatus' + (h.warnings.length ? ' warn' : ' ok');
    } catch (e) {
      box.className = 'bldStatus bad'; msg = 'generated text did not parse: ' + e.message;
    }
    box.textContent = msg;
    const bad = /did not parse/.test(msg);
    $('#bldSave').disabled = bad; $('#bldOpen').disabled = bad; $('#bldDl').disabled = bad;
  }

  /* ---------- save / open / download ---------- */
  function save(andOpen) {
    if (!lastText) return;
    const h = PSParser.parseFile(lastText, 'built')[0];
    if (!h) return;
    const lib = readLib().filter(x => x.id !== h.id);
    lib.push({ id: h.id, text: lastText, title: m.title || '', saved: Date.now() });
    writeLib(lib);
    PSApp.addHandText(lastText, 'built');
    if (andOpen) { close(); PSApp.openById(h.id); }
    else preview();
    return h.id;
  }

  function download() {
    if (!lastText) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([lastText], { type: 'text/plain' }));
    a.download = 'built-hand.txt';
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 3000);
  }

  /* ---------- wiring ---------- */
  function init() {
    $('#bldNew').onclick = () => open(PSBuilder.blank('razz'));
    $('#bldClose').onclick = close;
    $('#bldSave').onclick = () => save(false);
    $('#bldOpen').onclick = () => save(true);
    $('#bldDl').onclick = download;
    $('#bldModal').addEventListener('keydown', e => {
      if (e.key === 'Escape') close();
      e.stopPropagation();
    });
    const n = loadSaved();
    if (n) console.log('restored', n, 'built hand(s)');
  }

  global.PSBuildUI = { init, open, close, save, loadSaved };
})(window);
