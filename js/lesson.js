/* ===========================================================================
   lesson.js — storage for everything a teacher adds on top of a hand:
   markup shapes, per-step notes, a recorded narration timeline and the
   narration audio itself.

   Lessons live in localStorage keyed by hand id.  Audio blobs are too big for
   that, so they go to IndexedDB when it is available (it is not on file://
   in Chrome) and otherwise stay in memory for the session — either way
   "Export lesson" writes one self-contained .json with the audio inlined.
   =========================================================================== */
(function (global) {
  'use strict';

  const KEY = 'psreplayer.lessons.v2';
  const memAudio = {};            // handId -> Blob (session fallback)
  let idbOk = null;               // null = untested

  let data = read();
  function read() {
    let d;
    try { d = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { d = {}; }
    d.v = 2; d.hands = d.hands || {}; d.stars = d.stars || {};
    return d;
  }
  let t = null;
  function save() {
    clearTimeout(t);
    t = setTimeout(() => {
      try { localStorage.setItem(KEY, JSON.stringify(data)); }
      catch (e) { console.warn('lesson save failed', e); }
    }, 250);
  }

  function hand(id, make) {
    if (!id) return null;
    if (!data.hands[id] && make) data.hands[id] = { marks: [], notes: {}, timeline: null, audio: null, title: '' };
    return data.hands[id] || null;
  }
  const marks = id => (hand(id) || { marks: [] }).marks;
  const notes = id => (hand(id) || { notes: {} }).notes;

  function setMarks(id, list) { hand(id, true).marks = list; save(); }
  function setNote(id, step, text) {
    const h = hand(id, true);
    if (text && text.trim()) h.notes[step] = text; else delete h.notes[step];
    save();
  }
  function setTimeline(id, tl) { hand(id, true).timeline = tl; save(); }
  function setTitle(id, s) { hand(id, true).title = s; save(); }

  function isEmpty(id) {
    const h = hand(id);
    if (!h) return true;
    return !h.marks.length && !Object.keys(h.notes).length && !h.timeline && !h.audio;
  }
  function annotatedSteps(id) {
    const h = hand(id), out = new Set();
    if (!h) return out;
    h.marks.forEach(m => out.add(m.step));
    Object.keys(h.notes).forEach(k => out.add(+k));
    return out;
  }
  const taughtHands = () => Object.keys(data.hands).filter(id => !isEmpty(id));

  function drop(id) { delete data.hands[id]; delete memAudio[id]; save(); dropAudio(id); }

  /* ---------- stars: hands tagged for review ---------------------------- */
  function star(id, on) {
    if (!id) return false;
    const v = on == null ? !data.stars[id] : !!on;
    if (v) data.stars[id] = 1; else delete data.stars[id];
    save();
    return v;
  }
  const isStarred = id => !!data.stars[id];
  const starredIds = () => Object.keys(data.stars);
  /* a hand is "annotated" once it carries markup, a note or narration */
  const isAnnotated = id => !isEmpty(id);

  /* ---------- audio ---------------------------------------------------- */
  function db() {
    return new Promise((res, rej) => {
      let r;
      try { r = indexedDB.open('psreplayer', 1); }
      catch (e) { idbOk = false; return rej(e); }
      r.onupgradeneeded = () => { try { r.result.createObjectStore('audio'); } catch (e) { } };
      r.onsuccess = () => { idbOk = true; res(r.result); };
      r.onerror = () => { idbOk = false; rej(r.error); };
      r.onblocked = () => { idbOk = false; rej(new Error('blocked')); };
    });
  }
  async function putAudio(id, blob, meta) {
    memAudio[id] = blob;
    const h = hand(id, true);
    h.audio = Object.assign({ mime: blob.type, size: blob.size }, meta || {});
    save();
    try {
      const d = await db();
      await new Promise((res, rej) => {
        const tx = d.transaction('audio', 'readwrite');
        tx.objectStore('audio').put(blob, id);
        tx.oncomplete = res; tx.onerror = () => rej(tx.error);
      });
      return true;
    } catch (e) { return false; }          // memory-only; export still works
  }
  async function getAudio(id) {
    if (memAudio[id]) return memAudio[id];
    try {
      const d = await db();
      return await new Promise((res, rej) => {
        const tx = d.transaction('audio', 'readonly');
        const rq = tx.objectStore('audio').get(id);
        rq.onsuccess = () => { if (rq.result) memAudio[id] = rq.result; res(rq.result || null); };
        rq.onerror = () => rej(rq.error);
      });
    } catch (e) { return null; }
  }
  async function dropAudio(id) {
    delete memAudio[id];
    const h = hand(id); if (h) { h.audio = null; save(); }
    try {
      const d = await db();
      const tx = d.transaction('audio', 'readwrite');
      tx.objectStore('audio').delete(id);
    } catch (e) { }
  }
  const audioDurable = () => idbOk !== false;

  /* ---------- export / import ------------------------------------------ */
  const b64 = blob => new Promise(res => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.readAsDataURL(blob);
  });

  async function exportLesson(ids, extra) {
    const out = { app: 'PokerStars Hand Replayer lesson', v: 2, saved: new Date().toISOString(), hands: {} };
    for (const id of ids) {
      const h = hand(id);
      if (!h) continue;
      const rec = JSON.parse(JSON.stringify(h));
      const blob = await getAudio(id);
      if (blob) rec.audioData = await b64(blob);
      if (extra && extra[id]) rec.hand = extra[id];      // raw hand text, so a lesson opens standalone
      out.hands[id] = rec;
    }
    return out;
  }

  async function importLesson(obj) {
    if (!obj || !obj.hands) throw new Error('not a lesson file');
    const ids = [];
    for (const id of Object.keys(obj.hands)) {
      const rec = obj.hands[id];
      const h = hand(id, true);
      h.marks = rec.marks || [];
      h.notes = rec.notes || {};
      h.timeline = rec.timeline || null;
      h.title = rec.title || '';
      h.audio = rec.audio || null;
      if (rec.audioData) {
        const blob = await (await fetch(rec.audioData)).blob();
        await putAudio(id, blob, rec.audio || {});
      }
      ids.push(id);
    }
    save();
    return ids;
  }

  global.PSLesson = {
    hand, marks, notes, setMarks, setNote, setTimeline, setTitle,
    isEmpty, annotatedSteps, taughtHands, drop,
    star, isStarred, starredIds, isAnnotated,
    putAudio, getAudio, dropAudio, audioDurable,
    exportLesson, importLesson,
    raw: () => data,
  };
})(window);
