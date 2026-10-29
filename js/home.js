/* ===========================================================================
   home.js — the main menu and the views that sit beside the replayer:
   the library (what has been imported), the player database, and your own
   numbers.  Routing is a body class; each view builds itself on entry.
   =========================================================================== */
(function (global) {
  'use strict';
  const $ = s => document.querySelector(s);
  const el = (t, c, x) => { const e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; };
  const fmt = n => Math.round(n).toLocaleString();

  let view = 'home';
  let libOk = false, libNote = '';
  let cache = null;          // parsed hands from the library, this session
  let statDb = null;         // player -> stats
  let perfDb = null;         // player -> tournament performance record (from summaries)
  let perfJob = null, perfGen = 0;   // a build in flight, and which reset it belongs to
  let hero = '';
  let accounts = [];         // your own names, from the summaries you imported

  /* ===================================================================== */
  /* On the hosted site, tell the server which screen was opened — the screen's name and nothing
     else, counted anonymously for the site's usage page. Off disk or on the bare address it is silent. */
  let shown = false;
  function track(v) {
    if (!shown) { shown = true; return; }              // the first screen is the page load, already counted
    try {
      if (location.protocol !== 'https:' || !navigator.sendBeacon) return;
      navigator.sendBeacon('/auth/t', new Blob([JSON.stringify({ a: 'replayer', v: v })], { type: 'application/json' }));
    } catch (e) { }
  }

  function show(v) {
    if (v !== view || !shown) track(v);
    view = v;
    if (document.scrollingElement) document.scrollingElement.scrollLeft = 0;
    document.body.className = document.body.className.replace(/\bview-\w+/g, '').trim() + ' view-' + v;
    fitChrome();                 // the replayer's tools change how tall the top bar is
    if (v === 'library') refreshLibrary();
    if (v === 'players') refreshPlayers();
    if (v === 'me') openMe();
    if (v === 'home') refreshHome();
    if (v === 'replayer') { setTimeout(() => PSApp.redraw(), 20); fillLoader(); }
    if (v === 'lessons' && global.PSPlans) PSPlans.render();
    if (v === 'tourneys' && global.PSTourneys) PSTourneys.render();
    if (v === 'starts' && global.PSStart) PSStart.render();
    if (v === 'luck' && global.PSLuckUI) PSLuckUI.render();
    if (v === 'draws' && global.PSDraws) PSDraws.render();
  }

  /* ---------- library ---------- */
  async function ensureLibrary(onProgress) {
    if (cache) return cache;
    const recs = [];
    await PSDB.scan({}, r => { recs.push(r); });
    if (onProgress) onProgress(recs.length);
    const hands = recs.length
      ? PSParser.parseFile(recs.map(r => r.raw).join('\n\n'), 'library')
      : [];
    cache = { recs: recs, hands: hands };
    return cache;
  }
  const dropCache = () => { cache = null; statDb = null; perfDb = null; perfJob = null; perfGen++; };

  /* Built once into a local object and handed out whole: two screens asking at the same
     moment share one build, and a reset (an import, an upgrade) mid-build is never half-seen. */
  function ensurePerf() {
    if (perfDb) return Promise.resolve(perfDb);
    if (perfJob) return perfJob;
    const gen = perfGen;
    perfJob = buildPerf().then(db => {
      if (gen === perfGen) perfDb = db;
      perfJob = null;
      return db;
    }, e => { perfJob = null; throw e; });
    return perfJob;
  }
  async function buildPerf() {
    const perfDb = {};
    if (!libOk) return perfDb;
    (await PSDB.allPerf()).forEach(p => { perfDb[p.name] = p; });
    accounts = (await PSDB.getMeta('summaryAccounts')) || [];
    // play-money tournaments from the hand histories, scored by the payout chart;
    // derived fresh each time, never stored — the hands are the authority
    const play = await playTourneys();
    const pp = PSTSum.perfFrom(play);
    // chops: what was really paid replaces the official prize for the players in the deal
    const chops = await getChops();
    for (const tid in chops) {
      const t = play.find(x => x.id === tid) || await PSDB.getSummary(tid);
      if (!t) continue;
      PSTSum.applyChop(t, chops[tid]);
      for (const n in chops[tid].pct) {
        const src = pp[n] && pp[n].events[tid] ? pp : perfDb;
        const ev = src[n] && src[n].events[tid];
        if (!ev) continue;
        const won = t.results.filter(r => r.name === n).reduce((a, r) => a + r.amount, 0);
        src[n] = Object.assign({}, src[n], { events: Object.assign({}, src[n].events, { [tid]: Object.assign({}, ev, { won: won, chop: chops[tid].pct[n] }) }) });
      }
    }
    for (const n in pp) {
      if (perfDb[n]) perfDb[n] = Object.assign({}, perfDb[n], { events: Object.assign({}, pp[n].events, perfDb[n].events) });
      else perfDb[n] = pp[n];
    }
    return perfDb;
  }

  async function refreshHome() {
    const box = $('#homeCounts');
    box.textContent = '…';
    if (!libOk) { box.innerHTML = '<span class="warn">library unavailable — ' + libNote + '</span>'; return; }
    const n = await PSDB.count();
    const ts = await PSDB.allTourneys();
    const hs = await PSDB.heroes();
    const sn = await PSDB.summaryCount();
    hero = hero || Object.keys(hs).sort((a, b) => hs[b] - hs[a])[0] || '';
    const bits = [];
    if (n) bits.push(fmt(n) + ' hands · ' + ts.length + ' tournaments' + (hero ? ' · hero <b>' + hero + '</b>' : ''));
    if (sn) bits.push(sn + ' tournament results');
    box.innerHTML = bits.length ? bits.join(' · ') : 'nothing imported yet';
  }

  async function refreshLibrary() {
    const st = $('#libStatus'), body = $('#libBody');
    st.innerHTML = (libOk ? 'Stored in this browser, at this address: <b>' + where() + '</b>. ' +
        'Open the app any other way (another browser, or localhost instead of the file) and you get a ' +
        'separate, empty library — the data here is untouched. Back it up to move it.'
      : '<span class="warn">' + libNote + '</span>');
    body.innerHTML = '';
    if (!libOk) return;
    const ts = (await PSDB.allTourneys()).sort((a, b) => b.last - a.last);
    const sumIds = new Set((await PSDB.allSummaries()).map(x => x.id));
    const n = await PSDB.count();
    $('#libCount').textContent = fmt(n) + ' hands · ' + ts.length + ' tournaments';
    if (!ts.length) { body.appendChild(el('div', 'empty', 'Nothing imported yet — use “Import files”.')); return; }
    const tbl = el('table', 'tbl');
    const head = tbl.insertRow();
    ['Tournament', 'When', 'Games', 'Hands', 'Your finish', ''].forEach(h => {
      const c = document.createElement('th'); c.textContent = h; head.appendChild(c);
    });
    for (const t of ts) {
      const r = tbl.insertRow();
      r.insertCell().textContent = '#' + t.id + (t.buyin ? ' · ' + t.buyin : '') + (t.ko ? ' · KO' : '');
      r.insertCell().textContent = t.last ? new Date(t.last).toLocaleDateString() : '—';
      const comps = Object.keys(t.games).sort((a, b) => t.games[b] - t.games[a]);
      const cell = r.insertCell();
      const name = eventName(t);
      if (name) {
        cell.appendChild(el('b', null, name));
        cell.appendChild(el('span', 'dim', '  ' + comps.join(', ')));
      } else cell.textContent = comps.join(', ');
      cell.title = (name ? name + ' — ' : '') + comps.join(', ');
      r.insertCell().textContent = t.hands;
      const f = t.finishes && t.finishes[t.hero || hero];
      r.insertCell().textContent = f ? (f.place ? f.place + (f.amount ? ' · won ' + fmt(f.amount) : '') : '—') : '—';
      const act = r.insertCell();
      if (sumIds.has(t.id)) {
        const rb = el('button', 'btn', 'results');
        rb.title = 'Final standings from the tournament summary';
        rb.onclick = () => { show('tourneys'); PSTourneys.open(t.id); };
        act.appendChild(rb);
      }
      const open = el('button', 'btn', 'open');
      open.onclick = () => openTourney(t.id);
      act.appendChild(open);
      const del = el('button', 'btn', 'remove');
      del.onclick = async () => {
        if (!confirm('Remove tournament #' + t.id + ' and its ' + t.hands + ' hands from the library?')) return;
        await PSDB.removeTourney(t.id); dropCache(); refreshLibrary();
      };
      act.appendChild(del);
    }
    body.appendChild(global.PSTourneys ? PSTourneys.sortable(tbl) : tbl);
  }

  function where() {
    const ua = navigator.userAgent;
    const br = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox'
      : /Safari\//.test(ua) ? 'Safari' : 'this browser';
    return br + ' · ' + (location.protocol === 'file:' ? decodeURIComponent(location.pathname) : location.origin);
  }

  /* ---------- backup / restore: the whole library as one file ---------- */
  async function backup() {
    const recs = [];
    await PSDB.scan({}, r => { recs.push({ id: r.id, raw: r.raw }); });
    const sums = (await PSDB.allSummaries()).map(t => ({ id: t.id, by: (t.hero && t.hero.name) || '', raw: t.raw }));
    const accts = (await PSDB.getMeta('summaryAccounts')) || [];
    const pmEntries = (await PSDB.getMeta('pmEntries')) || {};
    const chops = await getChops();
    const taught = PSLesson.taughtHands();
    const ann = taught.length ? (await PSLesson.exportLesson(taught)).hands : {};
    let plans = null, built = null;
    try { plans = JSON.parse(localStorage.getItem('psreplayer.plans.v1')); } catch (e) { }
    try { built = JSON.parse(localStorage.getItem('psreplayer.built.v1')); } catch (e) { }
    const out = {
      app: 'PokerStars Hand Replayer library backup', v: 1, saved: new Date().toISOString(), from: where(),
      hands: recs, summaries: sums, accounts: accts, pmEntries: pmEntries, chops: chops, annotations: ann, stars: PSLesson.starredIds(), plans: plans, built: built,
    };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(out)], { type: 'application/json' }));
    a.download = 'hand-replayer-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
    toast('Backed up ' + recs.length + ' hands, ' + sums.length + ' tournament results, ' + Object.keys(ann).length + ' annotated hands, ' +
      out.stars.length + ' stars and ' + ((plans && plans.plans) ? plans.plans.length : 0) + ' lessons');
  }

  async function restore(file) {
    if (!file) return;
    let b;
    try { b = JSON.parse(await file.text()); } catch (e) { toast('Not a backup file: ' + e.message, 'bad'); return; }
    if (!b || !Array.isArray(b.hands)) { toast('That file is not a library backup.', 'bad'); return; }
    try {
      const parsed = b.hands.length ? PSParser.parseFile(b.hands.map(h => h.raw).join('\n\n'), 'backup') : [];
      const res = parsed.length ? await PSDB.addHands(parsed) : { added: 0, skipped: 0 };
      if (b.summaries && b.summaries.length) {
        // each block is the tournament exactly as the email printed it; the
        // "You …" lines in it belong to whoever requested that email
        const byWho = {};
        b.summaries.forEach(x => (byWho[x.by || ''] = byWho[x.by || ''] || []).push(x.raw));
        for (const who in byWho) {
          const text = 'Tournament History for your tournaments requested by ' + who + '\n\n' + byWho[who].join('\n\n');
          const parsed = PSTSum.parse(text, 'backup').tourneys;
          if (parsed.length) await PSDB.addSummaries(parsed);
        }
        await rememberAccounts(b.accounts || []);
      }
      if (b.pmEntries) await PSDB.setMeta('pmEntries', Object.assign((await PSDB.getMeta('pmEntries')) || {}, b.pmEntries));
      if (b.chops) await PSDB.setMeta('chops', Object.assign(await getChops(), b.chops));
      if (b.annotations && Object.keys(b.annotations).length) await PSLesson.importLesson({ hands: b.annotations });
      (b.stars || []).forEach(id => PSLesson.star(id, true));
      if (b.plans && b.plans.plans) {
        let cur = { v: 1, plans: [] };
        try { cur = JSON.parse(localStorage.getItem('psreplayer.plans.v1')) || cur; } catch (e) { }
        const have = new Set(cur.plans.map(p => p.id));
        b.plans.plans.forEach(p => { if (!have.has(p.id)) cur.plans.push(p); });
        localStorage.setItem('psreplayer.plans.v1', JSON.stringify(cur));
      }
      if (b.built && b.built.length) {
        let cur = [];
        try { cur = JSON.parse(localStorage.getItem('psreplayer.built.v1')) || []; } catch (e) { }
        const have = new Set(cur.map(x => x.id));
        b.built.forEach(x => { if (!have.has(x.id)) cur.push(x); });
        localStorage.setItem('psreplayer.built.v1', JSON.stringify(cur));
      }
      dropCache();
      toast('Restored ' + res.added + ' hands' + (res.skipped ? ' (' + res.skipped + ' already here)' : '') +
        ' plus annotations, stars and lessons. Reloading…');
      setTimeout(() => location.reload(), 1600);
    } catch (e) {
      toast('Restore failed: ' + e.message + '. Nothing was lost; the backup file is unchanged.', 'bad');
    }
  }

  /* A mixed event is its own name, and the header always carries it — HORSE,
     8-Game, Triple Stud, Mixed NLH/PLO.  Take it from there; never invent one. */
  function eventName(t) { return t.mixed || ''; }

  async function openTourney(id) {
    const recs = [];
    await PSDB.scan({ tourney: id }, r => { recs.push(r); });
    if (!recs.length) { toast('No hands for tournament #' + id + ' in the library — import its hand histories to replay it.', 'info'); return false; }
    PSApp.replaceHands(recs.map(r => r.raw).join('\n\n'), 'tournament ' + id);
    show('replayer');
    return true;
  }
  async function openLibrary() {
    const lib = await ensureLibrary();
    if (!lib.recs.length) return;
    PSApp.replaceHands(lib.recs.map(r => r.raw).join('\n\n'), 'library');
    show('replayer');
  }

  /* ---------- the replayer's own way in and out of a tournament ----------
     A pull-down above the hand list loads any tournament in the library (or the
     whole library) into the replayer, and "Results" goes to the tournament the
     current hand belongs to in the Tournament Overview. */
  async function fillLoader() {
    const sel = $('#fTourney');
    if (!sel || !libOk) { if (sel) sel.style.display = 'none'; return; }
    const ts = (await PSDB.allTourneys()).sort((a, b) => b.last - a.last);
    const total = await PSDB.count();
    const names = {};
    try { (await PSDB.allSummaries()).forEach(s => { names[s.id] = s; }); } catch (e) { }
    const now = PSApp.loaded();
    sel.innerHTML = '';
    // what is loaded: the whole library, one tournament, or something else (one hand, a lesson, a file)
    const one = now.tourneys.length === 1 && now.tourneys[0] ? ts.find(t => t.id === now.tourneys[0]) : null;
    const scope = total && now.n === total ? 'library' : one && now.n === one.hands ? one.id : '';
    if (!scope) sel.appendChild(new Option('Loaded now: ' + now.n.toLocaleString() + ' hand' + (now.n === 1 ? '' : 's') + (one ? ' of #' + one.id : ''), ''));
    sel.appendChild(new Option('Whole library — ' + total.toLocaleString() + ' hands', 'library'));
    const og = document.createElement('optgroup');
    og.label = 'Tournaments — ' + ts.length;
    ts.forEach(t => {
      const comps = Object.keys(t.games || {}).sort((a, b) => t.games[b] - t.games[a]);
      const s = names[t.id];
      const name = (s && s.event) || t.mixed || comps[0] || 'Tournament';
      const fin = t.finishes && t.finishes[t.hero] && t.finishes[t.hero].place;
      og.appendChild(new Option((t.last ? new Date(t.last).toLocaleDateString() + ' · ' : '') + name + ' · ' + t.hands + ' hands' +
        (fin ? ' · ' + PSTSum.ord(fin) : '') + ' · #' + t.id, t.id));
    });
    sel.appendChild(og);
    sel.value = scope;
    sel.style.display = '';
  }
  async function resultsForCurrent() {
    const h = PSApp.hand();
    if (!h || !h.tourney) { toast('This hand is not from a tournament.', 'info'); return; }
    const have = (await PSDB.getSummary(h.tourney)) || (await playTourneys()).some(t => t.id === h.tourney);
    if (!have) { toast('No results for tournament #' + h.tourney + ' yet — import its PokerStars Tournament History to see the standings.', 'info'); return; }
    show('tourneys');
    PSTourneys.open(h.tourney);
  }

  /* ---------- import ---------- */

  /* Everything a load can do — including doing nothing — says so. */
  async function reportLoad(hands, report) {
    report = report || {};
    const notes = [];
    if (report.unreadable && report.unreadable.length)
      notes.push(report.unreadable.length + ' file(s) could not be read: ' + report.unreadable.join(', '));
    if (report.empty && report.empty.length)
      notes.push('no PokerStars hands found in: ' + report.empty.join(', '));
    if (report.nothingUsable)
      notes.push(report.chosen
        ? 'none of those ' + report.chosen + ' file(s) are .txt hand histories'
        : 'no files selected');

    if (!report.parsed) {                       // nothing came in at all
      if (report.summaries && !notes.length) return;   // those went to the Tournament Overview
      toast(notes.join(' · ') || 'nothing was loaded', 'bad');
      return;
    }
    if (notes.length) toast(notes.join(' · '), 'bad');

    if (!hands.length) {                        // parsed fine, but all already known
      if (!notes.length) toast('those hands are already loaded', 'info');
      return;
    }
    await offerImport(hands, notes.length > 0);
  }

  async function offerImport(hands, quiet) {
    if (!hands || !hands.length) return;
    if (!libOk) {
      toast('Loaded ' + hands.length + ' hands for this session only — the library is unavailable (' +
        libNote.split(' — ')[0] + ')', 'bad');
      return;
    }
    let pref = null;
    try { pref = localStorage.getItem('psreplayer.autoimport'); } catch (e) { }
    let yes = pref === 'always';
    if (!pref) {
      const t = hands.filter((h, i, a) => a.findIndex(x => x.tourney === h.tourney) === i).length;
      yes = confirm('Add these ' + hands.length + ' hands (' + t + ' tournament' + (t === 1 ? '' : 's') +
        ') to your library?\n\nThey will be there every time you open the app — you will not need to load the file again.');
      if (yes && confirm('Always add imported files to the library without asking?')) {
        try { localStorage.setItem('psreplayer.autoimport', 'always'); } catch (e) { }
      }
    }
    if (!yes) { toast('Kept for this session only — not added to the library', 'info'); return; }

    let res;
    try {
      res = await PSDB.addHands(hands);
    } catch (e) {
      const quota = /quota/i.test(e && (e.name + ' ' + e.message));
      toast(quota
        ? 'Import failed: the browser storage quota is full. Remove a tournament from the library and try again.'
        : 'Import failed: ' + ((e && e.message) || 'the database refused the write') +
          '. Nothing was added; the hands are still loaded for this session.', 'bad');
      console.error('library import failed', e);
      return;
    }
    dropCache();
    if (!quiet) {
      toast(res.added
        ? res.added + ' hands added to the library' + (res.skipped ? ' · ' + res.skipped + ' already there' : '')
        : 'those ' + res.skipped + ' hands were already in the library', res.added ? 'ok' : 'info');
    }
    await refreshCurrent();
  }

  /* whatever screen is open should show the new state straight away */
  async function refreshCurrent() {
    await refreshHome();
    if (view === 'library') await refreshLibrary();
    if (view === 'players') await refreshPlayers();
    if (view === 'me') await openMe();
    if (view === 'tourneys' && global.PSTourneys) await PSTourneys.render();
    if (view === 'starts' && global.PSStart) await PSStart.render();
    if (view === 'luck' && global.PSLuckUI) await PSLuckUI.render();
  }

  /* play-money tournaments as summaries (playmoney.js); a real summary wins */
  async function playTourneys() {
    if (!libOk || !global.PSPlay) return [];
    const have = new Set((await PSDB.allSummaries()).map(t => t.id));
    const over = (await PSDB.getMeta('pmEntries')) || {};
    return PSPlay.synthAll(await PSDB.allTourneys(), over, have);
  }
  /* chops, by tournament: { tid: { pct: { player: percent } } } */
  const getChops = async () => (libOk ? (await PSDB.getMeta('chops')) : null) || {};
  async function setChop(tid, chop) {
    const all = await getChops();
    if (chop) all[tid] = chop; else delete all[tid];
    await PSDB.setMeta('chops', all);
    perfDb = null; perfJob = null; perfGen++;
  }

  async function setPlayEntries(id, n) {
    const over = (await PSDB.getMeta('pmEntries')) || {};
    if (n) over[id] = n; else delete over[id];
    await PSDB.setMeta('pmEntries', over);
    perfDb = null; perfJob = null; perfGen++;
  }

  /* ---------- tournament summaries (the "Tournament History" email) ---------- */
  async function rememberAccounts(names) {
    const cur = (await PSDB.getMeta('summaryAccounts')) || [];
    names.forEach(n => { if (n && !cur.includes(n)) cur.push(n); });
    await PSDB.setMeta('summaryAccounts', cur);
    accounts = cur;
  }

  /* performance records are derived data: when their shape changes, rebuild
     them all from the stored summaries (satellite links arrived in v2) */
  /* A history pasted without its "requested by" line has no owner, so the "You collected N bounties"
     lines would belong to nobody. Give each such tournament to whichever of your accounts is in it. */
  async function claimHero(tourneys) {
    const mine = new Set(((await PSDB.getMeta('summaryAccounts')) || []).concat(Object.keys(await PSDB.heroes())));
    const claimed = [];
    for (const t of tourneys) {
      if (t.hero && t.hero.name) continue;
      const n = [...mine].find(x => t.results.some(r => r.name === x));
      if (n) { t.hero = Object.assign({}, t.hero || {}, { name: n }); claimed.push(n); }
    }
    return claimed;
  }

  async function upgradePerf() {
    if ((await PSDB.getMeta('perfVersion')) === PSTSum.PERF_VERSION) return;
    // re-read every tournament from its own text, so scoring changes reach old imports
    const byWho = {};
    (await PSDB.allSummaries()).forEach(t => {
      const who = (t.hero && t.hero.name) || '';
      (byWho[who] = byWho[who] || []).push(t.raw);
    });
    for (const who in byWho) {
      const parsed = PSTSum.parse('Tournament History for your tournaments requested by ' + who + '\n\n' + byWho[who].join('\n\n'), 'library').tourneys;
      if (!who) await claimHero(parsed);
      if (parsed.length) await PSDB.addSummaries(parsed);
    }
    await PSDB.setMeta('perfVersion', PSTSum.PERF_VERSION);
    perfDb = null; perfJob = null; perfGen++;
  }

  async function importSummaries(files) {
    if (!libOk) { toast('Tournament results need the library, and it is unavailable here (' + libNote.split(' — ')[0] + ')', 'bad'); return; }
    let tourneys = [], who = [];
    for (const f of files) {
      try {
        const r = PSTSum.parse(f.text, f.name);
        tourneys = tourneys.concat(r.tourneys);
        if (r.requestedBy) who.push(r.requestedBy);
      } catch (e) { toast('Could not read ' + f.name + ': ' + e.message, 'bad'); }
    }
    if (!tourneys.length) { toast('No tournaments found in ' + files.map(f => f.name).join(', '), 'bad'); return; }
    who = who.concat(await claimHero(tourneys));
    let res;
    try {
      res = await PSDB.addSummaries(tourneys);
      await rememberAccounts(who);
      await upgradePerf();
    } catch (e) {
      toast('Saving tournament results failed: ' + ((e && e.message) || 'the database refused the write'), 'bad');
      console.error('summary import failed', e);
      return;
    }
    dropCache();
    toast(tourneys.length + ' tournament results · ' + res.players.toLocaleString() + ' players updated' +
      (res.added < tourneys.length ? ' (' + res.added + ' new, ' + res.updated + ' already here)' : ''));
    if (view === 'home' || view === 'library') show('tourneys'); else await refreshCurrent();
  }

  function toast(msg, kind) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = 'on ' + (kind || 'ok');
    clearTimeout(t._t);
    t._t = setTimeout(() => t.classList.remove('on'), kind === 'bad' ? 9000 : 3800);
    t.onclick = () => t.classList.remove('on');
  }

  /* ---------- players ---------- */
  async function buildStats() {
    if (statDb) return statDb;
    const box = $('#plList');
    box.innerHTML = '<div class="empty">reading the library…</div>';
    const lib = await ensureLibrary();
    statDb = PSStats.collect(lib.hands);
    return statDb;
  }

  async function refreshPlayers() {
    if (!libOk) { $('#plList').innerHTML = '<div class="empty warn">' + libNote + '</div>'; return; }
    const db = await buildStats();
    const pf = await ensurePerf();
    const q = ($('#plSearch').value || '').toLowerCase();
    const gsel = $('#plGame').value;
    const sort = $('#plSort').value;
    const agg = {};
    const A = n => agg[n] || (agg[n] = PSTSum.aggregate(pf[n]));
    const handsOf = n => db[n] ? (gsel ? (db[n].games[gsel] || {}).hands || 0 : db[n].all.hands) : 0;
    const key = sort === 'tourneys' ? (n => A(n).tourneys * 1e6 + handsOf(n))
      : sort === 'net' ? (n => pf[n] ? A(n).net : -1e12)
      : sort === 'roi' ? (n => pf[n] && A(n).tourneys >= 5 ? A(n).roi : -1e12)
      : (n => handsOf(n) * 1e3 + (pf[n] ? A(n).tourneys : 0));
    const names = [...new Set(Object.keys(db).concat(Object.keys(pf)))]
      .filter(n => !q || n.toLowerCase().includes(q))
      .filter(n => !gsel || (db[n] && db[n].games[gsel]))
      .map(n => [n, key(n)]).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(x => x[0]);
    // game filter options
    const games = {};
    for (const n in db) for (const g in db[n].games) games[g] = db[n].games[g].label;
    const sel = $('#plGame'), keep = sel.value;
    sel.innerHTML = '<option value="">All games (kept separate)</option>';
    Object.keys(games).sort((a, b) => games[a].localeCompare(games[b]))
      .forEach(g => sel.appendChild(new Option(games[g], g)));
    sel.value = keep;

    const box = $('#plList');
    box.innerHTML = '';
    box.appendChild(el('div', 'plMeta', names.length + ' players'));
    names.slice(0, 400).forEach(n => {
      const p = db[n];
      const r = p ? (gsel ? p.games[gsel] : p.all) : null;
      const row = el('div', 'plRow' + (n === hero || accounts.includes(n) ? ' me' : ''));
      row.appendChild(el('b', null, n));
      const bits = [];
      if (r) bits.push(r.hands + ' hands');
      if (pf[n]) bits.push(A(n).tourneys + ' tourn.');
      row.appendChild(el('span', 'plN', bits.join(' · ')));
      let right = '';
      if ((sort === 'net' || sort === 'roi') && pf[n]) {
        const a = A(n);
        right = sort === 'roi' ? (a.roi == null ? '' : 'ROI ' + a.roi.toFixed(0) + '%') : PSTSum.money(a.net, a.cur);
      } else if (r) {
        // full-table VPIP when there is enough of it: short-handed hands would inflate it
        const vp = r.dealtFull >= 10 ? PSStats.pct(r.vpipFull, r.dealtFull) : PSStats.pct(r.vpip, r.dealt);
        right = vp == null ? '' : 'VPIP ' + vp.toFixed(0) + '%';
      }
      row.appendChild(el('span', 'plV', right));
      row.onclick = () => openPlayer(n);
      box.appendChild(row);
    });
    if (names.length > 400) box.appendChild(el('div', 'plMeta', 'showing 400 — search to narrow'));
  }

  /* every profile of yours — each hero in the hand histories and each account that requested
     tournament results — in a pull-down; the one picked is remembered */
  const ME_KEY = 'psreplayer.meProfile';
  async function openMe() {
    const pf = await ensurePerf();
    const hs = libOk ? await PSDB.heroes() : {};
    const names = [...new Set(Object.keys(hs).concat(accounts))];
    const tours = n => pf[n] ? Object.keys(pf[n].events).length : 0;
    names.sort((a, b) => (hs[b] || 0) - (hs[a] || 0) || tours(b) - tours(a));
    const sel = $('#meWho');
    sel.innerHTML = '';
    names.forEach(n => {
      const bits = [];
      if (hs[n]) bits.push(hs[n].toLocaleString() + ' hands');
      if (tours(n)) bits.push(tours(n) + ' tournaments');
      sel.appendChild(new Option(n + (bits.length ? ' — ' + bits.join(' · ') : ''), n));
    });
    sel.style.display = names.length > 1 ? '' : 'none';
    let name = '';
    try { name = localStorage.getItem(ME_KEY) || ''; } catch (e) { }
    if (!names.includes(name)) name = hero || names[0] || (PSApp.hand() && PSApp.hand().hero) || '';
    sel.value = name;
    if (!name) { $('#meFlt').innerHTML = ''; $('#meOut').innerHTML = '<div class="empty">Nothing about you in the library yet.</div>'; return; }
    await openPlayer(name, true);
  }

  /* ---------- Your numbers: advanced filters ----------
     Tournament-wide ones (when, game, buy-in, knockout) narrow both the hands and the tournament
     results; hand-by-hand ones (table size, your stack, level) narrow the hands only. */
  const MF_KEY = 'psreplayer.meFilter';
  const MF0 = { range: 'all', from: '', to: '', game: '', minBuy: '', maxBuy: '', ko: '', size: '', stack: '', level: '' };
  let mf = Object.assign({}, MF0);
  try { Object.assign(mf, JSON.parse(localStorage.getItem(MF_KEY)) || {}); } catch (e) { }
  const mfOn = () => Object.keys(MF0).some(k => mf[k] !== MF0[k]);
  const FAM = {
    stud: ['razz', 'stud', 'stud8'], draw: ['badugi', 'td27', 'sd27', 'a5td', 'a5sd', 'fcd', 'badeucy', 'badacey'],
    omaha: ['omaha8', 'omaha', 'o5', 'o6', 'bigo'], holdem: ['holdem'],
  };
  const FAM_NAME = { stud: 'Stud games', draw: 'Draw games', omaha: 'Omaha games', holdem: 'Hold’em', mixed: 'Mixed events (HORSE, 8-Game…)' };
  function mfWindow() {
    const now = new Date();
    if (mf.range === 'all') return [-Infinity, Infinity];
    if (mf.range === 'custom') {
      const d = s => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
      const f = d(mf.from), t = d(mf.to);
      return [f ? f.getTime() : -Infinity, t ? t.getTime() + 864e5 - 1 : Infinity];
    }
    if (mf.range === 'month') return [new Date(now.getFullYear(), now.getMonth(), 1).getTime(), Infinity];
    if (mf.range === 'year') return [new Date(now.getFullYear(), 0, 1).getTime(), Infinity];
    return [new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - (+mf.range - 1) * 864e5, Infinity];
  }
  const buyOk = v => (mf.minBuy === '' || v >= +mf.minBuy) && (mf.maxBuy === '' || v <= +mf.maxBuy);
  const gameOk = (key, mixed) => {
    if (!mf.game) return true;
    if (mf.game === 'fam:mixed') return !!mixed;
    if (mf.game.startsWith('fam:')) return (FAM[mf.game.slice(4)] || []).includes(key);
    return key === mf.game;
  };
  // a hand's buy-in: from the tournament's results when there are any, else its header; play money is $100
  function handBuyin(h, sums) {
    const s = sums[h.tourney];
    if (s && s.buyin) return s.buyin.total;
    const b = String(h.buyin || '');
    if (!b) return null;
    if (!/[$€£]/.test(b)) return 100;
    return b.split('+').reduce((a, x) => a + (parseFloat(x.replace(/[^\d.]/g, '')) || 0), 0);
  }
  function passHand(h, name, sums) {
    const [a, b] = mfWindow(), t = h.dateObj ? h.dateObj.getTime() : 0;
    if (t < a || t > b) return false;
    if (!gameOk(h.game.key, h.mixed)) return false;
    if (mf.minBuy !== '' || mf.maxBuy !== '') { const v = handBuyin(h, sums); if (v == null || !buyOk(v)) return false; }
    if (mf.ko === 'ko' && !h.ko) return false;
    if (mf.ko === 'noko' && h.ko) return false;
    const n = h.seats.filter(z => z.inHand).length;
    if (mf.size === 'full' && n <= 4) return false;
    if (mf.size === 'short' && (n > 4 || n < 3)) return false;
    if (mf.size === 'hu' && n !== 2) return false;
    if (mf.stack) {
      const seat = h.seats.find(z => z.name === name), bb = h.bb || 1, st = seat ? seat.startStack / bb : 0;
      const [lo, hi] = { a: [0, 10], b: [10, 25], c: [25, 50], d: [50, Infinity] }[mf.stack];
      if (st < lo || st >= hi) return false;
    }
    if (mf.level) {
      const L = h.level || 0;
      if (mf.level === 'early' && L > 3) return false;
      if (mf.level === 'middle' && (L < 4 || L > 6)) return false;
      if (mf.level === 'late' && L < 7) return false;
    }
    return true;
  }
  function passEvent(e) {
    const [a, b] = mfWindow();
    if (e.date < a || e.date > b) return false;
    const k = PSParser.classifyGame(e.event).key;
    if (!gameOk(k, k === 'unknown' || /HORSE|8-Game|Mixed|TORSE|HOSE/i.test(e.event))) return false;
    if (!buyOk(e.buyin)) return false;
    if (mf.ko === 'ko' && !e.ko) return false;
    if (mf.ko === 'noko' && e.ko) return false;
    return true;
  }

  function meFilterBar(games, counts) {
    const box = $('#meFlt');
    box.innerHTML = '';
    const bar = el('div', 'fltBar');
    const field = (label, ctl) => { const w = el('label', 'fld'); w.appendChild(el('span', null, label)); w.appendChild(ctl); bar.appendChild(w); return ctl; };
    const sel = (k, opts) => { const s = document.createElement('select'); opts.forEach(([v, t]) => s.appendChild(new Option(t, v))); s.value = mf[k]; s.onchange = () => set(k, s.value); return s; };
    const set = (k, v) => { mf[k] = v; try { localStorage.setItem(MF_KEY, JSON.stringify(mf)); } catch (e) { } openPlayer($('#meWho').value, true); };
    field('When', sel('range', [['all', 'All time'], ['7', 'Last 7 days'], ['30', 'Last 30 days'], ['90', 'Last 90 days'], ['365', 'Last 12 months'], ['month', 'This month'], ['year', 'This year'], ['custom', 'Custom dates']]));
    if (mf.range === 'custom') {
      ['from', 'to'].forEach(k => { const i = document.createElement('input'); i.type = 'date'; i.value = mf[k]; i.onchange = () => set(k, i.value); field(k === 'from' ? 'From' : 'To', i); });
    }
    const g = document.createElement('select');
    g.appendChild(new Option('All games', ''));
    const og1 = document.createElement('optgroup'); og1.label = 'Game type';
    Object.keys(FAM_NAME).forEach(f => og1.appendChild(new Option(FAM_NAME[f], 'fam:' + f)));
    g.appendChild(og1);
    const og2 = document.createElement('optgroup'); og2.label = 'Game';
    Object.keys(games).sort((x, y) => games[x].localeCompare(games[y])).forEach(k => og2.appendChild(new Option(games[k], k)));
    g.appendChild(og2);
    g.value = mf.game; g.onchange = () => set('game', g.value);
    field('Game', g);
    const pair = el('span', 'pair');
    ['minBuy', 'maxBuy'].forEach((k, i) => {
      const n = document.createElement('input'); n.type = 'number'; n.min = 0; n.step = 'any'; n.placeholder = i ? 'max' : 'min'; n.value = mf[k];
      n.onchange = () => set(k, n.value);
      pair.appendChild(n); if (!i) pair.appendChild(el('i', null, '–'));
    });
    field('Buy-in $', pair);
    field('Knockouts', sel('ko', [['', 'Any'], ['ko', 'Knockouts only'], ['noko', 'No knockouts']]));
    field('Table size', sel('size', [['', 'Any'], ['full', '5+ players'], ['short', '3–4 players'], ['hu', 'Heads-up']]));
    field('Your stack', sel('stack', [['', 'Any'], ['a', 'under 10 BB'], ['b', '10–25 BB'], ['c', '25–50 BB'], ['d', '50+ BB']]));
    field('Level', sel('level', [['', 'Any'], ['early', 'Early (I–III)'], ['middle', 'Middle (IV–VI)'], ['late', 'Late (VII+)']]));
    if (mfOn()) { const c = el('button', 'btn', 'Clear filters'); c.onclick = () => { mf = Object.assign({}, MF0); set('range', 'all'); }; bar.appendChild(c); }
    box.appendChild(bar);
    if (counts) box.appendChild(el('div', 'dim trNote', 'Showing ' + counts.h.toLocaleString() + ' of ' + counts.H.toLocaleString() + ' hands' +
      (counts.T ? ' · ' + counts.t + ' of ' + counts.T + ' tournaments' : '') +
      (mf.size || mf.stack || mf.level ? ' — table size, stack and level narrow the hands only; tournament results have no hand-by-hand detail' : '')));
  }

  async function openPlayer(name, isMe) {
    if (!name) return;
    let db = await buildStats();
    const pf = await ensurePerf();
    let p = db[name];
    const pane = isMe ? $('#meOut') : $('#plDetail');
    pane.innerHTML = '';
    let recOverride = null, handsFor = null;
    if (isMe) {
      // the filters: the hands and tournament results that feed everything below
      const lib = await ensureLibrary();
      const sums = {};
      (await PSDB.allSummaries()).forEach(s => { sums[s.id] = s; });
      const all = lib.hands.filter(h => h.seats.some(z => z.name === name && z.inHand));
      const games = {};
      all.forEach(h => { games[h.game.key] = h.game.label; });
      const hs = mfOn() ? all.filter(h => passHand(h, name, sums)) : all;
      handsFor = hs;
      p = mfOn() ? PSStats.collect(hs)[name] : p;
      const rec = pf[name];
      if (rec && mfOn()) {
        const ev = {};
        for (const id in rec.events) if (passEvent(rec.events[id])) ev[id] = rec.events[id];
        recOverride = Object.assign({}, rec, { events: ev });
      }
      const T = rec ? Object.keys(rec.events).length : 0;
      meFilterBar(games, { h: hs.length, H: all.length, t: recOverride ? Object.keys(recOverride.events).length : T, T: T });
      if (mfOn() && !hs.length && (!recOverride || !Object.keys(recOverride.events).length)) {
        pane.appendChild(el('div', 'empty', 'Nothing matches these filters.')); return;
      }
    }
    const isYou = n => n === hero || accounts.includes(n);

    // (Your numbers shows one profile at a time — the pull-down above picks which)
    if (!p && !pf[name]) { pane.appendChild(el('div', 'empty', 'Nothing on ' + name + ' in the library.')); return; }
    if (!p) { renderResults(pane, name, isMe, false, recOverride); return; }

    pane.appendChild(el('h3', null, name + (isMe || isYou(name) ? '  (you)' : '')));
    if (pf[name] && (!recOverride || Object.keys(recOverride.events).length)) renderResults(pane, name, isMe, true, recOverride);

    // tournaments
    const ts = PSStats.tourneySummary(p);
    const tl = el('div', 'plTour');
    tl.appendChild(el('span', null, ts.played + ' tournaments'));
    if (ts.finishesKnown) {
      tl.appendChild(el('span', null, 'finish known in ' + ts.finishesKnown));
      tl.appendChild(el('span', null, ts.cashed + ' with a recorded payout' +
        (ts.cashRate != null ? ' (' + ts.cashRate.toFixed(0) + '%)' : '')));
      if (ts.bestPlace) tl.appendChild(el('span', null, 'best finish ' + ts.bestPlace));
    } else tl.appendChild(el('span', 'dim', 'no finishes recorded in these files'));
    pane.appendChild(tl);
    const byG = el('div', 'plTour dim');
    Object.keys(ts.byGame).forEach(g => byG.appendChild(el('span', null, g + ' ×' + ts.byGame[g])));
    pane.appendChild(byG);

    // one column per game, plus a combined column
    const keys = Object.keys(p.games).sort((a, b) => p.games[b].hands - p.games[a].hands);
    const cols = keys.map(k => ({ key: k, label: p.games[k].label, row: p.games[k] }));
    cols.push({ key: '', label: 'All games', row: p.all });
    const rows = PSStats.summary(cols[0].row).map(x => x.k);
    const tbl = el('table', 'tbl stats');
    const head = tbl.insertRow();
    head.appendChild(document.createElement('th'));
    cols.forEach(c => { const th = document.createElement('th'); th.textContent = c.label; head.appendChild(th); });
    const labels = {};
    PSStats.summary(cols[0].row).forEach(x => labels[x.k] = x.label);
    rows.forEach(k => {
      const tr = tbl.insertRow();
      tr.insertCell().textContent = labels[k];
      cols.forEach(c => {
        const s = PSStats.summary(c.row).find(x => x.k === k);
        const cell = tr.insertCell();
        cell.textContent = s ? s.v : '—';
        if (s && s.d != null && s.d < 20 && /%$/.test(String(s.v))) {
          cell.classList.add('thin');
          cell.title = 'only ' + s.d + ' opportunities — treat with care';
        }
      });
    });
    // game-specific extras
    keys.forEach(k => {
      PSStats.extras(p.games[k], k).forEach(x => {
        const tr = tbl.insertRow();
        tr.insertCell().textContent = x.label + ' (' + p.games[k].label + ')';
        cols.forEach(c => {
          const cell = tr.insertCell();
          cell.textContent = c.key === k ? x.v : '';
        });
      });
    });
    pane.appendChild(tbl);

    // their hands
    const hd = el('h4', 'sec', 'Hands');
    pane.appendChild(hd);
    const list = el('div', 'plHands');
    pane.appendChild(list);
    const lib = await ensureLibrary();
    const mine = handsFor || lib.hands.filter(h => h.seats.some(s => s.name === name));
    list.appendChild(el('div', 'plMeta', mine.length + ' hands — click one to open it in the replayer'));
    mine.slice(0, 300).forEach(h => {
      const net = PSEngine.netFor(h)[name] || 0;
      const row = el('div', 'plHand');
      row.appendChild(el('span', 'g', (h.mixed ? h.mixed + ' → ' : '') + h.game.label));
      row.appendChild(el('span', 'd', h.dateObj ? h.dateObj.toLocaleString() : ''));
      row.appendChild(el('span', 'amt ' + (net > 0 ? 'up' : net < 0 ? 'dn' : 'flat'),
        (net > 0 ? '+' : net < 0 ? '−' : '') + fmt(Math.abs(net))));
      row.onclick = () => { PSApp.replaceHands(h.raw, 'from ' + name); show('replayer'); };
      list.appendChild(row);
    });
  }

  /* A player's performance record, from the tournament summaries: totals,
     then one line per event type, then every tournament (click to open it). */
  function renderResults(pane, name, isMe, noTitle, recOverride) {
    const rec = recOverride || (perfDb && perfDb[name]);
    if (!rec) return;
    const a = PSTSum.aggregate(rec);
    const M = v => PSTSum.money(v, a.cur);
    if (!noTitle) pane.appendChild(el('h3', null, name + (isMe || accounts.includes(name) || name === hero ? '  (you)' : '') +
      (rec.country ? '  · ' + rec.country : '')));
    const box = el('div', 'trBox');
    box.appendChild(el('h4', 'sec', 'Tournament results'));
    const k = el('div', 'trKpis');
    const kpi = (label, v, cls) => { const d = el('div', 'kpi ' + (cls || '')); d.appendChild(el('b', null, v)); d.appendChild(el('small', null, label)); k.appendChild(d); };
    kpi('tournaments', String(a.tourneys));
    kpi('entries', a.entries + (a.reentries ? '' : ''), '');
    kpi('cashed', a.cashes + ' (' + (a.itm || 0).toFixed(0) + '%)');
    kpi('wins', String(a.wins));
    if (a.tickets) kpi('satellite seats', String(a.tickets));
    kpi('best finish', a.best ? PSTSum.ord(a.best) : '—');
    kpi('avg finish', a.avgFinish == null ? '—' : 'top ' + Math.max(1, Math.round(a.avgFinish)) + '%');
    kpi('buy-ins', M(a.cost));
    kpi('won', M(a.won));
    kpi('net', M(a.net), a.net > 0 ? 'up' : a.net < 0 ? 'dn' : '');
    kpi('ROI', a.roi == null ? '—' : a.roi.toFixed(0) + '%', a.roi > 0 ? 'up' : a.roi < 0 ? 'dn' : '');
    box.appendChild(k);
    const note = ['from the tournament histories you imported — only events you were in'];
    if (a.reentries) note.push(a.reentries + ' re-entries are counted as buy-ins');
    if (a.tickets) note.push('satellite seats are valued at the target’s buy-in');
    if (a.bounty) note.push(M(a.bounty) + ' of bounties included');
    else note.push('bounties are only listed for the account that requested the history');
    box.appendChild(el('div', 'dim trNote', note.join(' · ')));

    const bt = el('table', 'tbl stats');
    const hr = bt.insertRow();
    ['Event', 'Played', 'Entries', 'Cashed', 'Best', 'Buy-ins', 'Won', 'Net', 'ROI'].forEach(h => { const th = document.createElement('th'); th.textContent = h; hr.appendChild(th); });
    Object.keys(a.byEvent).sort((x, y) => a.byEvent[y].n - a.byEvent[x].n).forEach(ev => {
      const g = a.byEvent[ev], r = bt.insertRow();
      const net = g.won - g.cost;
      [ev, g.n, g.entries, g.cashes + ' (' + Math.round(100 * g.cashes / g.n) + '%)', g.best ? PSTSum.ord(g.best) : '—',
        M(g.cost), M(g.won), M(net), g.cost ? (100 * net / g.cost).toFixed(0) + '%' : '—']
        .forEach((v, i) => { const c = r.insertCell(); c.textContent = v; if (i === 7) c.className = net > 0 ? 'up' : net < 0 ? 'dn' : ''; });
    });
    box.appendChild(global.PSTourneys ? PSTourneys.sortable(bt) : bt);
    if (global.PSTourneys) PSTourneys.campaignSection(box, rec);

    box.appendChild(el('h4', 'sec', 'Every tournament'));
    const lt = el('table', 'tbl trEvents');
    const h2 = lt.insertRow();
    ['When', 'Event', 'Buy-in', 'Field', 'Finish', 'Entries', 'Won', 'Net'].forEach(h => { const th = document.createElement('th'); th.textContent = h; h2.appendChild(th); });
    Object.values(rec.events).sort((x, y) => y.date - x.date).forEach(e => {
      const r = lt.insertRow();
      const got = e.won + e.ticket + e.bounty, net = got - e.cost;
      r.insertCell().textContent = e.date ? new Date(e.date).toLocaleDateString() : '—';
      r.insertCell().textContent = e.event + (e.sat ? ' · satellite' : '');
      r.insertCell().textContent = M(e.buyin);
      r.insertCell().textContent = e.field;
      r.insertCell().textContent = PSTSum.ord(e.best) + (e.qualified ? ' · seat' : '') +
        (e.places.length > 1 ? '  (' + e.places.map(PSTSum.ord).join(', ') + ')' : '');
      r.insertCell().textContent = e.entries;
      r.insertCell().textContent = got ? M(got) : '';
      const c = r.insertCell(); c.textContent = M(net); c.className = net > 0 ? 'up' : 'dn';
      r.onclick = () => { show('tourneys'); PSTourneys.open(e.tid); };
      r.style.cursor = 'pointer';
      r.title = 'Open tournament #' + e.tid;
    });
    box.appendChild(global.PSTourneys ? PSTourneys.sortable(lt) : lt);
    pane.appendChild(box);
  }

  /* ===================================================================== */
  /* the screens sit under the top bar and the tabs; on a phone the top bar wraps to two or
     three rows, so measure it instead of trusting the CSS default */
  function fitChrome() {
    const t = document.getElementById('topbar'), n = document.getElementById('tabs');
    if (t && n) document.documentElement.style.setProperty('--chrome', (t.offsetHeight + n.offsetHeight) + 'px');
  }

  /* on a phone the list-and-detail screens stack, so a pick in the list fills a
     panel below the fold — bring it up (same query as PHONE_MQ in app.js) */
  function phoneDetailScroll(e) {
    if (!global.matchMedia('(max-width:820px), (max-height:500px)').matches) return;
    const list = e.target.closest('#viewPlayers .plSide, #viewTourneys .plSide, #viewStarts .shMain');
    if (!list || !e.target.closest('.plRow, .toRow, tbody tr') || e.target.closest('th, input, select, button, label')) return;
    const d = list.parentElement.querySelector('#plDetail, #toDetail, #shDetail');
    if (d) setTimeout(() => d.scrollIntoView({ block: 'start' }), 80);
  }

  async function init() {
    document.addEventListener('click', phoneDetailScroll, true);   // before the row re-renders itself
    fitChrome();
    window.addEventListener('resize', fitChrome);
    if (global.ResizeObserver) new ResizeObserver(fitChrome).observe(document.getElementById('topbar'));
    const p = await PSDB.probe();
    libOk = p.ok;
    libNote = p.ok ? '' : (p.why + ' — ' + p.hint);
    if (libOk) {
      try { await upgradePerf(); } catch (e) { console.warn('perf upgrade failed', e); }
      try { await PSDB.upgradeTourneys(); } catch (e) { console.warn('tournament upgrade failed', e); }
    }

    $('#navHome').onclick = () => show('home');
    document.querySelectorAll('[data-go]').forEach(b => b.onclick = () => show(b.dataset.go));
    $('#plSearch').oninput = () => refreshPlayers();
    $('#plGame').onchange = () => refreshPlayers();
    $('#plSort').onchange = () => refreshPlayers();
    $('#meWho').onchange = e => { try { localStorage.setItem(ME_KEY, e.target.value); } catch (x) { } openPlayer(e.target.value, true); };
    $('#fTourney').onchange = e => { const v = e.target.value; if (v === 'library') openLibrary(); else if (v) openTourney(v); };
    $('#tourBtn').onclick = resultsForCurrent;
    $('#libBackup').onclick = backup;
    $('#libRestore').onchange = e => { restore(e.target.files[0]); e.target.value = ''; };
    $('#libClear').onclick = async () => {
      if (!confirm('Delete every hand and every tournament result from the library? Lessons and markup are not touched.')) return;
      await PSDB.clearAll(); await PSDB.clearSummaries(); dropCache(); refreshLibrary(); refreshHome();
    };

    // open the library into the replayer on boot, so files never need loading twice
    if (libOk) {
      const n = await PSDB.count();
      if (n) {
        const lib = await ensureLibrary();
        PSApp.replaceHands(lib.recs.map(r => r.raw).join('\n\n'), 'library');
        const hs = await PSDB.heroes();
        hero = Object.keys(hs).sort((a, b) => hs[b] - hs[a])[0] || '';
        show('home');
      } else show('home');
    } else show('replayer');
    refreshHome();
  }

  global.PSHome = {
    init, show, offerImport, reportLoad, openPlayer, dropCache, toast, refreshCurrent, importSummaries, ensurePerf, openTourney,
    perfCache: () => perfDb, library: () => ensureLibrary(), playTourneys, setPlayEntries, getChops, setChop, openLibrary, fillLoader,
    get hero() { return hero; }, get accounts() { return accounts; }, get libOk() { return libOk; },
  };
})(window);
