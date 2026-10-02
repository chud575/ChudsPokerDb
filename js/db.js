/* ===========================================================================
   db.js — the hand library.

   Everything imported lives in IndexedDB and stays there: one import per
   tournament, forever after just open it.  Each record keeps the hand's raw
   text (so the library is the authority and can always be re-parsed) plus the
   fields worth indexing, so listing and filtering never touch the parser.

   IndexedDB is blocked for pages opened straight off disk in some browsers.
   `probe()` reports what we actually got so the UI can say so plainly rather
   than silently losing a library.
   =========================================================================== */
(function (global) {
  'use strict';

  const NAME = 'psreplayer.library', VER = 2;   // 2: tournament summaries + player performance records
  let dbp = null, why = '';

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      let r;
      try { r = indexedDB.open(NAME, VER); }
      catch (e) { why = e.message; return rej(e); }
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains('hands')) {
          const s = d.createObjectStore('hands', { keyPath: 'id' });
          s.createIndex('hero', 'hero');
          s.createIndex('tourney', 'tourney');
          s.createIndex('game', 'game');
          s.createIndex('date', 'date');
          s.createIndex('players', 'players', { multiEntry: true });
          s.createIndex('heroGame', ['hero', 'game']);
        }
        if (!d.objectStoreNames.contains('tourneys')) d.createObjectStore('tourneys', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'k' });
        // v2 — PokerStars "Tournament History" summaries, and a performance
        // record per player built from them (one event line per tournament)
        if (!d.objectStoreNames.contains('summaries')) {
          const s = d.createObjectStore('summaries', { keyPath: 'id' });
          s.createIndex('start', 'start');
        }
        if (!d.objectStoreNames.contains('perf')) d.createObjectStore('perf', { keyPath: 'name' });
      };
      r.onsuccess = () => {
        const d = r.result;
        d.onversionchange = () => { d.close(); dbp = null; };   // let a newer tab upgrade
        res(d);
      };
      r.onerror = () => { why = (r.error && r.error.message) || 'refused'; rej(r.error || new Error(why)); };
      r.onblocked = () => { why = 'another tab holds an older version'; rej(new Error(why)); };
    });
    return dbp;
  }

  async function probe() {
    try {
      const d = await open();
      let usage = null;
      if (navigator.storage && navigator.storage.estimate) {
        try { usage = await navigator.storage.estimate(); } catch (e) { }
      }
      return { ok: true, usage: usage };
    } catch (e) {
      return {
        ok: false,
        why: why || e.message,
        hint: location.protocol === 'file:'
          ? 'Browsers block the database for pages opened straight off disk. Serve the folder over http (see the README) and the library will work.'
          : 'This browser refused to open the database.',
      };
    }
  }

  const tx = async (stores, mode, fn) => {
    const d = await open();
    return new Promise((res, rej) => {
      const t = d.transaction(stores, mode);
      let out;
      t.oncomplete = () => res(out);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error || new Error('aborted'));
      out = fn(t);
    });
  };

  /* ---------- a stored hand ---------- */
  function toRecord(h) {
    return {
      id: h.id,
      hero: h.hero || '',
      tourney: h.tourney || '',
      game: h.game.key,
      gameLabel: h.game.label,
      mixed: h.mixed || '',
      betting: h.game.betting || '',
      level: h.levelRoman || '',
      sb: h.sb, bb: h.bb,
      date: h.dateObj ? h.dateObj.getTime() : 0,
      table: h.table,
      maxSeats: h.maxSeats,
      players: h.seats.map(s => s.name),
      pot: h.totalPot,
      file: h.file || '',
      raw: h.raw,
      added: Date.now(),
    };
  }

  /* ---------- import ---------- */
  async function addHands(hands, onProgress) {
    let added = 0, skipped = 0;
    const CH = 400;
    for (let i = 0; i < hands.length; i += CH) {
      const slice = hands.slice(i, i + CH);
      await tx(['hands'], 'readwrite', t => {
        const s = t.objectStore('hands');
        for (const h of slice) {
          const rec = toRecord(h);
          const q = s.get(rec.id);
          q.onsuccess = () => {
            if (q.result) { skipped++; return; }
            s.add(rec); added++;
          };
        }
      });
      if (onProgress) onProgress(Math.min(i + CH, hands.length), hands.length);
    }
    await rebuildTourneys(hands);
    return { added, skipped };
  }

  /* tournament rows, so the library can summarise without scanning every hand */
  async function rebuildTourneys(hands) {
    const byT = {};
    for (const h of hands) {
      if (!h.tourney) continue;
      const t = byT[h.tourney] || (byT[h.tourney] = {
        id: h.tourney, hero: h.hero || '', buyin: h.buyin || '', mixed: h.mixed || '',
        games: {}, first: Infinity, last: 0, hands: 0, finishes: {}, names: [], maxSeats: 0,
      });
      for (const st of h.seats) if (!t.names.includes(st.name)) t.names.push(st.name);
      if (h.maxSeats > t.maxSeats) t.maxSeats = h.maxSeats;
      t.games[h.game.label] = (t.games[h.game.label] || 0) + 1;
      t.hands++;
      const ms = h.dateObj ? h.dateObj.getTime() : 0;
      if (ms && ms < t.first) t.first = ms;
      if (ms > t.last) t.last = ms;
      for (const e of h.events) {
        if (e.t === 'finish') t.finishes[e.player] = { place: e.place, amount: e.amount || 0 };
      }
    }
    const list = Object.values(byT);
    if (!list.length) return;
    await tx(['tourneys'], 'readwrite', t => {
      const s = t.objectStore('tourneys');
      for (const rec of list) {
        const q = s.get(rec.id);
        q.onsuccess = () => {
          const old = q.result;
          if (old) {
            rec.mixed = rec.mixed || old.mixed || '';
            rec.buyin = rec.buyin || old.buyin || '';
            rec.hands = Math.max(rec.hands, old.hands || 0);
            rec.first = Math.min(rec.first, old.first || Infinity);
            rec.last = Math.max(rec.last, old.last || 0);
            for (const g in (old.games || {})) rec.games[g] = Math.max(rec.games[g] || 0, old.games[g]);
            rec.finishes = Object.assign({}, old.finishes || {}, rec.finishes);
            rec.names = [...new Set((old.names || []).concat(rec.names))];
            rec.maxSeats = Math.max(rec.maxSeats, old.maxSeats || 0);
          }
          if (rec.first === Infinity) rec.first = 0;
          s.put(rec);
        };
      }
    });
  }

  /* tournament rows written before they carried everyone seen (names) and the
     table size: fill those in from the stored hands, once */
  async function upgradeTourneys() {
    if ((await getMeta('tourneyVersion')) === 2) return false;
    const agg = {};
    await scan({}, r => {
      if (!r.tourney) return;
      const a = agg[r.tourney] || (agg[r.tourney] = { names: new Set(), maxSeats: 0 });
      (r.players || []).forEach(n => a.names.add(n));
      if (r.maxSeats > a.maxSeats) a.maxSeats = r.maxSeats;
    });
    await tx(['tourneys'], 'readwrite', t => {
      const st = t.objectStore('tourneys');
      for (const id in agg) {
        const q = st.get(id);
        q.onsuccess = () => {
          const rec = q.result;
          if (!rec) return;
          rec.names = [...agg[id].names];
          rec.maxSeats = agg[id].maxSeats;
          st.put(rec);
        };
      }
    });
    await setMeta('tourneyVersion', 2);
    return true;
  }

  /* ---------- reading ---------- */
  async function count() {
    return tx(['hands'], 'readonly', t => {
      let n = 0;
      const q = t.objectStore('hands').count();
      q.onsuccess = () => { n = q.result; };
      return { get v() { return n; } };
    }).then(o => o.v);
  }

  /* walk every hand (optionally one hero / game / player), newest first off the
     date index; cb may return false to stop early */
  async function scan(opts, cb) {
    opts = opts || {};
    const d = await open();
    return new Promise((res, rej) => {
      const t = d.transaction(['hands'], 'readonly');
      const store = t.objectStore('hands');
      let src = store, range = null;
      if (opts.player) { src = store.index('players'); range = IDBKeyRange.only(opts.player); }
      else if (opts.tourney) { src = store.index('tourney'); range = IDBKeyRange.only(opts.tourney); }
      else if (opts.hero && opts.game) { src = store.index('heroGame'); range = IDBKeyRange.only([opts.hero, opts.game]); }
      else if (opts.hero) { src = store.index('hero'); range = IDBKeyRange.only(opts.hero); }
      else src = store.index('date');
      let n = 0;
      const cur = src.openCursor(range, opts.desc ? 'prev' : 'next');
      cur.onsuccess = () => {
        const c = cur.result;
        if (!c) return;
        const rec = c.value;
        if (!opts.hero || opts.player || rec.hero === opts.hero) {
          if (!opts.game || rec.game === opts.game) {
            n++;
            if (cb(rec, n) === false) return;
          }
        }
        c.continue();
      };
      t.oncomplete = () => res(n);
      t.onerror = () => rej(t.error);
    });
  }

  const get = id => tx(['hands'], 'readonly', t => {
    const o = { v: null };
    const q = t.objectStore('hands').get(id);
    q.onsuccess = () => { o.v = q.result || null; };
    return o;
  }).then(o => o.v);

  const allTourneys = () => tx(['tourneys'], 'readonly', t => {
    const o = { v: [] };
    const q = t.objectStore('tourneys').getAll();
    q.onsuccess = () => { o.v = q.result || []; };
    return o;
  }).then(o => o.v);

  /* hero names present in the library, with hand counts */
  async function heroes() {
    const out = {};
    await scan({}, rec => { if (rec.hero) out[rec.hero] = (out[rec.hero] || 0) + 1; });
    return out;
  }

  /* ---------- removal ---------- */
  const clearAll = () => tx(['hands', 'tourneys'], 'readwrite', t => {
    t.objectStore('hands').clear(); t.objectStore('tourneys').clear();
  });
  async function removeTourney(id) {
    const ids = [];
    await scan({ tourney: id }, r => { ids.push(r.id); });
    await tx(['hands', 'tourneys'], 'readwrite', t => {
      const s = t.objectStore('hands');
      ids.forEach(i => s.delete(i));
      t.objectStore('tourneys').delete(id);
    });
    return ids.length;
  }

  /* ---------- tournament summaries ---------- */

  /* Store each tournament (a re-import replaces it — same id, same result) and
     fold its rows into every player's performance record.  Records are keyed
     by tournament id inside, so importing the same email twice changes nothing. */
  async function addSummaries(tourneys) {
    let added = 0, updated = 0;
    const perf = PSTSum.perfFrom(tourneys);
    await tx(['summaries', 'perf'], 'readwrite', t => {
      const s = t.objectStore('summaries');
      for (const rec of tourneys) {
        const q = s.get(rec.id);
        q.onsuccess = () => {
          if (q.result) updated++; else added++;
          rec.imported = (q.result && q.result.imported) || Date.now();
          s.put(rec);
        };
      }
      const ps = t.objectStore('perf');
      for (const name in perf) {
        const q = ps.get(name);
        q.onsuccess = () => {
          const old = q.result;
          const rec = perf[name];
          if (old) {
            rec.events = Object.assign({}, old.events || {}, rec.events);
            rec.country = rec.country || old.country;
          }
          rec.updated = Date.now();
          ps.put(rec);
        };
      }
    });
    return { added: added, updated: updated, players: Object.keys(perf).length };
  }

  const getAll = store => tx([store], 'readonly', t => {
    const o = { v: [] };
    const q = t.objectStore(store).getAll();
    q.onsuccess = () => { o.v = q.result || []; };
    return o;
  }).then(o => o.v);
  const getOne = (store, key) => tx([store], 'readonly', t => {
    const o = { v: null };
    const q = t.objectStore(store).get(key);
    q.onsuccess = () => { o.v = q.result || null; };
    return o;
  }).then(o => o.v);
  const countOf = store => tx([store], 'readonly', t => {
    const o = { v: 0 };
    const q = t.objectStore(store).count();
    q.onsuccess = () => { o.v = q.result; };
    return o;
  }).then(o => o.v);

  const allSummaries = () => getAll('summaries');
  const getSummary = id => getOne('summaries', id);
  const allPerf = () => getAll('perf');
  const getPerf = name => getOne('perf', name);
  const summaryCount = () => countOf('summaries');
  const clearSummaries = () => tx(['summaries', 'perf'], 'readwrite', t => {
    t.objectStore('summaries').clear(); t.objectStore('perf').clear();
  });

  /* ---------- small key/value ---------- */
  const setMeta = (k, v) => tx(['meta'], 'readwrite', t => t.objectStore('meta').put({ k: k, v: v }));
  const getMeta = k => tx(['meta'], 'readonly', t => {
    const o = { v: null };
    const q = t.objectStore('meta').get(k);
    q.onsuccess = () => { o.v = q.result ? q.result.v : null; };
    return o;
  }).then(o => o.v);

  global.PSDB = {
    probe, addHands, count, scan, get, allTourneys, heroes,
    clearAll, removeTourney, setMeta, getMeta, toRecord,
    upgradeTourneys, addSummaries, allSummaries, getSummary, allPerf, getPerf, summaryCount, clearSummaries,
  };
})(window);
