/* ===========================================================================
   markup.js — the annotation layer.

   An SVG sits over the table area.  Every shape is stored normalised to that
   area (0..1) so it survives resizing, and every shape is bound to a step of
   the replay: it shows on that step only, from that step on, or for the whole
   hand.  "Target" marks store a seat / card / pot reference instead of
   coordinates and resolve against the live DOM, so they stay glued to the
   thing they point at even as the table re-renders.
   =========================================================================== */
(function (global) {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';
  const el = (n, a) => { const e = document.createElementNS(NS, n); for (const k in a) e.setAttribute(k, a[k]); return e; };
  const cssq = s => String(s).replace(/["\\]/g, '\\$&');
  const uid = () => 'm' + Math.random().toString(36).slice(2, 9);

  let layer = null, host = null, input = null;
  let handId = null, step = 0;
  let tool = 'select', color = '#ffd23f', width = 3, span = 'step';
  let enabled = false;
  let sel = null, drag = null;
  let undoStack = [], redoStack = [];
  let onChange = () => { };

  /* ---------- geometry helpers ---------------------------------------- */
  const box = () => host.getBoundingClientRect();
  function toN(cx, cy) { const b = box(); return { x: (cx - b.left) / b.width, y: (cy - b.top) / b.height }; }
  function toPx(p) { const b = box(); return { x: p.x * b.width, y: p.y * b.height }; }
  const pxW = v => v * box().width;
  const pxH = v => v * box().height;

  let mctx = null;
  function measureCtx(size) {
    if (!mctx) mctx = document.createElement('canvas').getContext('2d');
    mctx.font = '700 ' + size + 'px -apple-system, system-ui, sans-serif';
    return mctx;
  }
  // SVG text does not wrap, so lay it out ourselves inside the box width
  function wrapText(text, size, maxPx) {
    const ctx = measureCtx(size), out = [];
    for (const para of String(text || '').split('\n')) {
      if (!para.trim()) { out.push(''); continue; }
      let line = '';
      for (const word of para.trim().split(/\s+/)) {
        const t = line ? line + ' ' + word : word;
        if (line && ctx.measureText(t).width > maxPx) { out.push(line); line = word; }
        else line = t;
      }
      out.push(line);
    }
    return out;
  }

  function targetRect(t) {
    let e = null;
    if (!t) return null;
    if (t.kind === 'seat') e = document.querySelector('.seat[data-name="' + cssq(t.name) + '"]');
    else if (t.kind === 'card') {
      const s = document.querySelector('.seat[data-name="' + cssq(t.name) + '"]');
      e = s && s.querySelectorAll('.cards .card')[t.idx];
    } else if (t.kind === 'board') e = document.querySelectorAll('#board .card')[t.idx];
    else if (t.kind === 'pot') e = document.getElementById('potBox');
    else if (t.kind === 'eq') e = document.getElementById('eqBox');
    if (!e) return null;
    const r = e.getBoundingClientRect(), b = box();
    if (!r.width) return null;
    return { x: r.left - b.left, y: r.top - b.top, w: r.width, h: r.height };
  }

  /* what is under the cursor, ignoring our own overlay */
  function describeAt(cx, cy) {
    layer.style.pointerEvents = 'none';
    const e = document.elementFromPoint(cx, cy);
    layer.style.pointerEvents = '';
    if (!e) return null;
    const card = e.closest('.card');
    const seat = e.closest('.seat');
    if (card && seat) {
      const list = [...seat.querySelectorAll('.cards .card')];
      const i = list.indexOf(card);
      if (i >= 0) return { kind: 'card', name: seat.dataset.name, idx: i };
    }
    if (card && e.closest('#board')) {
      const i = [...document.querySelectorAll('#board .card')].indexOf(card);
      if (i >= 0) return { kind: 'board', idx: i };
    }
    if (seat) return { kind: 'seat', name: seat.dataset.name };
    if (e.closest('#potBox')) return { kind: 'pot' };
    if (e.closest('#eqBox')) return { kind: 'eq' };
    return null;
  }

  /* ---------- model ---------------------------------------------------- */
  const all = () => (handId ? PSLesson.marks(handId) : []);
  function commit(list, quiet) {
    if (!handId) return;
    PSLesson.setMarks(handId, list);
    if (!quiet) onChange();
    render();
  }
  function pushUndo() {
    undoStack.push(JSON.stringify(all()));
    if (undoStack.length > 60) undoStack.shift();
    redoStack.length = 0;
  }
  function visible(m) {
    if (m.span === 'hand') return true;
    if (m.span === 'from') return m.step <= step;
    return m.step === step;
  }

  /* ---------- rendering ------------------------------------------------ */
  function render() {
    if (!layer) return;
    while (layer.firstChild) layer.removeChild(layer.firstChild);
    const b = box();
    layer.setAttribute('viewBox', '0 0 ' + b.width + ' ' + b.height);
    const list = all().filter(visible);

    // spotlights are one dim layer with holes punched in it
    const spots = list.filter(m => m.type === 'spot');
    if (spots.length) {
      const defs = el('defs');
      const mask = el('mask', { id: 'mkspot' });
      mask.appendChild(el('rect', { x: 0, y: 0, width: b.width, height: b.height, fill: '#fff' }));
      spots.forEach(m => {
        const c = toPx(m.c);
        mask.appendChild(el('ellipse', { cx: c.x, cy: c.y, rx: pxW(m.rx), ry: pxH(m.ry), fill: '#000' }));
      });
      defs.appendChild(mask); layer.appendChild(defs);
      layer.appendChild(el('rect', {
        x: 0, y: 0, width: b.width, height: b.height,
        fill: 'rgba(3,7,12,.62)', mask: 'url(#mkspot)', 'pointer-events': 'none',
      }));
    }

    list.forEach(m => { const g = shape(m, b); if (g) layer.appendChild(g); });
    if (sel) handles(sel);
  }

  /* Selecting must NOT rebuild the layer: a full redraw between the two clicks
     of a double-click replaces the element under the pointer, and the dblclick
     never fires — which is what made placed text impossible to edit. */
  function refreshSelection() {
    if (!layer) return;
    layer.querySelectorAll('[data-handle]').forEach(h => h.remove());
    layer.querySelectorAll('g[data-mid]').forEach(g => {
      const m = all().find(x => x.id === g.dataset.mid);
      if (!m) return;
      if (sel === m.id) g.setAttribute('filter', 'drop-shadow(0 0 4px ' + m.color + ')');
      else g.removeAttribute('filter');
    });
    if (sel) handles(sel);
  }

  function hit(g, d) {                       // fat invisible stroke for easy clicking
    g.appendChild(el('path', { d: d, fill: 'none', stroke: 'rgba(0,0,0,0)', 'stroke-width': 18, 'stroke-linecap': 'round' }));
  }

  function shape(m, b) {
    const g = el('g', { 'data-mid': m.id, style: 'cursor:' + (enabled && tool === 'select' ? 'move' : 'default') });
    const stroke = { stroke: m.color, 'stroke-width': m.width, fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
    if (m.type === 'arrow') {
      const a = toPx(m.a), c = toPx(m.b);
      const dx = c.x - a.x, dy = c.y - a.y, len = Math.hypot(dx, dy) || 1;
      const ux = dx / len, uy = dy / len;
      const hd = Math.max(11, m.width * 3.6);
      const tipX = c.x, tipY = c.y;
      const bx = tipX - ux * hd, by = tipY - uy * hd;
      hit(g, 'M' + a.x + ',' + a.y + 'L' + c.x + ',' + c.y);
      g.appendChild(el('line', Object.assign({ x1: a.x, y1: a.y, x2: bx, y2: by }, stroke)));
      g.appendChild(el('polygon', {
        points: [tipX + ',' + tipY, (bx - uy * hd * 0.42) + ',' + (by + ux * hd * 0.42),
                 (bx + uy * hd * 0.42) + ',' + (by - ux * hd * 0.42)].join(' '),
        fill: m.color,
      }));
    } else if (m.type === 'box') {
      const p = toPx(m.a), q = toPx(m.b);
      const x = Math.min(p.x, q.x), y = Math.min(p.y, q.y), w = Math.abs(q.x - p.x), h = Math.abs(q.y - p.y);
      hit(g, 'M' + x + ',' + y + 'h' + w + 'v' + h + 'h' + (-w) + 'Z');
      g.appendChild(el('rect', Object.assign({ x: x, y: y, width: w, height: h, rx: 6 }, stroke)));
    } else if (m.type === 'ellipse') {
      const c = toPx(m.c);
      g.appendChild(el('ellipse', Object.assign({ cx: c.x, cy: c.y, rx: Math.max(2, pxW(m.rx)), ry: Math.max(2, pxH(m.ry)) },
        stroke, { 'stroke-width': m.width + 6, stroke: 'rgba(0,0,0,0)' })));
      g.appendChild(el('ellipse', Object.assign({ cx: c.x, cy: c.y, rx: Math.max(2, pxW(m.rx)), ry: Math.max(2, pxH(m.ry)) }, stroke)));
    } else if (m.type === 'pen') {
      if (!m.pts || m.pts.length < 2) return null;
      const d = m.pts.map((p, i) => (i ? 'L' : 'M') + (p.x * b.width) + ',' + (p.y * b.height)).join('');
      hit(g, d);
      g.appendChild(el('path', Object.assign({ d: d }, stroke)));
    } else if (m.type === 'text') {
      const p = toPx(m.a);
      const size = m.size || 17;
      const wPx = Math.max(40, (m.w != null ? m.w : 0.28) * b.width);
      const lines = wrapText(m.text, size, wPx);
      const t = el('text', {
        x: p.x, y: p.y, fill: m.color, 'font-size': size,
        'font-weight': 700, 'font-family': '-apple-system,system-ui,sans-serif',
        stroke: 'rgba(3,7,12,.85)', 'stroke-width': 4, 'paint-order': 'stroke', 'stroke-linejoin': 'round',
      });
      lines.forEach((line, i) => {
        const ts = el('tspan', { x: p.x, dy: i ? size * 1.25 : 0 });
        ts.textContent = line || ' '; t.appendChild(ts);
      });
      g.appendChild(t);
      // a generous invisible target so the block is easy to grab
      g.insertBefore(el('rect', {
        x: p.x - 6, y: p.y - size, width: wPx + 12,
        height: Math.max(1, lines.length) * size * 1.25 + 8, fill: 'rgba(0,0,0,0)',
      }), t);
    } else if (m.type === 'target') {
      const r = targetRect(m.target);
      if (!r) return null;
      const pad = 5;
      g.appendChild(el('rect', Object.assign({
        x: r.x - pad, y: r.y - pad, width: r.w + pad * 2, height: r.h + pad * 2, rx: 9,
      }, stroke)));
      if (m.pulse !== false) {
        const a = el('rect', {
          x: r.x - pad, y: r.y - pad, width: r.w + pad * 2, height: r.h + pad * 2, rx: 9,
          fill: 'none', stroke: m.color, 'stroke-width': m.width, opacity: .55,
        });
        a.appendChild(el('animate', { attributeName: 'opacity', values: '.55;0;.55', dur: '1.6s', repeatCount: 'indefinite' }));
        a.appendChild(el('animateTransform', {
          attributeName: 'transform', type: 'scale', values: '1;1.04;1', dur: '1.6s',
          repeatCount: 'indefinite', additive: 'sum',
        }));
        g.appendChild(a);
      }
    } else if (m.type === 'spot') {
      const c = toPx(m.c);
      g.appendChild(el('ellipse', {
        cx: c.x, cy: c.y, rx: Math.max(2, pxW(m.rx)), ry: Math.max(2, pxH(m.ry)),
        fill: 'none', stroke: m.color, 'stroke-width': 1.5, opacity: .5,
      }));
    }
    if (sel === m.id) g.setAttribute('filter', 'drop-shadow(0 0 4px ' + m.color + ')');
    return g;
  }

  function handles(id) {
    const m = all().find(x => x.id === id);
    if (!m) return;
    const pts = [];
    if (m.type === 'arrow' || m.type === 'box') { pts.push(['a', toPx(m.a)], ['b', toPx(m.b)]); }
    else if (m.type === 'ellipse' || m.type === 'spot') {
      const c = toPx(m.c);
      pts.push(['c', c], ['r', { x: c.x + pxW(m.rx), y: c.y }], ['ry', { x: c.x, y: c.y + pxH(m.ry) }]);
    } else if (m.type === 'text') {
      const p = toPx(m.a);
      pts.push(['a', p]);
      pts.push(['w', { x: p.x + Math.max(40, (m.w != null ? m.w : 0.28) * box().width), y: p.y }]);
    }
    pts.forEach(([k, p]) => {
      const h = el('circle', { cx: p.x, cy: p.y, r: 6, fill: '#0b1017', stroke: m.color, 'stroke-width': 2, 'data-handle': k, style: 'cursor:grab' });
      layer.appendChild(h);
    });
  }

  /* ---------- interaction ---------------------------------------------- */
  function down(ev) {
    if (!enabled || !handId) return;
    if (ev.button !== 0) return;
    const n = toN(ev.clientX, ev.clientY);
    const hEl = ev.target.closest ? ev.target.closest('[data-handle]') : null;

    if (tool === 'select') {
      if (hEl) {
        drag = { mode: 'handle', key: hEl.dataset.handle, id: sel, moved: false };
        return;
      }
      const g = ev.target.closest('[data-mid]');
      if (g) {
        const id = g.dataset.mid;
        const wasSel = sel === id;
        sel = id;
        drag = {
          mode: 'move', id: id, from: n, moved: false, wasSel: wasSel,
          orig: JSON.parse(JSON.stringify(all().find(x => x.id === id))),
        };
        refreshSelection();
      } else { sel = null; refreshSelection(); }
      return;
    }

    if (tool === 'erase') {
      const g = ev.target.closest('[data-mid]');
      if (g) { pushUndo(); commit(all().filter(x => x.id !== g.dataset.mid)); }
      return;
    }

    if (tool === 'target') {
      const t = describeAt(ev.clientX, ev.clientY);
      if (!t) return;
      pushUndo();
      commit(all().concat([{ id: uid(), type: 'target', target: t, step: step, span: span, color: color, width: Math.max(2, width) }]));
      return;
    }

    if (tool === 'text') {
      ev.preventDefault();                  // keep focus off the page body
      openInput(ev.clientX, ev.clientY, n, null);
      return;
    }

    pushUndo();
    const m = { id: uid(), type: tool, step: step, span: span, color: color, width: width };
    if (tool === 'pen') m.pts = [n];
    else if (tool === 'ellipse' || tool === 'spot') { m.c = n; m.rx = 0.001; m.ry = 0.001; }
    else { m.a = n; m.b = n; }
    const list = all().concat([m]);
    commit(list, true);
    sel = m.id;
    drag = { mode: 'draw', id: m.id, from: n };
  }

  function move(ev) {
    if (!drag) return;
    const n = toN(ev.clientX, ev.clientY);
    if (!drag.moved) {                       // undo point only once a drag really starts
      drag.moved = true;
      if (drag.mode !== 'draw') pushUndo();
    }
    const list = all();
    const m = list.find(x => x.id === drag.id);
    if (!m) return;
    if (drag.mode === 'draw') {
      if (m.type === 'pen') m.pts.push(n);
      else if (m.type === 'ellipse' || m.type === 'spot') {
        m.rx = Math.abs(n.x - drag.from.x); m.ry = Math.abs(n.y - drag.from.y);
        if (ev.shiftKey) { const r = Math.max(m.rx, m.ry * (box().height / box().width)); m.rx = r; m.ry = r * (box().width / box().height); }
      } else m.b = n;
    } else if (drag.mode === 'move') {
      const dx = n.x - drag.from.x, dy = n.y - drag.from.y, o = drag.orig;
      if (m.type === 'pen') m.pts = o.pts.map(p => ({ x: p.x + dx, y: p.y + dy }));
      else if (m.type === 'ellipse' || m.type === 'spot') m.c = { x: o.c.x + dx, y: o.c.y + dy };
      else if (m.type === 'target') return;
      else { if (o.a) m.a = { x: o.a.x + dx, y: o.a.y + dy }; if (o.b) m.b = { x: o.b.x + dx, y: o.b.y + dy }; }
    } else if (drag.mode === 'handle') {
      if (drag.key === 'a') m.a = n;
      else if (drag.key === 'b') m.b = n;
      else if (drag.key === 'c') m.c = n;
      else if (drag.key === 'w') m.w = Math.max(0.05, n.x - m.a.x);
      else if (drag.key === 'r') m.rx = Math.abs(n.x - m.c.x);
      else if (drag.key === 'ry') m.ry = Math.abs(n.y - m.c.y);
    }
    commit(list, true);
  }

  function up() {
    if (!drag) return;
    const m = all().find(x => x.id === drag.id);
    if (drag.mode === 'draw' && m) {         // discard accidental dots
      const tiny = (m.type === 'pen' && m.pts.length < 3) ||
        ((m.type === 'ellipse' || m.type === 'spot') && m.rx < 0.006 && m.ry < 0.006) ||
        ((m.type === 'arrow' || m.type === 'box') && Math.abs(m.a.x - m.b.x) < 0.006 && Math.abs(m.a.y - m.b.y) < 0.006);
      if (tiny) { commit(all().filter(x => x.id !== m.id)); sel = null; drag = null; return; }
    }
    if ((drag.mode === 'move' || drag.mode === 'handle') && !drag.moved) {
      const d = drag;
      drag = null;
      // a click rather than a drag: clicking a label that was already selected
      // opens it for editing, the way renaming works elsewhere
      if (d.wasSel && m && m.type === 'text') editMark(m);
      return;                                // nothing changed — do not redraw
    }
    drag = null;
    commit(all());
  }

  /* ---------- the little text box -------------------------------------- */
  function closeInput(keep) {
    if (!input || input.style.display !== 'block') return;
    const txt = input.value.trim();
    const id = input.dataset.mid, pos = JSON.parse(input.dataset.pos || 'null');
    const wNorm = Math.max(0.05, (input.offsetWidth - 12) / box().width);
    input.style.display = 'none';           // hide first: the blur it triggers is then a no-op
    if (!keep) return;
    pushUndo();
    let list = all();
    if (id) {
      const m = list.find(x => x.id === id);
      if (!m) return;
      if (!txt) { list = list.filter(x => x.id !== id); sel = null; }
      else { m.text = txt; m.w = wNorm; sel = m.id; }
    } else if (txt) {
      const m = {
        id: uid(), type: 'text', a: pos, text: txt, w: wNorm,
        step: step, span: span, color: color, size: 15 + width * 2,
      };
      list = list.concat([m]);
      sel = m.id;
    } else return;
    commit(list);
    // hand the pointer back to select/move — you almost always want to place or
    // nudge the label next, not start another one
    if (global.PSTeach && global.PSTeach.pickTool) global.PSTeach.pickTool('select');
    else setTool('select');
  }

  function openInput(cx, cy, n, existing) {
    if (!input) {
      input = document.createElement('textarea');
      input.id = 'mkInput';
      input.rows = 2;
      input.placeholder = 'type a label…  ↵ places it, ⇧↵ new line, drag the corner to resize';
      document.body.appendChild(input);
      input.addEventListener('input', grow);
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); closeInput(true); }
        else if (e.key === 'Escape') { e.preventDefault(); closeInput(false); }
        e.stopPropagation();
      });
      input.addEventListener('blur', () => closeInput(true));
    }
    input.style.display = 'block';
    input.style.left = (cx - 4) + 'px';
    input.style.top = (cy - 14) + 'px';
    input.style.color = color;
    input.value = existing ? existing.text : '';
    input.style.width = ((existing && existing.w != null ? existing.w * box().width : 250) + 12) + 'px';
    input.style.fontSize = ((existing && existing.size) || (15 + width * 2)) + 'px';
    input.dataset.mid = existing ? existing.id : '';
    input.dataset.pos = JSON.stringify(existing ? existing.a : n);
    grow();
    // focus synchronously: a late focus lets the first keystrokes escape to the
    // document-level tool shortcuts
    input.focus(); input.select();
    requestAnimationFrame(() => { if (input.style.display === 'block') input.focus(); });
  }

  function grow() {
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = Math.min(320, input.scrollHeight + 4) + 'px';
  }

  function editMark(m) {
    if (!m || m.type !== 'text') return false;
    const b = box(), p = toPx(m.a);
    sel = m.id;
    openInput(b.left + p.x, b.top + p.y, m.a, m);
    return true;
  }
  function editSelection() {
    return editMark(all().find(x => x.id === sel));
  }

  function dbl(ev) {
    if (!enabled) return;
    const g = ev.target.closest('[data-mid]');
    if (!g) return;
    editMark(all().find(x => x.id === g.dataset.mid));
  }

  /* ---------- public ---------------------------------------------------- */
  function attach(hostEl, changed) {
    host = hostEl;
    onChange = changed || onChange;
    layer = el('svg', { id: 'mkLayer' });
    layer.style.pointerEvents = 'none';
    host.appendChild(layer);
    layer.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    layer.addEventListener('dblclick', dbl);
    if (window.ResizeObserver) new ResizeObserver(() => render()).observe(host);
    window.addEventListener('resize', render);
  }

  function setEnabled(v) {
    enabled = !!v;
    if (layer) layer.style.pointerEvents = enabled ? 'auto' : 'none';
    if (!enabled) { sel = null; }
    document.body.classList.toggle('teaching', enabled);
    render();
  }

  function setContext(id, s) {
    if (id !== handId) { undoStack = []; redoStack = []; sel = null; }
    handId = id; step = s;
    render();
  }

  function setTool(t) {
    tool = t;
    if (t !== 'select') sel = null;
    if (layer) layer.style.cursor = t === 'select' ? 'default' : t === 'erase' ? 'not-allowed' : 'crosshair';
    render();
  }

  function undo() {
    if (!undoStack.length) return;
    redoStack.push(JSON.stringify(all()));
    PSLesson.setMarks(handId, JSON.parse(undoStack.pop()));
    sel = null; onChange(); render();
  }
  function redo() {
    if (!redoStack.length) return;
    undoStack.push(JSON.stringify(all()));
    PSLesson.setMarks(handId, JSON.parse(redoStack.pop()));
    sel = null; onChange(); render();
  }
  function clearStep() { pushUndo(); commit(all().filter(m => !visible(m))); sel = null; }
  function clearHand() { pushUndo(); commit([]); sel = null; }
  function deleteSel() { if (!sel) return; pushUndo(); commit(all().filter(m => m.id !== sel)); sel = null; }
  function applyToSel(patch) {
    if (!sel) return false;
    pushUndo();
    const list = all(); const m = list.find(x => x.id === sel);
    if (m) Object.assign(m, patch);
    commit(list);
    return true;
  }

  global.PSMarkup = {
    attach, render, setEnabled, setContext, setTool, deleteSel, applyToSel,
    setColor: c => { color = c; if (!applyToSel({ color: c })) render(); },
    setWidth: w => { width = w; applyToSel({ width: w }); },
    setSpan: s => { span = s; applyToSel({ span: s }); },
    undo, redo, clearStep, clearHand, editSelection,
    state: () => ({ tool, color, width, span, sel, enabled, count: all().length }),
    visibleCount: () => all().filter(visible).length,
  };
})(window);
