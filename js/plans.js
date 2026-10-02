/* ===========================================================================
   plans.js — lesson plans: named, ordered groups of hands.

   A plan holds references to hands plus their raw text, so it opens even for
   hands that never reached the library (built from scratch, pasted).  The
   markup, notes and narration on each hand are not copied into the plan —
   they live with the hand (lesson.js) and so show up wherever that hand is
   opened.  Export bundles both so a plan can be handed to a student.
   =========================================================================== */
(function (global) {
  'use strict';
  const $ = s => document.querySelector(s);
  const el = (t, c, x) => { const e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; };
  const KEY = 'psreplayer.plans.v1';

  let data = read(), selected = null;
  function read() {
    try { const d = JSON.parse(localStorage.getItem(KEY)); if (d && d.plans) return d; } catch (e) { }
    return { v: 1, plans: [] };
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(data)); return true; }
    catch (e) {
      PSHome.toast('Could not save lesson plans: ' + e.message, 'bad');
      return false;
    }
  }
  const uid = () => 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const byId = id => data.plans.find(p => p.id === id);

  /* ---------- model ---------- */
  function create(name) {
    const p = { id: uid(), name: name || 'Untitled lesson', desc: '', items: [], created: Date.now(), updated: Date.now() };
    data.plans.unshift(p); save();
    return p;
  }
  function addHand(planId, h) {
    const p = byId(planId);
    if (!p || !h) return 'missing';
    if (p.items.some(i => i.id === h.id)) return 'dupe';
    p.items.push({
      id: h.id, raw: h.raw,
      game: (h.mixed ? h.mixed + ' → ' : '') + h.game.label,
      date: h.dateObj ? h.dateObj.getTime() : 0,
      added: Date.now(),
    });
    p.updated = Date.now(); save();
    return 'ok';
  }
  function move(p, i, d) {
    const j = i + d;
    if (j < 0 || j >= p.items.length) return;
    const t = p.items[i]; p.items[i] = p.items[j]; p.items[j] = t;
    p.updated = Date.now(); save();
  }

  /* ---------- the Lessons screen ---------- */
  function render() {
    const list = $('#planList'), body = $('#planBody');
    list.innerHTML = '';
    if (!data.plans.length) list.appendChild(el('div', 'empty', 'No lessons yet.'));
    data.plans.forEach(p => {
      const r = el('div', 'plRow' + (selected === p.id ? ' me' : ''));
      r.appendChild(el('b', null, p.name));
      r.appendChild(el('span', 'plN', p.items.length + ' hand' + (p.items.length === 1 ? '' : 's')));
      r.onclick = () => { selected = p.id; render(); };
      list.appendChild(r);
    });

    body.innerHTML = '';
    const p = byId(selected);
    if (!p) {
      body.appendChild(el('p', 'dim',
        'A lesson is a named, ordered group of hands — “Pre-flop raising on the button”, “Playing too tight ' +
        'on the bubble”. Make one here, then add hands to it from the replayer with the “+ Lesson” button ' +
        'next to a hand’s title. Hands from the library and hands you built from scratch both work, and ' +
        'each keeps its own markup, notes and narration.'));
      return;
    }

    const name = el('input', 'planName'); name.value = p.name;
    name.oninput = () => { p.name = name.value || 'Untitled lesson'; p.updated = Date.now(); save(); renderListOnly(); };
    body.appendChild(name);
    const desc = el('textarea', 'planDesc'); desc.value = p.desc || '';
    desc.placeholder = 'What is this lesson about? What should the student take away?';
    desc.oninput = () => { p.desc = desc.value; p.updated = Date.now(); save(); };
    body.appendChild(desc);

    const bar = el('div', 'tRow');
    const open = el('button', 'btn primary', '▶ Open in replayer');
    open.disabled = !p.items.length;
    open.onclick = () => openPlan(p);
    bar.appendChild(open);
    const ex = el('button', 'btn', '⭳ Export');
    ex.onclick = () => exportPlan(p);
    bar.appendChild(ex);
    const del = el('button', 'btn', 'Delete lesson');
    del.onclick = () => {
      if (!confirm('Delete the lesson “' + p.name + '”? The hands and their markup are not touched.')) return;
      data.plans = data.plans.filter(x => x.id !== p.id); selected = null; save(); render();
    };
    bar.appendChild(del);
    body.appendChild(bar);

    body.appendChild(el('h4', 'sec', 'Hands, in teaching order'));
    if (!p.items.length) {
      body.appendChild(el('p', 'dim', 'Empty. Open any hand in the replayer and press “+ Lesson” beside its title.'));
      return;
    }
    const tbl = el('div', 'planItems');
    p.items.forEach((it, i) => {
      const r = el('div', 'planItem');
      r.appendChild(el('span', 'n', String(i + 1)));
      const main = el('div', 'm');
      main.appendChild(el('b', null, it.game));
      main.appendChild(el('span', 'dim', '  #' + it.id + (it.date ? ' · ' + new Date(it.date).toLocaleDateString() : '')));
      const ann = PSLesson.hand(it.id);
      const bits = [];
      if (ann && ann.marks.length) bits.push(ann.marks.length + ' marks');
      if (ann && Object.keys(ann.notes).length) bits.push(Object.keys(ann.notes).length + ' notes');
      if (ann && ann.audio) bits.push('narration');
      main.appendChild(el('div', 'ann', bits.length ? bits.join(' · ') : 'not annotated yet'));
      r.appendChild(main);
      const b = el('div', 'act');
      const mk = (t, fn, tip) => { const x = el('button', 'btn', t); x.onclick = fn; if (tip) x.title = tip; b.appendChild(x); };
      mk('↑', () => { move(p, i, -1); render(); }, 'Earlier in the lesson');
      mk('↓', () => { move(p, i, 1); render(); }, 'Later in the lesson');
      mk('open', () => openPlan(p, i));
      mk('remove', () => { p.items.splice(i, 1); p.updated = Date.now(); save(); render(); });
      r.appendChild(b);
      tbl.appendChild(r);
    });
    body.appendChild(tbl);
  }
  function renderListOnly() {
    document.querySelectorAll('#planList .plRow').forEach((r, i) => {
      const p = data.plans[i]; if (p) r.querySelector('b').textContent = p.name;
    });
  }

  /* the replayer shows exactly this lesson's hands, in lesson order */
  function openPlan(p, startAt) {
    PSApp.replaceHands(p.items.map(i => i.raw).join('\n\n'), 'lesson: ' + p.name, true);
    PSHome.show('replayer');
    if (startAt) setTimeout(() => PSApp.openById(p.items[startAt].id), 60);
  }

  /* ---------- export / import ---------- */
  async function exportPlan(p) {
    const ids = p.items.map(i => i.id);
    const raws = {}; p.items.forEach(i => { raws[i.id] = i.raw; });
    const ann = await PSLesson.exportLesson(ids, raws);
    const out = {
      app: 'PokerStars Hand Replayer lesson plan', v: 1, saved: new Date().toISOString(),
      plan: { name: p.name, desc: p.desc, items: p.items },
      annotations: ann.hands,
    };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(out)], { type: 'application/json' }));
    a.download = 'lesson-' + p.name.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() + '.json';
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 3000);
    PSHome.toast('Exported “' + p.name + '” — ' + p.items.length + ' hands with their markup');
  }

  async function importPlan(file) {
    if (!file) return;
    let obj;
    try { obj = JSON.parse(await file.text()); }
    catch (e) { PSHome.toast('That file is not a lesson: ' + e.message, 'bad'); return; }
    if (!obj || !obj.plan || !Array.isArray(obj.plan.items)) {
      PSHome.toast('That file is not a lesson plan (single-hand lesson files import from the Teach tab).', 'bad');
      return;
    }
    try { if (obj.annotations) await PSLesson.importLesson({ hands: obj.annotations }); }
    catch (e) { PSHome.toast('Hands imported, but their markup could not be: ' + e.message, 'bad'); }
    const p = create(obj.plan.name || 'Imported lesson');
    p.desc = obj.plan.desc || '';
    p.items = obj.plan.items.filter(i => i && i.id && i.raw);
    save();
    selected = p.id; render();
    PSHome.toast('Imported “' + p.name + '” — ' + p.items.length + ' hands');
  }

  /* ---------- "+ Lesson" in the replayer ---------- */
  function picker(anchor) {
    const h = PSApp.hand();
    if (!h) return;
    closePicker();
    const box = el('div', 'planPick'); box.id = 'planPick';
    box.appendChild(el('div', 'hd', 'Add this hand to…'));
    data.plans.forEach(p => {
      const has = p.items.some(i => i.id === h.id);
      const b = el('button', 'it' + (has ? ' has' : ''), (has ? '✓ ' : '') + p.name);
      b.title = has ? 'Already in this lesson' : p.items.length + ' hands';
      b.onclick = () => {
        const r = addHand(p.id, h);
        PSHome.toast(r === 'dupe' ? 'Already in “' + p.name + '”' : 'Added to “' + p.name + '” — hand ' + p.items.length, r === 'dupe' ? 'info' : 'ok');
        closePicker();
      };
      box.appendChild(b);
    });
    const nb = el('button', 'it new', '+ New lesson…');
    nb.onclick = () => {
      const n = prompt('Name the lesson', 'Pre-flop raising on the button');
      if (!n) return;
      const p = create(n.trim());
      addHand(p.id, h);
      PSHome.toast('Created “' + p.name + '” with this hand');
      closePicker();
    };
    box.appendChild(nb);
    const r = anchor.getBoundingClientRect();
    box.style.left = r.left + 'px'; box.style.top = (r.bottom + 4) + 'px';
    document.body.appendChild(box);
    setTimeout(() => document.addEventListener('pointerdown', outside, true), 0);
  }
  function outside(e) { if (!e.target.closest('#planPick') && !e.target.closest('#planBtn')) closePicker(); }
  function closePicker() {
    const b = $('#planPick'); if (b) b.remove();
    document.removeEventListener('pointerdown', outside, true);
  }

  function init() {
    $('#planNew').onclick = () => {
      const n = prompt('Name the lesson', 'Playing too tight on the bubble');
      if (!n) return;
      selected = create(n.trim()).id; render();
    };
    $('#planImport').onchange = e => { importPlan(e.target.files[0]); e.target.value = ''; };
    $('#planBtn').onclick = e => picker(e.currentTarget);
  }

  global.PSPlans = { init, render, create, addHand, openPlan, all: () => data.plans };
})(window);
