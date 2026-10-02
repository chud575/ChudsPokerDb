/* ===========================================================================
   teach.js — turns the replayer into a lesson tool:
     · the markup toolbar
     · a per-step note (the teacher's script) + presenter band
     · presentation mode (chrome hidden, table front and centre)
     · narration recording — microphone audio plus a timeline of which step was
       on screen when, so playback re-drives the replay in sync
     · screen + mic capture straight to a video file
     · dictation (speech-to-text) into whichever text box is focused
   =========================================================================== */
(function (global) {
  'use strict';
  const $ = s => document.querySelector(s);
  const el = (t, c, x) => { const e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; };

  let teaching = false, presenting = false;
  let noteTimer = null;

  /* ---------- narration state ---------- */
  let rec = null, recStream = null, recChunks = [], recStart = 0, recEvents = [], recTick = null;
  let player = null, playTick = null, playing = false;
  let vidRec = null, vidStream = null, vidChunks = [], vidTick = null, vidStart = 0;

  const hid = () => (PSApp.hand() ? PSApp.hand().id : null);

  /* =====================================================================
     toolbar
     ===================================================================== */
  const TOOLS = [
    ['select', '↖', 'Select / move  (V)'],
    ['arrow', '↗', 'Arrow  (A)'],
    ['box', '▭', 'Box  (B)'],
    ['ellipse', '◯', 'Circle  (O)'],
    ['pen', '✎', 'Freehand  (P)'],
    ['text', 'T', 'Text  (T) — click a placed label, or double-click it, to edit'],
    ['target', '◎', 'Point at a seat / card / pot  (G)'],
    ['spot', '☀', 'Spotlight — dim everything else  (L)'],
    ['erase', '⌫', 'Erase a mark  (E)'],
  ];
  const COLORS = ['#ffd23f', '#ff6b6b', '#4ade80', '#5ea9ff', '#ffffff', '#c084fc'];

  function buildBar() {
    const bar = $('#mkBar');
    const tools = el('div', 'mkTools');
    TOOLS.forEach(([k, glyph, tip]) => {
      const b = el('button', 'mkT' + (k === 'select' ? ' on' : ''), glyph);
      b.title = tip; b.dataset.tool = k;
      b.onclick = () => pickTool(k);
      tools.appendChild(b);
    });
    bar.appendChild(tools);

    const sw = el('div', 'mkSwatch');
    COLORS.forEach((c, i) => {
      const b = el('button', 'mkC' + (i === 0 ? ' on' : ''));
      b.style.background = c; b.dataset.color = c;
      b.onclick = () => {
        document.querySelectorAll('.mkC').forEach(x => x.classList.remove('on'));
        b.classList.add('on'); PSMarkup.setColor(c);
      };
      sw.appendChild(b);
    });
    bar.appendChild(sw);

    const w = el('input'); w.type = 'range'; w.min = 2; w.max = 9; w.value = 3; w.id = 'mkWidth';
    w.title = 'Line weight';
    w.oninput = () => PSMarkup.setWidth(+w.value);
    bar.appendChild(w);

    const span = el('select', 'mkSpan');
    [['step', 'this step only'], ['from', 'from here on'], ['hand', 'whole hand']]
      .forEach(([v, l]) => span.appendChild(new Option(l, v)));
    span.title = 'How long the next mark stays on screen';
    span.onchange = () => PSMarkup.setSpan(span.value);
    bar.appendChild(span);

    const grp = el('div', 'mkGrp');
    [['↶', 'Undo (⌘Z)', () => PSMarkup.undo()],
     ['↷', 'Redo (⇧⌘Z)', () => PSMarkup.redo()],
     ['clear step', 'Remove the marks showing on this step', () => PSMarkup.clearStep()],
     ['clear hand', 'Remove every mark in this hand', () => { if (confirm('Remove every mark in this hand?')) PSMarkup.clearHand(); }],
    ].forEach(([g, tip, fn]) => {
      const b = el('button', 'mkB', g); b.title = tip; b.onclick = fn; grp.appendChild(b);
    });
    bar.appendChild(grp);

    const right = el('div', 'mkGrp mkRight');
    const sv = el('button', 'mkB', '⭳ save lesson');
    sv.title = 'Write this lesson (hand, markup, notes, narration) to a file';
    sv.onclick = doExport;
    right.appendChild(sv);
    const pres = el('button', 'mkB', '⛶ present');
    pres.title = 'Hide the panels and fill the screen with the table';
    pres.onclick = () => setPresenting(!presenting);
    right.appendChild(pres);
    bar.appendChild(right);
  }

  function pickTool(k) {
    document.querySelectorAll('.mkT').forEach(x => x.classList.toggle('on', x.dataset.tool === k));
    PSMarkup.setTool(k);
  }

  /* =====================================================================
     teach panel (right side)
     ===================================================================== */
  function buildPanel() {
    const p = $('#paneTeach');
    p.innerHTML = '';

    p.appendChild(el('h4', 'sec', 'Lesson'));
    const title = el('input', 'tInput'); title.id = 'tTitle'; title.placeholder = 'lesson title…';
    title.oninput = () => PSLesson.setTitle(hid(), title.value);
    p.appendChild(title);

    const nh = el('h4', 'sec', 'Note for this step');
    p.appendChild(nh);
    const note = el('textarea', 'tNote'); note.id = 'tNote';
    note.placeholder = 'What should the viewer understand at this point?';
    note.oninput = () => {
      clearTimeout(noteTimer);
      noteTimer = setTimeout(() => {
        PSLesson.setNote(hid(), PSApp.step(), note.value);
        refreshMarkers(); band(); refreshPanel(); flashSaved();
        if (PSApp.refreshStars) PSApp.refreshStars();
      }, 200);
    };
    p.appendChild(note);
    const nrow = el('div', 'tRow');
    const dbtn = el('button', 'btn micBtn', '🎙 dictate'); dbtn.id = 'tDictate';
    dbtn.title = 'Speak instead of typing — fills the box that has focus';
    dbtn.onclick = () => dictate(document.activeElement && /TEXTAREA|INPUT/.test(document.activeElement.tagName)
      ? document.activeElement : note);
    if (!dictationAvailable()) { dbtn.disabled = true; dbtn.title = 'This browser has no speech recognition'; }
    nrow.appendChild(dbtn);
    const saved = el('span', 'tSaved', 'saved automatically'); saved.id = 'tSaved';
    nrow.appendChild(saved);
    p.appendChild(nrow);

    const jump = el('div', 'tJump'); jump.id = 'tJump';
    p.appendChild(el('h4', 'sec', 'Marked steps'));
    p.appendChild(jump);

    p.appendChild(el('h4', 'sec', 'Narration'));
    const nb = el('div', 'tRow'); nb.id = 'tNarr';
    const mk = (id, cls, label, fn) => { const b = el('button', cls, label); b.id = id; b.onclick = fn; return b; };
    nb.appendChild(mk('tRec', 'btn', '● record', toggleRecord));
    nb.appendChild(mk('tPlay', 'btn', '▶ play', togglePlay));
    nb.appendChild(mk('tDelA', 'btn', '✕', async () => {
      if (!confirm('Delete the narration for this hand?')) return;
      await PSLesson.dropAudio(hid()); PSLesson.setTimeline(hid(), null); refreshPanel();
    }));
    p.appendChild(nb);
    p.appendChild(el('div', 'tHint', '')).id = 'tRecHint';

    p.appendChild(el('h4', 'sec', 'Record a video'));
    const vb = el('div', 'tRow');
    vb.appendChild(mk('tVid', 'btn', '⏺ screen + mic', toggleVideo));
    p.appendChild(vb);
    p.appendChild(el('div', 'tHint', 'Captures whatever window or tab you pick, with your microphone, and saves a video file (.webm, or .mp4 in Safari).'));

    p.appendChild(el('h4', 'sec', 'Lesson file'));
    const fb = el('div', 'tRow');
    fb.appendChild(mk('tExp', 'btn', '⭳ export', doExport));
    const imp = el('label', 'btn file'); imp.textContent = '⭱ import';
    const fi = el('input'); fi.type = 'file'; fi.accept = '.json,application/json';
    fi.onchange = e => doImport(e.target.files[0]);
    imp.appendChild(fi); fb.appendChild(imp);
    fb.appendChild(mk('tDel', 'btn', 'delete lesson', () => {
      if (!confirm('Delete all markup, notes and narration for this hand?')) return;
      PSLesson.drop(hid()); PSMarkup.setContext(hid(), PSApp.step()); refreshPanel(); refreshMarkers(); band();
    }));
    p.appendChild(fb);
    p.appendChild(el('div', 'tHint', 'An exported lesson carries the hand text, the markup, the notes and the audio in one file.'));

    p.appendChild(el('h4', 'sec', 'Lessons on this machine'));
    p.appendChild(el('div', 'tJump')).id = 'tAll';
  }

  function refreshPanel() {
    if (!$('#paneTeach') || !hid()) return;
    const id = hid(), h = PSLesson.hand(id);
    $('#tTitle').value = (h && h.title) || '';
    const n = $('#tNote');
    if (document.activeElement !== n) n.value = (h && h.notes[PSApp.step()]) || '';

    const jump = $('#tJump'); jump.innerHTML = '';
    const steps = [...PSLesson.annotatedSteps(id)].sort((a, b) => a - b);
    if (!steps.length) jump.appendChild(el('div', 'tHint', 'No marks or notes yet — pick a tool above and draw on the table.'));
    steps.forEach(s => {
      const note = (h && h.notes[s]) || '';
      const row = el('div', 'tStep' + (s === PSApp.step() ? ' on' : ''));
      row.appendChild(el('b', null, 'step ' + (s + 1)));
      row.appendChild(el('span', null, note ? note.slice(0, 60) : '(markup)'));
      row.onclick = () => PSApp.goto(s);
      jump.appendChild(row);
    });

    const hasAudio = !!(h && h.audio);
    $('#tPlay').disabled = !hasAudio;
    $('#tDelA').disabled = !hasAudio;
    $('#tRecHint').textContent = rec ? 'recording…'
      : hasAudio ? 'narration ' + fmtT(h.audio.dur || 0) + ' · ' + Math.round((h.audio.size || 0) / 1024) + ' kB' +
          (PSLesson.audioDurable() ? '' : ' · kept in memory only — export to keep it')
      : 'Records your mic and remembers which step was on screen when, so playback walks the hand for you.';

    const all = $('#tAll'); all.innerHTML = '';
    PSLesson.taughtHands().forEach(x => {
      const lh = PSLesson.hand(x);
      const row = el('div', 'tStep' + (x === id ? ' on' : ''));
      row.appendChild(el('b', null, '#' + String(x).slice(-6)));
      row.appendChild(el('span', null, (lh.title || '') + ' · ' + lh.marks.length + ' marks · ' +
        Object.keys(lh.notes).length + ' notes' + (lh.audio ? ' · audio' : '')));
      row.onclick = () => PSApp.openById(x);
      all.appendChild(row);
    });
  }

  let savedTimer = null;
  function flashSaved() {
    const e = $('#tSaved');
    if (!e) return;
    e.textContent = '✓ saved';
    e.classList.add('on');
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => { e.classList.remove('on'); e.textContent = 'saved automatically'; }, 1400);
  }

  const fmtT = ms => {
    const s = Math.round(ms / 1000);
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  };

  /* ---------- presenter band + scrubber markers ---------- */
  function band() {
    const b = $('#teachBand');
    const h = PSLesson.hand(hid());
    const txt = h && h.notes[PSApp.step()];
    b.textContent = txt || '';
    b.classList.toggle('on', !!txt && (teaching || presenting || playing));
  }

  function refreshMarkers() {
    const wrap = $('#scrubMarks');
    if (!wrap) return;
    wrap.innerHTML = '';
    const id = hid(); if (!id) return;
    const n = PSApp.steps();
    const h = PSLesson.hand(id);
    [...PSLesson.annotatedSteps(id)].forEach(s => {
      const d = el('div', 'sMark' + (h && h.notes[s] ? ' note' : ''));
      d.style.left = (n > 1 ? (100 * s / (n - 1)) : 0) + '%';
      d.title = (h && h.notes[s]) || 'markup';
      d.onclick = () => PSApp.goto(s);
      wrap.appendChild(d);
    });
  }

  /* =====================================================================
     dictation — speech to text into whichever box has focus
     ===================================================================== */
  const SR = global.SpeechRecognition || global.webkitSpeechRecognition;
  let dict = null, dictTarget = null, dictBase = '', dictFinal = '';

  const dictationAvailable = () => !!SR;

  function stopDictation() {
    if (!dict) return;
    try { dict.stop(); } catch (e) { }
    dict = null; dictTarget = null;
    document.querySelectorAll('.dictating').forEach(e => e.classList.remove('dictating'));
    const b = document.getElementById('tDictate');
    if (b) { b.classList.remove('on'); b.textContent = '🎙 dictate'; }
  }

  function dictate(target) {
    if (dict) { stopDictation(); return; }
    if (!SR) { alert('This browser has no speech recognition. Chrome and Safari both do — or record narration instead.'); return; }
    target = target || $('#tNote');
    dict = new SR();
    dict.continuous = true;
    dict.interimResults = true;
    dict.lang = navigator.language || 'en-US';
    dictTarget = target;
    dictBase = target.value ? target.value.replace(/\s*$/, '') + ' ' : '';
    dictFinal = '';
    dict.onresult = e => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) dictFinal += t.replace(/^\s*/, '') + ' ';
        else interim += t;
      }
      dictTarget.value = dictBase + dictFinal + interim;
      dictTarget.dispatchEvent(new Event('input', { bubbles: true }));
    };
    dict.onerror = ev => {
      const why = ev.error === 'not-allowed' ? 'microphone permission was denied'
        : ev.error === 'no-speech' ? 'nothing was heard' : ev.error;
      $('#tRecHint').textContent = 'dictation stopped — ' + why;
      stopDictation();
    };
    dict.onend = () => { if (dict) stopDictation(); };
    try { dict.start(); } catch (e) { stopDictation(); return; }
    target.classList.add('dictating');
    const b = $('#tDictate');
    if (b) { b.classList.add('on'); b.textContent = '■ stop'; }
    $('#tRecHint').textContent = 'listening — speak, then press stop';
  }

  /* =====================================================================
     narration
     ===================================================================== */
  function pickMime(kinds) {
    for (const m of kinds) if (window.MediaRecorder && MediaRecorder.isTypeSupported(m)) return m;
    return '';
  }

  async function toggleRecord() {
    stopDictation();
    if (rec) { stopRecord(); return; }
    if (playing) togglePlay();
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (e) {
      alert('Could not open the microphone: ' + e.message +
        '\n\nIf you opened this file directly, try serving it over http (see the README) — some browsers block capture on file:// pages.');
      return;
    }
    recStream = stream; recChunks = []; recEvents = [];
    const mime = pickMime(['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/aac']);
    rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    rec.ondataavailable = e => { if (e.data && e.data.size) recChunks.push(e.data); };
    rec.onstop = async () => {
      const blob = new Blob(recChunks, { type: rec.mimeType || 'audio/webm' });
      const dur = Date.now() - recStart;
      await PSLesson.putAudio(hid(), blob, { dur: dur });
      PSLesson.setTimeline(hid(), { dur: dur, events: recEvents });
      recStream.getTracks().forEach(t => t.stop());
      rec = null; recStream = null;
      clearInterval(recTick); recTick = null;
      $('#tRec').classList.remove('rec'); $('#tRec').textContent = '● record';
      document.body.classList.remove('recording');
      refreshPanel();
    };
    recStart = Date.now();
    logStep(PSApp.step());
    rec.start(250);
    $('#tRec').classList.add('rec');
    document.body.classList.add('recording');
    recTick = setInterval(() => {
      $('#tRec').textContent = '■ stop ' + fmtT(Date.now() - recStart);
      $('#tRecHint').textContent = 'recording — step changes are being captured';
    }, 250);
  }
  function stopRecord() { if (rec && rec.state !== 'inactive') rec.stop(); }
  function logStep(s) { if (rec) recEvents.push({ t: Date.now() - recStart, step: s }); }

  async function togglePlay() {
    if (playing) {
      playing = false;
      if (player) { player.pause(); }
      clearInterval(playTick); playTick = null;
      $('#tPlay').textContent = '▶ play';
      document.body.classList.remove('playingLesson');
      band();
      return;
    }
    const id = hid();
    const blob = await PSLesson.getAudio(id);
    const h = PSLesson.hand(id);
    if (!blob) { alert('No narration recorded for this hand yet.'); return; }
    if (player) { URL.revokeObjectURL(player.src); }
    player = new Audio(URL.createObjectURL(blob));
    const tl = (h && h.timeline) || { events: [] };
    playing = true;
    document.body.classList.add('playingLesson');
    $('#tPlay').textContent = '❚❚ pause';
    player.onended = () => { if (playing) togglePlay(); };
    player.play().catch(e => { alert('Playback failed: ' + e.message); playing = false; });
    // a timer, not requestAnimationFrame: rAF stops when the window is hidden or
    // occluded, and a lesson has to keep following the audio while you talk over
    // another window
    const follow = () => {
      if (!playing) return;
      const ms = player.currentTime * 1000;
      let want = null;
      for (const e of tl.events) { if (e.t <= ms) want = e.step; else break; }
      if (want != null && want !== PSApp.step()) PSApp.goto(want);
      band();
    };
    clearInterval(playTick);
    playTick = setInterval(follow, 70);
    player.addEventListener('timeupdate', follow);
    follow();
  }

  /* =====================================================================
     screen + mic capture
     ===================================================================== */
  async function toggleVideo() {
    if (vidRec) { vidRec.stop(); return; }
    let disp;
    try {
      disp = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: true });
    } catch (e) {
      if (e.name !== 'NotAllowedError') alert('Screen capture failed: ' + e.message);
      return;
    }
    let stream = disp;
    try {
      const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const dest = ctx.createMediaStreamDestination();
      if (disp.getAudioTracks().length) ctx.createMediaStreamSource(new MediaStream(disp.getAudioTracks())).connect(dest);
      ctx.createMediaStreamSource(mic).connect(dest);
      stream = new MediaStream(disp.getVideoTracks().concat(dest.stream.getAudioTracks()));
      stream.__extra = [mic, ctx];
    } catch (e) { /* no mic: screen audio only */ }

    vidStream = stream; vidChunks = [];
    // Safari's MediaRecorder does not do webm at all — it records mp4
    const mime = pickMime(['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4']);
    vidRec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 4e6 } : undefined);
    vidRec.ondataavailable = e => { if (e.data && e.data.size) vidChunks.push(e.data); };
    vidRec.onstop = () => {
      const type = vidRec.mimeType || 'video/webm';
      const blob = new Blob(vidChunks, { type: type });
      download(blob, 'hand-' + (hid() || 'lesson') + (/mp4/.test(type) ? '.mp4' : '.webm'));
      disp.getTracks().forEach(t => t.stop());
      if (stream.__extra) { stream.__extra[0].getTracks().forEach(t => t.stop()); stream.__extra[1].close(); }
      vidRec = null; vidStream = null;
      clearInterval(vidTick); vidTick = null;
      $('#tVid').classList.remove('rec'); $('#tVid').textContent = '⏺ screen + mic';
      document.body.classList.remove('recording');
    };
    disp.getVideoTracks()[0].addEventListener('ended', () => { if (vidRec) vidRec.stop(); });
    vidStart = Date.now();
    vidRec.start(500);
    $('#tVid').classList.add('rec');
    document.body.classList.add('recording');
    vidTick = setInterval(() => { $('#tVid').textContent = '■ stop ' + fmtT(Date.now() - vidStart); }, 250);
  }

  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
  }

  /* =====================================================================
     export / import
     ===================================================================== */
  async function doExport() {
    const id = hid(); if (!id) return;
    const h = PSApp.hand();
    const obj = await PSLesson.exportLesson([id], { [id]: h.raw });
    download(new Blob([JSON.stringify(obj)], { type: 'application/json' }),
      'lesson-' + id + '.json');
  }

  async function doImport(file) {
    if (!file) return;
    try {
      const obj = JSON.parse(await file.text());
      const ids = await PSLesson.importLesson(obj);
      // a lesson can carry its own hand text, so it opens even on a fresh machine
      for (const id of ids) {
        const rec = obj.hands[id];
        if (rec && rec.hand) PSApp.addHandText(rec.hand, 'lesson-' + id + '.txt');
      }
      if (ids.length) PSApp.openById(ids[0]);
      refreshPanel(); refreshMarkers(); band();
      alert('Loaded ' + ids.length + ' lesson(s).');
    } catch (e) { alert('Could not read that lesson file: ' + e.message); }
  }

  /* =====================================================================
     modes
     ===================================================================== */
  function setTeaching(v) {
    teaching = !!v;
    document.body.classList.toggle('teachMode', teaching);
    PSMarkup.setEnabled(teaching);
    $('#teachToggle').classList.toggle('on', teaching);
    if (teaching) { refreshPanel(); showTab('paneTeach'); }
    band();
  }
  function setPresenting(v) {
    presenting = !!v;
    document.body.classList.toggle('presenting', presenting);
    setTimeout(() => PSMarkup.render(), 60);
    band();
  }
  function showTab(pane) {
    const t = document.querySelector('.tab[data-pane="' + pane + '"]');
    if (t) t.click();
  }

  /* =====================================================================
     wiring
     ===================================================================== */
  function init() {
    buildBar();
    buildPanel();
    PSMarkup.attach($('#tableWrap'), () => {
      refreshMarkers(); refreshPanel(); flashSaved();
      if (PSApp.refreshStars) PSApp.refreshStars();     // a marked hand earns its blue star
    });

    $('#teachToggle').onclick = () => setTeaching(!teaching);

    PSApp.onRender(() => {
      PSMarkup.setContext(hid(), PSApp.step());
      refreshMarkers(); band();
      if (teaching) refreshPanel();
      logStep(PSApp.step());
    });

    document.addEventListener('keydown', e => {
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      const box = document.getElementById('mkInput');
      if (box && box.style.display === 'block') return;      // the text box owns the keyboard
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault(); e.shiftKey ? PSMarkup.redo() : PSMarkup.undo(); return;
      }
      if (e.key === 'Escape' && presenting) { setPresenting(false); return; }
      if (!teaching) return;
      if ((e.key === 'Enter' || e.key === 'F2') && PSMarkup.editSelection()) { e.preventDefault(); return; }
      const map = { v: 'select', a: 'arrow', b: 'box', o: 'ellipse', p: 'pen', t: 'text', g: 'target', l: 'spot', e: 'erase' };
      const k = e.key.toLowerCase();
      if (map[k]) { pickTool(map[k]); e.preventDefault(); }
      else if (e.key === 'Delete' || e.key === 'Backspace') { PSMarkup.deleteSel(); e.preventDefault(); }
    });

    window.addEventListener('beforeunload', e => {
      if (rec || vidRec) { e.preventDefault(); e.returnValue = ''; }
    });
  }

  global.PSTeach = {
    init, refreshPanel, refreshMarkers, band, setTeaching, setPresenting, pickTool,
    isPlaying: () => playing, dictate, stopDictation, dictationAvailable,
  };
})(window);
