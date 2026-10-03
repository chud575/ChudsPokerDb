/* ===========================================================================
   evtables.js — the HORSE+ EV tables: how much of the pot each starting hand
   wins, on average, all-in to the end against random hands, by number of
   players.  The tables live in js/evdata/<game>.js (generated from HORSE+)
   and are loaded the first time a game needs them.

   tableKey() turns your actual cards into the table's name for them:
     Razz        A23  2JJ                (ranks only, ace low)
     Stud Hi/Lo  KQJ_suited  KQJ_ss  KQJ_rainbow  55A_pair  AAA_trips
     Omaha Hi/Lo AA32|double suited      (ranks + suit shape)
     Hold'em     AKs  AKo  77
   =========================================================================== */
(function (global) {
  'use strict';
  const RN = '23456789TJQKA';
  const hi = c => RN.indexOf(c[0]) + 2, lo = c => c[0] === 'A' ? 1 : hi(c);
  const ch = v => v === 1 || v === 14 ? 'A' : RN[v - 2];
  const tables = {}, waiting = {};
  const GAMES = { razz: 1, stud: 1, stud8: 1, omaha8: 1, holdem: 1 };

  function add(game, data) {
    tables[game] = data;
    (waiting[game] || []).forEach(f => f(data));
    delete waiting[game];
  }
  // a <script> tag, not fetch(): works when the app is opened straight off disk
  function load(game) {
    if (!GAMES[game]) return Promise.resolve(null);
    if (tables[game]) return Promise.resolve(tables[game]);
    return new Promise(res => {
      if (waiting[game]) { waiting[game].push(res); return; }
      waiting[game] = [res];
      const s = document.createElement('script');
      s.src = 'js/evdata/' + game + '.js?v=20261003b';
      s.onerror = () => { (waiting[game] || []).forEach(f => f(null)); delete waiting[game]; };
      document.head.appendChild(s);
    });
  }

  function suitCounts(cards) {
    const m = {};
    cards.forEach(c => { m[c[1]] = (m[c[1]] || 0) + 1; });
    return Object.values(m).sort((a, b) => b - a);
  }

  function tableKey(game, cards) {
    if (game === 'razz') return cards.map(lo).sort((a, b) => a - b).map(ch).join('');
    if (game === 'stud' || game === 'stud8') {
      const v = cards.map(hi).sort((a, b) => b - a);
      if (v[0] === v[2]) return ch(v[0]).repeat(3) + '_trips';
      if (v[0] === v[1] || v[1] === v[2]) {
        const p = v[1], k = v[0] === v[1] ? v[2] : v[0];
        return ch(p) + ch(p) + ch(k) + '_pair';
      }
      const sc = suitCounts(cards)[0];
      return v.map(ch).join('') + '_' + (sc === 3 ? 'suited' : sc === 2 ? 'ss' : 'rainbow');
    }
    if (game === 'omaha8') {
      const r = cards.map(hi).sort((a, b) => b - a).map(ch).join('');
      const sc = suitCounts(cards).join('');
      return r + '|' + (sc === '22' ? 'double suited' : sc === '211' ? 'single suited' : sc === '1111' ? 'rainbow' : 'two suits');
    }
    if (game === 'holdem') {
      const [a, b] = cards.slice().sort((x, y) => hi(y) - hi(x));
      return hi(a) === hi(b) ? a[0] + b[0] : a[0] + b[0] + (a[1] === b[1] ? 's' : 'o');
    }
    return null;
  }

  // a name to show for a table key
  function pretty(game, key) {
    if (game === 'omaha8') { const [r, p] = key.split('|'); return r + ' ' + ({ 'double suited': 'ds', 'single suited': 'ss', rainbow: 'r', 'two suits': '3+1' }[p] || p); }
    if (game === 'stud' || game === 'stud8') {
      const [r, p] = key.split('_');
      return p === 'trips' || p === 'pair' ? r : r + ' ' + ({ suited: 'suited', ss: 'two suited', rainbow: 'rainbow' }[p] || p);
    }
    return key;
  }

  const counts = game => tables[game] ? Object.keys(tables[game].players).map(Number).sort((a, b) => a - b) : [];
  const clampN = (game, n) => { const c = counts(game); if (!c.length) return null; return Math.max(c[0], Math.min(c[c.length - 1], n)); };
  function eq(game, key, n) {
    const t = tables[game];
    if (!t || key == null) return null;
    const row = t.players[String(clampN(game, n))];
    if (!row) return null;
    if (row[key] != null) return row[key];
    if (game === 'omaha8') {                      // a suit shape the table does not list for these ranks: their average
      const r = key.split('|')[0], vals = Object.keys(row).filter(k => k.startsWith(r + '|')).map(k => row[k]);
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    }
    return null;
  }

  global.PSEV = { add, load, tableKey, pretty, eq, counts, clampN, table: g => tables[g] || null, has: g => !!GAMES[g] };
})(window);
