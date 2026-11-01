// @ts-nocheck
// The studio: watch the film without rendering it, click the picture to say what's wrong where, and leave the rest to the code.
// Same scene as the render, drawn live, with the sound as the clock. Saving code reloads at the same second.
import * as THREE from "three";
import { applyEdit, buildScene, DURATION, SHOTS_OUT as SHOTS } from "./scene";
import { EDIT, fromSource, setEdit, toSource } from "./edit";

const FPS = 30;
const PHONE = matchMedia("(pointer: coarse)").matches && Math.min(innerWidth, innerHeight) < 600;
if (PHONE) window.__assets = "/lite/";
const MIX_URL = PHONE ? "/mix_phone.mp3" : "/mix.wav";
const $ = (id) => document.getElementById(id);
const canvas = $("gl"), audio = $("audio"), stage = $("stage"), text = $("text");
const pad = (n, w = 2) => String(n).padStart(w, "0");
const stamp = (x) => { const ms = Math.round(x * 1000); return `${pad(Math.floor(ms / 60000))}:${pad(Math.floor(ms / 1000) % 60)}.${pad(ms % 1000, 3)}`; };
const getFile = async (url) => {
  for (;;) {
    try { const r = await fetch(url); if (r.ok || r.status === 404) return r; } catch {}
    await new Promise((done) => setTimeout(done, 2000));
  }
};
const showError = (m) => { $("err").textContent = String(m); $("err").style.display = "block"; };
window.onerror = (m) => showError(m);
window.onunhandledrejection = (e) => showError(e.reason?.stack ?? e.reason);
let failedFile = "";
THREE.DefaultLoadingManager.onError = (url) => { failedFile = url; };
THREE.DefaultLoadingManager.onProgress = (_, done, total) => { if (!render) $("load").textContent = `đang dựng căn phòng... ${done}/${total}`; };
const jsonPost = (url, body) => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const flash = (m) => { $("mix").textContent = m; clearTimeout(flash.h); flash.h = setTimeout(() => { $("mix").textContent = ""; }, 3000); };

let t = Math.min(Number(sessionStorage.getItem("t")) || 0, DURATION - 0.01);
let playing = false, dirty = true, render = null, tools = null, comments = [], notes = [], voice = { step: 0.04, peaks: [], lines: [] }, voiceOut = [];
let lastDraw = 0, drawMs = 0, frames = 0, fps = 0, fpsAt = performance.now(), clockStart = 0, dragging = null, reloadWaiting = false, looping = false;
let finalRender = null, finalOn = false, finalAt = -1;
let compose = null; // the note being spoken: { t, pin, resume }

const shotIndex = (x) => { let i = 0; SHOTS.forEach((s, n) => { if (x >= s.t) i = n; }); return i; };
const shotEnd = (i) => SHOTS[i + 1]?.t ?? DURATION;
const lineAt = (x) => voiceOut.find((l) => x >= l.s && x <= l.e + 0.35) ?? null;
const seek = (x) => {
  t = Math.max(0, Math.min(DURATION - 0.01, Math.round(x * FPS) / FPS)); // whole frames, so a time said out loud is a frame that exists
  if (audio.readyState > 0) audio.currentTime = t;
  clockStart = performance.now() - t * 1000;
  dirty = true;
};
const setPlaying = (p) => {
  playing = p;
  $("play").textContent = p ? "❚❚ Dừng" : "▶ Phát";
  if (p) { clockStart = performance.now() - t * 1000; audio.currentTime = t; audio.play().catch(() => {}); ctx.resume(); } else { audio.pause(); seek(Math.round(t * FPS) / FPS); }
};

// ---------- The sound's source
const setAudio = (url) => {
  audio.src = url;
  audio.addEventListener("loadedmetadata", () => { audio.currentTime = t; if (playing) audio.play().catch(() => {}); }, { once: true });
};
// A phone line can stall for seconds: the whole mix comes down once and then plays from memory, so nothing the line does can cut it
let mixLoad = 0, mixBlob = "";
const loadPhoneMix = async () => {
  const mine = ++mixLoad;
  for (let tries = 0; mine === mixLoad; tries++) {
    try {
      const r = await fetch(MIX_URL);
      if (!r.ok) throw new Error(r.status);
      const total = Number(r.headers.get("content-length")), reader = r.body.getReader(), parts = [];
      for (let got = 0; ;) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value);
        got += value.length;
        if (total) { $("mix").textContent = `đang tải tiếng ${Math.round((got / total) * 100)}%`; clearTimeout(flash.h); }
      }
      if (mine !== mixLoad) return;
      URL.revokeObjectURL(mixBlob);
      mixBlob = URL.createObjectURL(new Blob(parts, { type: "audio/mpeg" }));
      setAudio(mixBlob);
      flash("tiếng đã tải xong");
      return;
    } catch {
      $("mix").textContent = `mạng chập chờn, tải lại tiếng lần ${tries + 1}...`;
      await new Promise((done) => setTimeout(done, 2000));
    }
  }
};
const loadMix = () => { if (PHONE) loadPhoneMix(); else setAudio(MIX_URL + "?" + Date.now()); };
// The browser can pause the sound by itself (a notification, autoplay rules) while the picture runs on: pick it up where the picture is
const keepSound = () => { if (playing && audio.paused && audio.readyState > 0) { audio.currentTime = t; audio.play().catch(() => {}); } };
setInterval(keepSound, 1000);
document.addEventListener("pointerdown", keepSound);

// ---------- Picture fills the room it has
const fit = () => {
  const r = $("view").getBoundingClientRect();
  const s = Math.min(r.width / 16, r.height / 9);
  stage.style.width = `${Math.floor(s * 16)}px`; stage.style.height = `${Math.floor(s * 9)}px`;
};
new ResizeObserver(fit).observe($("view"));

// ---------- Saying what a click landed on
const ray = new THREE.Raycaster();
const BONE_PARTS = [[/Head|Neck/, "đầu"], [/Left.*Hand|LeftHand/, "bàn tay trái"], [/Right.*Hand|RightHand/, "bàn tay phải"], [/LeftFoot|LeftToe/, "bàn chân trái"], [/RightFoot|RightToe/, "bàn chân phải"], [/LeftForeArm|LeftArm|LeftShoulder/, "tay trái"], [/RightForeArm|RightArm|RightShoulder/, "tay phải"], [/LeftUpLeg|LeftLeg/, "chân trái"], [/RightUpLeg|RightLeg/, "chân phải"], [/Spine|Hips/, "thân"]];
const shown = (o) => { for (let c = o; c; c = c.parent) if (!c.visible) return false; return true; };
const owner = (o) => { for (let c = o; c; c = c.parent) { const hit = tools.objects.find(([obj]) => obj === c); if (hit) return hit; } return null; };
const whatIs = (hit) => {
  const found = owner(hit.object);
  if (found?.[0] === tools.rig) {
    let best = null, d = 1e9;
    const v = new THREE.Vector3();
    for (const n in tools.bones) { const e = tools.bones[n].getWorldPosition(v).distanceToSquared(hit.point); if (e < d) { d = e; best = n; } }
    const part = BONE_PARTS.find(([re]) => re.test(best))?.[1];
    return part ? `nhân vật, ${part}` : "nhân vật";
  }
  if (found) return found[1];
  const m = [].concat(hit.object.material)[0];
  const byMat = tools.materials.find(([mat]) => mat === m);
  if (byMat) return byMat[1];
  const n = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : null;
  if (n && n.y > 0.7) return "mặt trên một vật";
  return hit.object.name || "vật không tên";
};
const lookAtClick = (x, y) => {
  ray.setFromCamera(new THREE.Vector2(x * 2 - 1, 1 - y * 2), tools.camera);
  const hit = ray.intersectObjects(tools.scene.children, true).find((h) => {
    if (!h.object.isMesh || !shown(h.object)) return false;
    const m = [].concat(h.object.material)[0];
    return !(m.transparent && !m.depthWrite);
  });
  if (!hit) return { what: "khoảng trống" };
  return { what: whatIs(hit), world: hit.point.toArray().map((v) => +v.toFixed(3)) };
};

// The camera as a line for SHOTS: what makes this exact frame, with the shot's slow zoom and its head offset taken out
const camLine = () => {
  const cam = tools.camera, i = shotIndex(t), shot = SHOTS[i];
  const u = (t - shot.t) / (shotEnd(i) - shot.t);
  const look = tools.free.on ? tools.free.l : tools.look;
  const k = tools.zoomOf(i) * (tools.smoother(u) - 0.5);
  const off = new THREE.Vector3();
  if (shot.rel) { off.copy(tools.head); if (shot.off) off.x += tools.CELL; }
  const l = look.clone().sub(off);
  const p = cam.position.clone().addScaledVector(look, -k).divideScalar(1 - k).sub(off);
  const V = (v) => `V(${v.x.toFixed(3)}, ${v.y.toFixed(3)}, ${v.z.toFixed(3)})`;
  const warn = [shot.pan && "shot này có pan", shot.follow && "shot này bám đầu", shot.walk && "shot này đi bộ"].filter(Boolean).join(", ");
  return { shot: i, line: `p: [${V(p)}, ${V(p)}], l: [${V(l)}, ${V(l)}], fov: ${+cam.fov.toFixed(1)}`, world: { p: cam.position.toArray().map((v) => +v.toFixed(3)), l: look.toArray().map((v) => +v.toFixed(3)) }, warn: warn || undefined };
};

// Beside the picture with the pin, the note carries what's under the pin unmarked, and the seconds around the moment:
// a press during playback lands after what was being reacted to, and a note about a cut or a held shot is about those seconds
const pinCrop = (pin) => {
  const from = finalOn && finalRender ? $("final") : canvas, side = Math.round(from.height * 0.34);
  const c = document.createElement("canvas");
  c.width = c.height = 480;
  c.getContext("2d").drawImage(from, pin.x * from.width - side / 2, pin.y * from.height - side / 2, side, side, 0, 0, 480, 480);
  return c.toDataURL("image/jpeg", 0.85);
};
const STRIP = [-2, -1, 0, 1];
const momentStrip = (at) => {
  const w = 400, h = 225, c = document.createElement("canvas");
  c.width = w * STRIP.length; c.height = h;
  const g = c.getContext("2d");
  g.font = "bold 20px Consolas";
  STRIP.forEach((d, i) => {
    const x = Math.min(Math.max(0, at + d), DURATION - 0.02);
    render(x);
    g.drawImage(canvas, i * w, 0, w, h);
    g.fillStyle = "rgba(0,0,0,.7)"; g.fillRect(i * w + 4, 4, 128, 28);
    g.fillStyle = d === 0 ? "#ffd23e" : "#fff"; g.fillText(stamp(x), i * w + 8, 25);
    g.fillStyle = "#000"; g.fillRect(i * w, 0, 2, h);
  });
  return c.toDataURL("image/jpeg", 0.8);
};
// Everything around the moment, as the film stood when the note was written
const noteContext = (c) => {
  const near = (from, to, within) => c.t >= from - within && c.t <= to + within;
  const here = voiceOut.findIndex((l) => c.t >= l.s && c.t <= l.e + 0.35);
  const after = voiceOut.findIndex((l) => l.s > c.t);
  const before = here >= 0 ? here - 1 : after > 0 ? after - 1 : after < 0 ? voiceOut.length - 1 : -1;
  const next = here >= 0 ? here + 1 : after;
  const all = voiceOut.flatMap((l) => l.words);
  const word = wordNear(c.t).word, wi = all.indexOf(word);
  const beats = Object.entries(EDIT.beats).map(([id, b]) => ({ id, title: b.title, kind: b.kind, at: +fromSource(b.at).toFixed(3), dur: b.dur, sounds: b.sounds })).filter((b) => near(b.at, b.at + (b.dur ?? 0), 1.5));
  return {
    playing: !!c.wasPlaying, // pressed during playback: what it's about may be a moment earlier
    rate: audio.playbackRate,
    muted: audio.muted || undefined,
    shot: { from: +SHOTS[c.shot].t.toFixed(3), to: +shotEnd(c.shot).toFixed(3), into: +(c.t - SHOTS[c.shot].t).toFixed(3) },
    voice: {
      word: word?.w,
      wordAt: word ? +word.s.toFixed(3) : undefined,
      around: wi >= 0 ? all.slice(Math.max(0, wi - 4), wi + 5).map((w) => w.w).join(" ") : undefined,
      line: voiceOut[here]?.text,
      before: voiceOut[before]?.text,
      next: voiceOut[next]?.text,
      silence: here < 0 || undefined,
    },
    beats,
    view: { phone: PHONE, lite: !!window.__assets?.includes("lite"), canvas: [canvas.width, canvas.height], screen: [innerWidth, innerHeight] },
  };
};
const snapshot = (pin, at = t) => {
  const c = document.createElement("canvas");
  c.width = 960; c.height = 540;
  const g = c.getContext("2d");
  g.drawImage(finalOn && finalRender ? $("final") : canvas, 0, 0, 960, 540);
  if (pin) { g.strokeStyle = "#ffd23e"; g.lineWidth = 3; g.beginPath(); g.arc(pin.x * 960, pin.y * 540, 14, 0, 7); g.stroke(); g.strokeStyle = "#000"; g.lineWidth = 1; g.beginPath(); g.arc(pin.x * 960, pin.y * 540, 16, 0, 7); g.stroke(); }
  g.font = "bold 24px Consolas"; g.textAlign = "right"; g.fillStyle = "rgba(0,0,0,.7)"; g.fillRect(790, 8, 162, 34); g.fillStyle = "#fff"; g.fillText(stamp(at), 944, 33);
  return c.toDataURL("image/jpeg", 0.85);
};

// ---------- Notes
const whereText = (n) => `${stamp(n.t)} | shot ${n.shot} (${n.shotName})${n.pin ? ` | ${n.pin.what}` : ""}`;
const showBox = () => {
  const old = compose.editing;
  $("where").textContent = old ? `Sửa ghi chú ${compose.time} | shot ${compose.shot}` : whereText(compose);
  $("overwrite").style.display = old ? "block" : "none";
  $("compose").classList.add("open");
  listNotes();
};
const openNote = (pin) => {
  if (compose?.editing) { text.focus(); return; } // an old note's box stays on that note until Xong or Hủy
  const wasPlaying = compose ? compose.wasPlaying : playing;
  // Words already written belong to the note they were written for: a new place starts a new note. On the same frame a click just moves the pin
  if (compose && text.value.trim() && Math.abs(t - compose.t) > 0.01) { compose.resume = false; saveNote(); }
  if (playing) setPlaying(false);
  render(t);
  if (finalOn && finalRender) drawFinal();
  const i = shotIndex(t);
  const line = lineAt(t);
  compose = { t, shot: i, shotName: comments[i] ?? "", pin, resume: wasPlaying, wasPlaying, spoken: line?.text };
  showBox();
  text.focus();
  // For dictating straight into the chat instead: the place is already on the clipboard
  navigator.clipboard?.writeText(`${whereText(compose)}: `).catch(() => {});
  drawPins();
};
// What's being typed is on the device from the first letter: a reload or a killed tab brings it back
const keepDraft = () => { try { if (compose && text.value.trim()) localStorage.setItem("noteDraft", JSON.stringify({ compose, words: text.value })); else localStorage.removeItem("noteDraft"); } catch {} };
const restoreDraft = () => {
  let d = null;
  try { d = JSON.parse(localStorage.getItem("noteDraft")); } catch {}
  if (!d?.words) return;
  seek(d.compose.t);
  compose = { ...d.compose, resume: false };
  text.value = d.words;
  showBox();
  drawPins();
};
// An old note opens in the same box, with its words. Nothing is overwritten until Xong
const editOldNote = (n) => {
  if (compose?.editing === n.id) { text.focus(); return; }
  const wasPlaying = compose ? compose.resume : playing;
  if (compose && text.value.trim()) { compose.resume = false; saveNote(); } else if (compose) closeNote(true);
  if (playing) setPlaying(false);
  compose = { t, shot: n.shot, shotName: n.shotName ?? "", pin: null, resume: wasPlaying, editing: n.id, time: stamp(noteAt(n)), original: n.text };
  text.value = n.text;
  keepDraft();
  showBox();
  text.focus();
  text.setSelectionRange(text.value.length, text.value.length);
  drawPins();
};
// Hủy asks nothing: the words stay one press away in case it was a slip
const cancelNote = () => {
  if (!compose) return;
  const was = compose, words = text.value;
  const lost = words.trim() && words.trim() !== (was.original ?? "");
  closeNote(lost);
  if (lost) showUndo(was.editing ? `Đã bỏ chữ vừa sửa ở ${was.time}` : "Đã hủy ghi chú", () => {
    if (compose) { compose.resume = false; saveNote(); }
    if (playing) setPlaying(false);
    if (!was.editing) seek(was.t);
    compose = { ...was, resume: false };
    text.value = words;
    keepDraft();
    showBox();
    text.focus();
    drawPins();
  });
};
const closeNote = (stay) => {
  const resume = compose?.resume;
  compose = null;
  text.value = "";
  keepDraft();
  $("compose").classList.remove("open");
  text.blur();
  drawPins();
  listNotes();
  if (reloadWaiting && !stay) { sessionStorage.setItem("t", t); location.reload(); return; } // with an Undo showing, the reload waits for the next stop
  if (resume) setPlaying(true);
};
const saveNote = async () => {
  const body = text.value.trim();
  if (!compose) return;
  if (compose.editing) {
    const id = compose.editing, was = notes.find((x) => x.id === id);
    if (!body || body === compose.original) { closeNote(); return; } // emptied gets its words back: × is what removes a note
    const before = compose.original;
    if (was) editNote(id, body);
    else { queueOp(id, { restore: true, text: body }); flushNotes(); } // removed elsewhere meanwhile: these words still count
    const at = compose.time;
    closeNote(true);
    showUndo(`Đã ghi đè ghi chú ${at}`, () => editNote(id, before));
    return;
  }
  if (!body) { closeNote(); return; }
  const n = { id: Date.now().toString(36), at: new Date().toISOString(), t: +compose.t.toFixed(3), time: stamp(compose.t), frame: Math.round(compose.t * FPS), shot: compose.shot, shotName: compose.shotName, srcT: +toSource(compose.t).toFixed(3), spoken: compose.spoken, pin: compose.pin, cam: camLine(), freeCam: tools.free.on || undefined, finalLook: finalOn || undefined, context: noteContext(compose), text: body, done: false };
  // The note's own frame in its picture, even if the film has moved on since. No picture is no reason to lose the words
  let img = null, crop = null, strip = null;
  try { strip = momentStrip(compose.t); } catch {}
  try { render(compose.t); img = snapshot(n.pin, compose.t); if (n.pin) crop = pinCrop(n.pin); } catch {}
  dirty = true;
  notes.push(n);
  sendNote({ note: n, img, crop, strip });
  closeNote();
  noteTab = "open";
  listNotes();
  drawPins();
};
// Kept on the device until the server has it: a bad line delays a note, it never eats one
let heldNotes = null;
const unsent = () => { if (heldNotes) return heldNotes; try { return JSON.parse(localStorage.getItem("unsentNotes")) ?? []; } catch { return []; } };
const keepUnsent = (list) => {
  try { localStorage.setItem("unsentNotes", JSON.stringify(list)); heldNotes = null; return; } catch {}
  // Storage full: the words matter more than the pictures, the main picture more than the extras. No storage at all: they wait in this page
  for (const slim of [(x) => ({ note: x.note, img: x.img }), (x) => ({ note: x.note })]) {
    try { localStorage.setItem("unsentNotes", JSON.stringify(list.map(slim))); heldNotes = null; return; } catch {}
  }
  heldNotes = list;
};
const sendNote = async (item) => {
  keepUnsent([...unsent(), item]);
  flushNotes();
};
// Changes to notes wait the same way, the latest per note: { text }, { remove } or { restore }
let heldOps = null;
const unsentEdits = () => { if (heldOps) return heldOps; try { return JSON.parse(localStorage.getItem("unsentEdits")) ?? {}; } catch { return {}; } };
const keepEdits = (all) => { try { localStorage.setItem("unsentEdits", JSON.stringify(all)); heldOps = null; } catch { heldOps = all; } };
const queueOp = (id, op) => { keepEdits({ ...unsentEdits(), [id]: op }); };
const showSaved = (state) => {
  const el = $("saved");
  el.textContent = state === "fail" ? "Chưa gửi được, vẫn giữ trên máy này, đang thử lại" : state === "busy" ? "Đang lưu..." : notes.length ? "Đã lưu hết" : "";
  el.className = state ?? "";
};
let flushing = false;
const flushNotes = async () => {
  if (flushing) return;
  flushing = true;
  for (let list = unsent(), ops = Object.entries(unsentEdits()); list.length || ops.length; list = unsent(), ops = Object.entries(unsentEdits())) {
    showSaved("busy");
    try {
      if (list.length) {
        const r = await jsonPost("/notes", list[0]);
        if (!r.ok) throw new Error(r.status);
        keepUnsent(unsent().filter((x) => x.note.id !== list[0].note.id));
      } else {
        const [id, op] = ops[0];
        const r = await jsonPost(`/notes/${id}`, op);
        if (!r.ok) throw new Error(r.status);
        const now = unsentEdits();
        if (JSON.stringify(now[id]) === JSON.stringify(op)) { delete now[id]; keepEdits(now); }
      }
    } catch {
      showSaved("fail");
      await new Promise((done) => setTimeout(done, 3000));
    }
  }
  flushing = false;
  showSaved();
};
addEventListener("online", flushNotes);
document.addEventListener("visibilitychange", () => { if (!document.hidden) flushNotes(); });
const loadNotes = async () => {
  const have = await (await getFile("/notes.json")).json();
  const ops = unsentEdits();
  const back = notes.filter((n) => ops[n.id]?.restore && !have.some((h) => h.id === n.id));
  notes = [...have, ...unsent().map((x) => x.note).filter((n) => !have.some((h) => h.id === n.id)), ...back].filter((n) => !ops[n.id]?.remove);
  for (const n of notes) {
    if (typeof ops[n.id]?.text === "string") { n.text = ops[n.id].text; n.done = false; }
    if (ops[n.id]?.done === false) n.done = false;
  }
  listNotes(); drawOverview(); drawPins(); showSaved(flushing ? "busy" : undefined);
};
let editSend = 0;
const editNote = (id, words) => {
  const n = notes.find((x) => x.id === id);
  if (!n || !words || words === n.text) return;
  n.text = words;
  n.done = false;
  queueOp(id, { text: words });
  showSaved("busy");
  clearTimeout(editSend);
  editSend = setTimeout(flushNotes, 400);
};
// × asks nothing and takes back with one press: the note only moves to deleted.jsonl
let undoHide = 0;
const showUndo = (words, fn) => {
  $("undoText").textContent = words;
  $("undo").classList.add("open");
  clearTimeout(undoHide);
  undoHide = setTimeout(() => $("undo").classList.remove("open"), 10000);
  $("undoB").onclick = () => { $("undo").classList.remove("open"); fn(); };
};
const removeNote = (n) => {
  const waiting = unsent().find((x) => x.note.id === n.id);
  if (waiting) keepUnsent(unsent().filter((x) => x.note.id !== n.id));
  notes = notes.filter((x) => x.id !== n.id);
  queueOp(n.id, { remove: true });
  flushNotes();
  listNotes(); drawOverview(); drawPins();
  if (compose?.editing === n.id) closeNote(true);
  showUndo(`Đã xóa ghi chú ${n.time}`, () => {
    notes.push(n);
    queueOp(n.id, { restore: true, text: n.text });
    if (waiting) keepUnsent([...unsent(), waiting]);
    flushNotes();
    listNotes(); drawOverview(); drawPins();
  });
};
// A note remembers its place in the voice, so after voice edits it still finds its moment
const noteAt = (n) => (n.srcT != null ? fromSource(n.srcT) : n.t);
const fixLine = (fix) => {
  const d = document.createElement("div");
  d.className = "fix";
  d.textContent = `Đã sửa: ${fix.what} (${fix.checkpoint}, ${new Date(fix.at).toLocaleDateString("vi-VN")})`;
  return d;
};
const emptyLine = (words) => { const d = document.createElement("div"); d.className = "none"; d.textContent = words; return d; };
const noteCard = (n) => {
  const el = document.createElement("div");
  el.className = `note${compose?.editing === n.id ? " editing" : ""}`;
  el.dataset.t = noteAt(n);
  el.innerHTML = `<div class="h"><button class="time" title="Nhảy tới đây"></button><span class="w"></span><button class="del" title="Xóa">×</button></div><div class="b"></div>`;
  const go = el.querySelector(".time"), del = el.querySelector(".del");
  go.textContent = stamp(noteAt(n));
  el.querySelector(".w").textContent = `shot ${n.shot}${n.pin ? ` | ${n.pin.what}` : ""}`;
  el.querySelector(".b").textContent = n.text;
  go.onclick = (e) => { e.stopPropagation(); if (playing) setPlaying(false); seek(noteAt(n)); };
  del.onclick = (e) => { e.stopPropagation(); removeNote(n); };
  // Anywhere else on a note edits it, in the same box a new note is written in
  el.onclick = () => editOldNote(n);
  if (n.fixes?.length) el.append(fixLine(n.fixes.at(-1)));
  return el;
};
// History keeps what was asked, what the frame looked like and what was done. It's a record: the way back is "Chưa ưng"
const historyCard = (n) => {
  const el = document.createElement("div");
  el.className = "note old";
  el.dataset.t = noteAt(n);
  el.innerHTML = `<div class="h"><button class="time" title="Nhảy tới đây"></button><span class="w"></span><button class="again">Chưa ưng</button></div><div class="b"></div>`;
  const go = el.querySelector(".time");
  go.textContent = stamp(noteAt(n));
  go.onclick = () => { if (playing) setPlaying(false); seek(noteAt(n)); };
  el.querySelector(".w").textContent = `shot ${n.shot}`;
  el.querySelector(".b").textContent = n.text;
  el.querySelector(".again").onclick = () => {
    n.done = false;
    queueOp(n.id, { done: false });
    flushNotes();
    listNotes(); drawOverview(); drawPins();
    flash(`ghi chú ${stamp(noteAt(n))} đã về Cần sửa`);
  };
  if (n.img) {
    const pic = document.createElement("img");
    pic.src = `/note-img/${n.id}.jpg`;
    pic.loading = "lazy";
    pic.alt = "";
    el.querySelector(".h").after(pic);
  }
  for (const fix of n.fixes ?? []) el.append(fixLine(fix));
  return el;
};
const lastFixAt = (n) => n.fixes?.at(-1)?.at ?? n.at;
let noteTab = "open";
// The list keeps the note nearest the playhead in view. A finger or wheel on the list wins for a few seconds, and so does a note being edited
const HOLD_LIST = 4000;
let nearEl = null, listTouched = -1e9;
const followNotes = (jump) => {
  const list = $("list");
  if (noteTab !== "open") { if (nearEl) { nearEl.classList.remove("now"); nearEl = null; } return; }
  let near = null, best = Infinity;
  for (const el of list.children) { if (!el.dataset.t) continue; const d = Math.abs(el.dataset.t - t); if (d < best) { best = d; near = el; } }
  if (near === nearEl && !jump) return;
  nearEl?.classList.remove("now");
  nearEl = near;
  near?.classList.add("now");
  if (!near || compose?.editing || performance.now() - listTouched < HOLD_LIST) return;
  const top = near.offsetTop - list.offsetTop - (list.clientHeight - near.offsetHeight) / 2;
  list.scrollTo({ top, behavior: jump || Math.abs(top - list.scrollTop) > 500 ? "auto" : "smooth" }); // a long way is a jump, not a slide past everything
};
for (const ev of ["pointerdown", "wheel", "touchmove"]) addEventListener(ev, (e) => { if ($("list").contains(e.target)) listTouched = performance.now(); }, { passive: true });
const showTab = (tab) => { noteTab = tab; listNotes(); };
const listNotes = () => {
  const open = notes.filter((n) => !n.done).sort((a, b) => noteAt(a) - noteAt(b));
  const old = notes.filter((n) => n.done).sort((a, b) => (lastFixAt(a) < lastFixAt(b) ? 1 : -1));
  $("tabOpen").textContent = `Cần sửa (${open.length})`;
  $("tabHist").textContent = `Lịch sử (${old.length})`;
  $("tabOpen").classList.toggle("on", noteTab === "open");
  $("tabHist").classList.toggle("on", noteTab === "history");
  if (noteTab === "open") $("list").replaceChildren(...(open.length ? open.map(noteCard) : [emptyLine("Chưa có ghi chú")]));
  else $("list").replaceChildren(...(old.length ? old.map(historyCard) : [emptyLine("Ghi chú sửa xong sẽ nằm ở đây, kèm việc đã làm")]));
  nearEl = null;
  followNotes(true);
};
const drawPins = () => {
  const box = $("pins");
  const add = (pin, cls, label) => { const d = document.createElement("div"); d.className = `pin ${cls}`; d.style.left = `${pin.x * 100}%`; d.style.top = `${pin.y * 100}%`; if (label) { const i = document.createElement("i"); i.textContent = label; d.append(i); } box.append(d); };
  box.replaceChildren();
  if (!tools?.free.on) for (const n of notes) if (n.pin && !n.done && !n.freeCam && Math.abs(noteAt(n) - t) < 0.05) add(n.pin, "saved", n.pin.what);
  if (compose?.pin) add(compose.pin, "", compose.pin.what);
};

// ---------- Reading the timeline: the studio only looks and takes notes, changes are made from the notes in edit.json
const SLOW_WPM = 130, FAST_WPM = 280, STILL = 6; // a sentence outside these reads as off pace; this long with nothing moving reads as stuck
const HOLDS = new Set(["zz", "note1", "code", "typing"]); // these say when something is shown, not that it moves
let selected = null; // what the side panel describes: { type: "beat", id } or { type: "line", i }
let boxes = []; // what's on the detail timeline, for finding what a press landed on
const snapshotEdit = () => JSON.stringify(EDIT);
const refreshTimes = () => {
  applyEdit();
  voiceOut = voice.lines.map((l) => ({ ...l, s: fromSource(l.s), e: fromSource(l.e), words: l.words.map((w) => ({ ...w, s: fromSource(w.s), e: fromSource(w.e) })) }));
  overBg = null; dirty = true;
  stuck = findStuck();
  drawEditor();
  if (tools) drawTimelines();
};
const paceOf = (i) => {
  const l = voice.lines[i];
  if (!l || l.words.length < 4 || l.e <= l.s) return null;
  return (l.words.length / (l.e - l.s)) * 60 * (EDIT.voice.edits[i]?.speed ?? 1);
};
// Stretches where neither the camera nor anything in frame moves
const findStuck = () => {
  const out = [];
  SHOTS.forEach((s, i) => {
    if (s.pull || s.walk || s.pan) return;
    const a = s.t, b = shotEnd(i);
    const moves = Object.entries(EDIT.beats).filter(([id, m]) => m.kind === "motion" && (!HOLDS.has(id) || (id === "typing" && !s.hideMan))).map(([, m]) => [fromSource(m.at), fromSource(m.at + m.dur)]).filter(([x, y]) => y > a && x < b).sort((p, q) => p[0] - q[0]);
    let from = a;
    for (const [x, y] of moves) { if (x - from >= STILL) out.push([from, x]); from = Math.max(from, y); }
    if (b - from >= STILL) out.push([from, b]);
  });
  return out;
};
let stuck = [];
const wordNear = (out) => { let best = null, d = 1e9; for (const l of voiceOut) for (const w of l.words) { const e = Math.abs(w.s - out); if (e < d) { d = e; best = w; } } return { word: best, gap: d }; };
const line1 = (text) => { const d = document.createElement("div"); d.textContent = text; return d; };
const drawEditor = () => {
  const box = $("sel");
  box.replaceChildren();
  if (selected?.type === "beat") {
    const b = EDIT.beats[selected.id], out = fromSource(b.at);
    box.append(line1(b.title), line1(`${stamp(out)}, ngay chữ "${wordNear(out).word?.w ?? ""}"`));
  } else if (selected?.type === "line") {
    const i = selected.i, l = voice.lines[i], pace = paceOf(i), next = voice.lines[i + 1];
    box.append(line1(l.text), line1(`${pace ? `${Math.round(pace)} từ/phút, ` : ""}nghỉ sau câu ${(next ? next.s - l.e : 0).toFixed(2)} giây`));
  } else {
    const off = voice.lines.filter((_, i) => { const p = paceOf(i); return p && (p > FAST_WPM || p < SLOW_WPM); }).length;
    box.append(line1(`${off} câu lệch nhịp (tô màu), ${stuck.length} đoạn đứng yên quá ${STILL} giây (vạch đỏ)`), line1(`Zoom ${((EDIT.zoomRate ?? 0) * 100).toFixed(1)}% mỗi giây`));
  }
};
const boxAt = (e) => {
  const r = $("detail").getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
  // A fingertip covers more than these thin rows: take what's nearest within reach, and keep a cut's edge easy to catch
  const reach = e.pointerType === "touch" ? 9 : 0;
  let best = null, d = 1e9;
  for (const b of boxes) {
    const dx = Math.max(b.x0 - reach - x, 0, x - b.x1 - reach), dy = Math.max(b.y0 - reach - y, 0, y - b.y1 - reach);
    if (dx || dy) continue;
    const e2 = Math.abs(y - (b.y0 + b.y1) / 2) + (b.type === "line" || b.type === "gap" ? 20 : 0);
    if (e2 < d) { d = e2; best = b; }
  }
  return best;
};
// A press picks what the side panel describes and still scrubs: nothing on the timeline can be moved from here
$("detail").addEventListener("pointerdown", (e) => {
  const b = boxAt(e);
  selected = b?.type === "beat" ? { type: "beat", id: b.id } : b?.type === "line" || b?.type === "gap" ? { type: "line", i: b.i } : null;
  drawEditor();
});

// ---------- Timelines
const sized = (c) => {
  const r = c.getBoundingClientRect(), d = devicePixelRatio || 1;
  if (c.width !== Math.round(r.width * d) || c.height !== Math.round(r.height * d)) { c.width = Math.round(r.width * d); c.height = Math.round(r.height * d); }
  const g = c.getContext("2d");
  g.setTransform(d, 0, 0, d, 0, 0);
  return { g, w: r.width, h: r.height };
};
const SHADES = ["#1f2a2a", "#263434"];
const drawWave = (g, a, b, w, y, h) => {
  const { peaks, step } = voice;
  if (!peaks.length) return;
  g.fillStyle = "#6fa89a";
  for (let x = 0; x < w; x++) {
    const i0 = Math.floor(toSource(a + (x / w) * (b - a)) / step), i1 = Math.max(i0 + 1, Math.floor(toSource(a + ((x + 1) / w) * (b - a)) / step));
    let p = 0;
    for (let i = Math.max(0, i0); i < Math.min(peaks.length, i1); i++) if (peaks[i] > p) p = peaks[i];
    if (p > 0.012) { const d = p * h / 2; g.fillRect(x, y + h / 2 - d, 1, Math.max(1, d * 2)); }
  }
};
let overBg = null;
const drawOverview = () => {
  const c = $("over"), { g, w, h } = sized(c);
  if (!overBg || overBg.width !== c.width) {
    overBg = document.createElement("canvas"); overBg.width = c.width; overBg.height = c.height;
    const b = overBg.getContext("2d"), d = c.width / w;
    b.scale(d, d);
    SHOTS.forEach((s, i) => { b.fillStyle = SHADES[i % 2]; b.fillRect((s.t / DURATION) * w, 0, (shotEnd(i) - s.t) / DURATION * w + 1, h); });
    drawWave(b, 0, DURATION, w, 2, h - 4);
  }
  g.drawImage(overBg, 0, 0, w, h);
  for (const n of notes) if (!n.done) { g.fillStyle = "#ffd23e"; g.fillRect((noteAt(n) / DURATION) * w - 1, 0, 3, h); }
  const a = viewCentre() - span / 2;
  g.fillStyle = "rgba(255,255,255,.1)"; g.fillRect((a / DURATION) * w, 0, (span / DURATION) * w, h);
  g.fillStyle = "#ff6a3a"; g.fillRect((t / DURATION) * w - 1, 0, 2, h);
};
let span = Number(sessionStorage.getItem("span")) || (PHONE ? 14 : 30), frozenCentre = null;
const viewCentre = () => {
  const c = frozenCentre ?? t;
  return span >= DURATION ? DURATION / 2 : Math.max(span / 2, Math.min(DURATION - span / 2, c));
};
const drawDetail = () => {
  const { g, w, h } = sized($("detail"));
  const a = viewCentre() - span / 2, b = a + span;
  const X = (s) => ((s - a) / span) * w;
  g.fillStyle = "#0e1111"; g.fillRect(0, 0, w, h);
  // Shots
  g.font = "12px Consolas"; g.textBaseline = "middle";
  SHOTS.forEach((s, i) => {
    const e = shotEnd(i);
    if (e < a || s.t > b) return;
    const x0 = Math.max(0, X(s.t)), x1 = Math.min(w, X(e));
    g.fillStyle = i === shotIndex(t) ? "#39504c" : SHADES[i % 2];
    g.fillRect(x0, 0, x1 - x0 - 1, 20);
    g.save(); g.beginPath(); g.rect(x0, 0, x1 - x0 - 3, 20); g.clip();
    g.fillStyle = "#cfd8d4"; g.fillText(`${i} ${comments[i] ?? ""}`, x0 + 4, 10);
    g.restore();
    g.fillStyle = "#3e4a48"; g.fillRect(X(s.t), 20, 1, h - 20);
  });
  boxes = [];
  SHOTS.forEach((s, i) => { if (i && s.t >= a && s.t <= b) boxes.push({ type: "cut", i, x0: X(s.t) - 4, x1: X(s.t) + 4, y0: 0, y1: 20 }); });
  // Stuck stretches
  g.fillStyle = "#e0453a";
  for (const [x, y] of stuck) if (y > a && x < b) g.fillRect(X(x), 18, X(y) - X(x), 3);
  // Voice: each sentence's pace behind the wave, the pauses between them can be dragged
  voiceOut.forEach((l, i) => {
    const n = voiceOut[i + 1];
    if (n && n.s > a && l.e < b && X(n.s) - X(l.e) > 4) boxes.push({ type: "gap", i, x0: X(l.e), x1: X(n.s), y0: 22, y1: 66 });
    if (l.e < a || l.s > b) return;
    const pace = paceOf(i), on = selected?.type === "line" && selected.i === i;
    g.fillStyle = on ? "#3b4a33" : pace > FAST_WPM ? "#4a2022" : pace && pace < SLOW_WPM ? "#1e2e4c" : "#161b1b";
    g.fillRect(X(l.s), 22, X(l.e) - X(l.s), 44);
    boxes.push({ type: "line", i, x0: X(l.s), x1: X(l.e), y0: 22, y1: 66 });
    if (EDIT.voice.edits[i]) { g.fillStyle = "#ffd23e"; g.fillRect(X(l.s), 22, X(l.e) - X(l.s), 2); }
  });
  drawWave(g, a, b, w, 22, 44);
  // Actions and sounds, as blocks to drag onto a word
  const lanes = { motion: [-1e9, -1e9, -1e9], sound: [-1e9, -1e9] }, BASE = { motion: 90, sound: 132 };
  g.font = "11px Segoe UI,Arial";
  for (const [id, m] of Object.entries(EDIT.beats).sort((p, q) => p[1].at - q[1].at)) {
    const o0 = fromSource(m.at), o1 = fromSource(m.at + m.dur);
    if (o1 < a || o0 > b) continue;
    const row = lanes[m.kind], x0 = X(o0), x1 = Math.max(x0 + 10, X(o1));
    let lane = row.findIndex((end) => x0 >= end + 2);
    if (lane < 0) lane = 0;
    const label = HOLDS.has(id) ? x0 + 6 : x1;
    row[lane] = Math.max(x1, x0 + (m.title.length * 5.6 + 8));
    const y = BASE[m.kind] + lane * 14, on = selected?.type === "beat" && selected.id === id;
    g.fillStyle = m.kind === "sound" ? "#6d4f8d" : HOLDS.has(id) ? "#37503f" : m.curve === "snap" ? "#b5642f" : "#3f6786";
    g.fillRect(x0, y, x1 - x0, 13);
    if (on) { g.strokeStyle = "#ffd23e"; g.lineWidth = 2; g.strokeRect(x0 + 1, y + 1, x1 - x0 - 2, 11); }
    g.fillStyle = "#eef1ef"; g.fillText(m.title, x0 + 3, y + 7);
    g.fillStyle = "#ffd23e";
    for (const [off] of m.sounds) if (m.kind === "motion") g.fillRect(X(fromSource(m.at + off)), y + 10, 2, 3);
    boxes.unshift({ type: "beat", id, x0, x1: Math.min(x1, label + 60), y0: y, y1: y + 13 });
  }
  if (groupName) { g.fillStyle = "#d7a24a"; for (const c of group().cues) { const o = fromSource(c.at); if (o >= a && o <= b) g.fillRect(X(o), 160, 1, 4); } }
  // Words, as many as fit
  g.font = "12px Segoe UI,Arial"; g.fillStyle = "#e6e2c8";
  let right = -1;
  for (const l of voiceOut) {
    if (l.e < a || l.s > b) continue;
    for (const word of l.words) {
      const x = X(word.s);
      if (x < -40 || x > w) continue;
      const wd = g.measureText(word.w).width;
      if (x <= right + 3) continue;
      g.fillStyle = t >= word.s && t <= word.e ? "#ffd23e" : "#d9d5bd";
      g.fillText(word.w, x, 77);
      right = x + wd;
    }
  }
  if (!voice.lines.length) { g.fillStyle = "#68726f"; g.fillText("đang nghe giọng đọc để hiện lời thoại...", 8, 77); }
  // Seconds
  g.fillStyle = "#68726f"; g.font = "10px Consolas";
  const tick = [1, 2, 5, 10, 30, 60].find((n) => (n / span) * w >= 56) ?? 60; // room for its label, whatever the screen
  for (let s = Math.ceil(a / tick) * tick; s <= b; s += tick) { g.fillRect(X(s), h - 5, 1, 5); g.fillText(`${pad(Math.floor(s / 60))}:${pad(s % 60)}`, X(s) + 3, h - 7); }
  // Notes, playhead
  for (const n of notes) if (n.t >= a && n.t <= b) { const x = X(n.t); g.fillStyle = n.done ? "#57656a" : "#ffd23e"; g.beginPath(); g.moveTo(x - 5, 21); g.lineTo(x + 5, 21); g.lineTo(x, 30); g.fill(); g.fillRect(x, 21, 1, h - 21); }
  g.fillStyle = "#ff6a3a"; g.fillRect(X(t) - 1, 0, 2, h);
};
const drawTimelines = () => { drawOverview(); drawDetail(); };
new ResizeObserver(() => { overBg = null; drawTimelines(); }).observe($("ctl"));

const scrub = (c, toTime) => {
  c.addEventListener("pointerdown", (e) => {
    c.setPointerCapture(e.pointerId);
    dragging = { resume: playing };
    if (playing) setPlaying(false);
    if (c === $("detail")) frozenCentre = viewCentre();
    seek(toTime(e));
  });
  c.addEventListener("pointermove", (e) => { if (dragging) seek(toTime(e)); });
  const up = () => { if (!dragging) return; const r = dragging.resume; dragging = null; frozenCentre = null; dirty = true; if (r) setPlaying(true); };
  c.addEventListener("pointerup", up);
  c.addEventListener("pointercancel", up);
};
scrub($("over"), (e) => { const r = $("over").getBoundingClientRect(); return ((e.clientX - r.left) / r.width) * DURATION; });
scrub($("detail"), (e) => { const r = $("detail").getBoundingClientRect(); return viewCentre() - span / 2 + ((e.clientX - r.left) / r.width) * span; });
$("detail").addEventListener("wheel", (e) => { e.preventDefault(); span = Math.max(6, Math.min(DURATION, span * (e.deltaY > 0 ? 1.2 : 1 / 1.2))); sessionStorage.setItem("span", span); drawTimelines(); }, { passive: false });
$("over").title = "Bấm hoặc kéo để tua cả phim";
$("detail").title = "Kéo để tua, lăn chuột để phóng to";

// ---------- Free camera, held like a camera: turning stays where you stand, because orbiting a target leaves these small rooms at once
const camDir = new THREE.Vector3(), camRight = new THREE.Vector3(), camUp = new THREE.Vector3(), sph = new THREE.Spherical();
const turnAbout = (centre, moving, dx, dy) => {
  // Swing `moving` around `centre`
  camDir.copy(moving).sub(centre);
  sph.setFromVector3(camDir);
  sph.theta += dx; sph.phi = Math.max(0.03, Math.min(Math.PI - 0.03, sph.phi + dy));
  camDir.setFromSpherical(sph);
  moving.copy(centre).add(camDir);
};
const camAxes = () => { const f = tools.free; camDir.copy(f.l).sub(f.p).normalize(); camRight.crossVectors(camDir, THREE.Object3D.DEFAULT_UP).normalize(); camUp.crossVectors(camRight, camDir); };
const moveCam = (forward, right, up) => { const f = tools.free; camAxes(); const d = new THREE.Vector3().addScaledVector(camDir, forward).addScaledVector(camRight, right).addScaledVector(camUp, up); f.p.add(d); f.l.add(d); dirty = true; };
let camDrag = null;
canvas.addEventListener("pointerdown", (e) => {
  if (!tools?.free.on) return;
  canvas.setPointerCapture(e.pointerId);
  camDrag = { x: e.clientX, y: e.clientY, mode: e.button !== 0 ? "slide" : e.shiftKey ? "orbit" : "look" };
});
canvas.addEventListener("pointermove", (e) => {
  if (!camDrag) return;
  const f = tools.free, dx = e.clientX - camDrag.x, dy = e.clientY - camDrag.y;
  camDrag.x = e.clientX; camDrag.y = e.clientY;
  if (camDrag.mode === "look") turnAbout(f.p, f.l, -dx * 0.0025, dy * 0.0025);
  else if (camDrag.mode === "orbit") turnAbout(f.l, f.p, -dx * 0.005, -dy * 0.005);
  else { const s = f.p.distanceTo(f.l) * 0.0012; moveCam(0, -dx * s, dy * s); }
  dirty = true;
});
addEventListener("pointerup", () => { camDrag = null; });
canvas.addEventListener("contextmenu", (e) => e.preventDefault());
canvas.addEventListener("wheel", (e) => { if (!tools?.free.on) return; e.preventDefault(); moveCam((e.deltaY > 0 ? -1 : 1) * (e.shiftKey ? 0.03 : 0.12), 0, 0); }, { passive: false });
const setFree = (on) => {
  const f = tools.free;
  if (on) { f.p.copy(tools.camera.position); f.l.copy(tools.look); f.fov = tools.camera.fov; }
  f.on = on;
  canvas.classList.toggle("free", on);
  $("bFree").style.display = on ? "block" : "none";
  $("freeB").classList.toggle("on", on);
  dirty = true;
};
const setFov = (d) => { if (!tools.free.on) return; tools.free.fov = Math.max(8, Math.min(100, tools.free.fov + d)); dirty = true; flash(`ống kính ${tools.free.fov}`); };
const copyCam = () => { const c = camLine(); const s = `${stamp(t)} shot ${c.shot}: ${c.line}${c.warn ? ` (${c.warn})` : ""}`; navigator.clipboard?.writeText(s); flash("đã chép góc máy"); return s; };

// ---------- Final look of one frame, on demand
const drawFinal = () => {
  Object.assign(finalRender.tools.free, { on: tools.free.on, fov: tools.free.fov });
  finalRender.tools.free.p.copy(tools.free.p); finalRender.tools.free.l.copy(tools.free.l);
  finalRender(t);
  finalAt = t;
  $("final").style.display = "block";
};
const setFinal = async (on) => {
  finalOn = on;
  $("finalB").classList.toggle("on", on);
  $("bFinal").style.display = on ? "block" : "none";
  if (!on) { $("final").style.display = "none"; return; }
  if (playing) setPlaying(false);
  if (!finalRender) {
    $("load").textContent = "đang dựng bản final (khoảng 10 giây, chỉ lần đầu)...";
    finalRender = await buildScene($("final"), 1920, 1080, false);
    $("load").textContent = "";
  }
  finalAt = -1;
  dirty = true;
};

// ---------- Trying sounds: these hits aren't in the live mix, they are played from here, so a switch is heard on the very next hit
const ctx = new AudioContext();
const master = ctx.createGain();
master.connect(ctx.destination);
let trials = {}, groupName = null, picked = JSON.parse(sessionStorage.getItem("picked") || "{}"), sounding = [], anchor = null;
const group = () => trials[groupName];
const pickOf = (name) => picked[name] ?? { set: trials[name].chosen?.set ?? "old", gain: trials[name].chosen?.gain ?? 1 };
const optionOf = (name) => trials[name].options.find((o) => o.id === pickOf(name).set) ?? trials[name].options[0];
const silence = () => { for (const s of sounding) { try { s.stop(); } catch {} } sounding = []; anchor = null; };
const playHit = (name, cue, when, speed) => {
  const o = optionOf(name), buf = o.buffers?.[cue.pick % o.buffers.length];
  if (!buf) return;
  const src = ctx.createBufferSource(), g = ctx.createGain();
  src.buffer = buf;
  src.playbackRate.value = (o.plain ? 1 : cue.rate) * speed;
  g.gain.value = o.level * o.scale * (o.plain ? 1 : cue.gain) * pickOf(name).gain;
  src.connect(g).connect(master);
  src.onended = () => { sounding = sounding.filter((s) => s !== src); };
  src.start(when);
  sounding.push(src);
  window.__hits = { n: (window.__hits?.n ?? 0) + 1, set: o.id, at: cue.at, late: +(cue.at - (audio.currentTime + (when - ctx.currentTime) * audio.playbackRate)).toFixed(4) };
};
const soundFiles = {};
const loadSounds = async () => {
  const names = new Set(Object.values(EDIT.beats).flatMap((b) => b.sounds.map((s) => s[1])));
  await Promise.all([...names].map(async (n) => {
    const buf = await ctx.decodeAudioData(await (await getFile(`/agent/sfx2/${n}.wav`)).arrayBuffer());
    let peak = 1e-6;
    for (const v of buf.getChannelData(0)) if (Math.abs(v) > peak) peak = Math.abs(v);
    soundFiles[n] = { buf, scale: 0.9 / peak };
  }));
};
const playSound = (name, v, when, speed) => {
  const f = soundFiles[name];
  if (!f) return;
  const src = ctx.createBufferSource(), g = ctx.createGain();
  src.buffer = f.buf; src.playbackRate.value = speed;
  g.gain.value = v * f.scale;
  src.connect(g).connect(master);
  src.onended = () => { sounding = sounding.filter((s) => s !== src); };
  src.start(when);
  sounding.push(src);
  window.__sounds = (window.__sounds ?? 0) + 1;
};
const scheduleHits = () => {
  master.gain.value = audio.muted ? 0 : 1;
  if (!playing || audio.paused || audio.readyState < 3) { if (anchor) silence(); return; }
  const now = audio.currentTime, speed = audio.playbackRate, base = ctx.currentTime - now / speed;
  // A seek shows up as a jump in the sound's clock; small wobble in that clock is ignored, so the rhythm of the presses stays even
  if (!anchor || anchor.speed !== speed || Math.abs(anchor.base - base) > 0.05) { silence(); anchor = { base, speed, from: now }; }
  const until = now + 0.25 * speed;
  const due = (at) => at >= anchor.from && at < until && at > now - 0.1;
  const when = (at) => Math.max(ctx.currentTime, anchor.base + at / speed);
  for (const name in trials) for (const c of trials[name].cues) { const at = Math.round(fromSource(c.at) * FPS) / FPS; if (due(at)) playHit(name, c, when(at), speed); }
  // Every other sound in the film: the live mix leaves them out too, so moving one is heard at once
  for (const b of Object.values(EDIT.beats)) for (const [off, name, v] of b.sounds) { const at = Math.round(fromSource(b.at + off) * FPS) / FPS; if (due(at)) playSound(name, v, when(at), speed); }
  anchor.from = until;
};
setInterval(scheduleHits, 50);
const drawTrial = () => {
  const name = groupName;
  $("trial").style.display = name ? "block" : "none";
  if (!name) return;
  const p = pickOf(name), chosen = trials[name].chosen;
  $("trialOpts").replaceChildren(...trials[name].options.map((o, i) => {
    const b = document.createElement("button");
    b.textContent = `${i} ${o.title}`;
    b.className = `${o.id === p.set ? "on" : ""} ${o.id === chosen?.set ? "chosen" : ""}`;
    b.title = o.source ?? "";
    b.onclick = () => chooseOption(i);
    return b;
  }));
  $("trialGain").value = p.gain;
  $("trialGainText").textContent = `${Math.round(p.gain * 100)}%`;
};
const setPicked = (change) => {
  picked[groupName] = { ...pickOf(groupName), ...change };
  sessionStorage.setItem("picked", JSON.stringify(picked));
  if (anchor) { silence(); scheduleHits(); }
  drawTrial();
};
const chooseOption = (i) => {
  const o = group()?.options[i];
  if (!o) return;
  ctx.resume();
  setPicked({ set: o.id });
  if (!playing) playHit(groupName, group().cues[Math.floor(Math.random() * group().cues.length)], ctx.currentTime, 1); // paused: still say what it sounds like
};
const loadTrials = async () => {
  const r = await getFile("/trials.json");
  if (!r.ok) return;
  trials = await r.json();
  groupName = trials[groupName] ? groupName : Object.keys(trials)[0] ?? null;
  $("trialGroup").replaceChildren(...Object.keys(trials).map((k) => { const o = document.createElement("option"); o.value = k; o.textContent = trials[k].title; return o; }));
  $("trialGroup").value = groupName;
  drawTrial();
  for (const name in trials) for (const o of trials[name].options) o.buffers = await Promise.all(o.files.map(async (f) => ctx.decodeAudioData(await (await getFile(f)).arrayBuffer())));
};
$("pNote").onclick = () => openNote(null);
$("pBack5").onclick = () => seek(t - 5);
$("pFwd5").onclick = () => seek(t + 5);
$("pBack").onclick = () => seek(t - 1 / FPS);
$("pFwd").onclick = () => seek(t + 1 / FPS);
const zoomSpan = (k) => { span = Math.max(6, Math.min(DURATION, span * k)); sessionStorage.setItem("span", span); drawTimelines(); };
$("pIn").onclick = () => zoomSpan(1 / 1.5);
$("pOut").onclick = () => zoomSpan(1.5);
$("trialGroup").onchange = () => { groupName = $("trialGroup").value; drawTrial(); dirty = true; };
$("trialGain").oninput = () => setPicked({ gain: Number($("trialGain").value) });
$("trialGo").onclick = () => {
  const cues = group().cues, next = cues.find((c) => c.at > t + 0.7) ?? cues[0];
  ctx.resume();
  seek(next.at - 0.6);
  if (!playing) setPlaying(true);
};
$("trialPick").onclick = async () => {
  const p = pickOf(groupName);
  await jsonPost("/choose", { group: groupName, ...p });
  group().chosen = p;
  drawTrial();
  flash(`đã chốt ${optionOf(groupName).title}, bản render sau sẽ dùng, hình không phải render lại`);
};

// ---------- Main loop
async function main() {
  $("load").textContent = "đang dựng căn phòng...";
  fit();
  setEdit(await (await getFile("/edit.json")).json()); // fresher than the bundle: saving the edit doesn't rebuild it
  applyEdit();
  comments = await (await getFile("/shots.json")).json();
  const t0 = performance.now();
  // A phone gets fewer pixels to draw; clicks and pins are in fractions of the picture, so nothing else notices
  if (PHONE) { canvas.width = 640; canvas.height = 360; }
  const timeline = Promise.all([loadNotes(), loadVoice()]); // the words and notes don't wait for the room
  try {
    render = await buildScene(canvas, PHONE ? 640 : 960, PHONE ? 360 : 540, true);
  } catch (e) {
    // A file lost on a bad line: start again, the browser keeps the ones that arrived. Giving up has to say which file
    const tries = Number(sessionStorage.getItem("loadTries")) || 0;
    if (tries < 3) {
      sessionStorage.setItem("loadTries", tries + 1);
      $("load").textContent = `mạng chập chờn, tải lại lần ${tries + 1}...`;
      // Only once the line is back: reloading into no network would leave the browser's own error page
      for (;;) { await new Promise((done) => setTimeout(done, 1500)); try { if ((await fetch("/edit.json")).ok) break; } catch {} }
      location.reload();
      return;
    }
    sessionStorage.removeItem("loadTries");
    throw new Error(`Không tải được ${failedFile || "căn phòng"}. Kiểm tra mạng rồi tải lại trang.`);
  }
  sessionStorage.removeItem("loadTries");
  if (PHONE) loadPhoneMix();
  tools = render.tools;
  $("load").textContent = "";
  flash(`dựng xong trong ${((performance.now() - t0) / 1000).toFixed(1)}s`);
  const extras = Promise.all([timeline, loadTrials(), loadSounds()]).then(() => { refreshTimes(); dirty = true; });
  refreshTimes();
  seek(t);
  const warm = SHOTS.map((_, i) => i).sort((a, b) => Math.abs(SHOTS[a].t - t) - Math.abs(SHOTS[b].t - t));
  const loop = () => {
    if (playing) {
      // Sound is the clock, so picture and voice can't drift; slow frames are skipped, never delayed
      // A stalled sound holds the picture: running on would mean jumping back when the sound catches up. Only no sound at all lets the clock run
      const rate = audio.playbackRate;
      if (!audio.paused && audio.readyState > 2) { t = audio.currentTime; clockStart = performance.now() - (t * 1000) / rate; }
      else if (!audio.src || audio.error) t = ((performance.now() - clockStart) / 1000) * rate;
      else clockStart = performance.now() - (t * 1000) / rate;
      if (t >= DURATION - 0.02) { t = DURATION - 0.02; setPlaying(false); }
      if (looping) { const i = shotIndex(window.__loopFrom ?? t); if (t >= shotEnd(i) - 0.02) { seek(SHOTS[i].t); } }
      dirty = true;
    }
    if (dirty) {
      dirty = false;
      const a = performance.now();
      render(t);
      lastDraw = performance.now() - a;
      drawMs = drawMs * 0.9 + lastDraw * 0.1;
      frames++;
      const i = shotIndex(t);
      $("clock").textContent = stamp(t);
      $("shot").textContent = `shot ${i}: ${comments[i] ?? ""}`;
      const line = lineAt(t);
      $("caption").innerHTML = "";
      if (line) { const s = document.createElement("span"); s.textContent = line.text; $("caption").append(s); }
      drawTimelines();
      drawPins();
      if (finalOn && finalRender) {
        if (playing || dragging) $("final").style.display = "none";
        else if (finalAt !== t) drawFinal();
      }
      followNotes();
      sessionStorage.setItem("t", t);
      window.__live = { t, shot: i, drawMs };
      window.__editor ??= { boxes: () => boxes, seek, duration: () => DURATION, clear: () => { selected = null; drawEditor(); }, words: () => voice.lines.flatMap((l) => l.words.map((w) => w.s)) };
    }
    else if (warm.length) {
      // While nothing is asked of it: touch one more shot, nearest first, so its shaders and textures are ready before the
      // first jump there. The current frame is redrawn in the same task, so the screen never shows the detour.
      render(SHOTS[warm.shift()].t + 0.1);
      render(t);
    }
    const now = performance.now();
    if (now - fpsAt > 500) { fps = (frames * 1000) / (now - fpsAt); frames = 0; fpsAt = now; $("perf").textContent = `${playing ? fps.toFixed(0) + " fps, " : ""}${drawMs.toFixed(0)} ms/frame`; }
    // A page in the background gets no animation frames, and the sound would carry on without the picture
    if (document.hidden) setTimeout(loop, 100); else requestAnimationFrame(loop);
  };
  loop();
  extras.then(() => { restoreDraft(); window.__readyAt = Date.now(); });
}
const loadVoice = async () => { const r = await getFile("/voice_map.json"); if (r.ok) { voice = await r.json(); refreshTimes(); } };

// ---------- Clicking the picture
let downAt = null;
canvas.addEventListener("pointerdown", (e) => { downAt = [e.clientX, e.clientY]; });
// On click, not pointerup: a phone only lets the note box take focus and raise its keyboard from a click
canvas.addEventListener("click", (e) => {
  if (!downAt || e.button !== 0 || !render) return;
  const moved = Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]);
  downAt = null;
  if (moved > 4) return; // that was the free camera being dragged
  const r = canvas.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
  if (playing) setPlaying(false);
  render(t);
  openNote({ x: +x.toFixed(4), y: +y.toFixed(4), ...lookAtClick(x, y) });
});

// ---------- Buttons and keys
$("play").onclick = () => { setPlaying(!playing); if (!playing && reloadWaiting) { sessionStorage.setItem("t", t); location.reload(); } };
$("prev").onclick = () => jump(-1);
$("next").onclick = () => jump(1);
$("freeB").onclick = () => setFree(!tools.free.on);
$("camB").onclick = () => copyCam();
$("finalB").onclick = () => setFinal(!finalOn);
const setLoop = (on) => { looping = on; window.__loopFrom = on ? t : undefined; $("loopB").classList.toggle("on", on); $("bLoop").style.display = on ? "block" : "none"; };
$("loopB").onclick = () => setLoop(!looping);
const toggleMute = () => { audio.muted = !audio.muted; $("muteB").classList.toggle("on", audio.muted); };
$("muteB").onclick = toggleMute;
$("rate").onchange = () => { audio.playbackRate = Number($("rate").value); };
$("copyAll").onclick = () => { navigator.clipboard?.writeText(notes.filter((n) => !n.done).sort((a, b) => a.t - b.t).map((n) => `${whereText(n)}: ${n.text}`).join("\n")); flash("đã chép hết"); };
const jump = (d) => { const i = shotIndex(t); seek(d < 0 && t - SHOTS[i].t > 0.4 ? SHOTS[i].t : SHOTS[Math.max(0, Math.min(SHOTS.length - 1, i + d))].t); };
$("noteSave").onclick = () => saveNote();
$("noteCancel").onclick = () => cancelNote();
// A phone keyboard doesn't report which key it pressed: Enter only shows up as a line break arriving
text.addEventListener("beforeinput", (e) => { if (PHONE && e.inputType === "insertLineBreak") { e.preventDefault(); saveNote(); } });
flushNotes();
text.addEventListener("input", keepDraft);
text.addEventListener("keydown", (e) => {
  e.stopPropagation();
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); saveNote(); }
  else if (e.key === "Escape") { e.preventDefault(); cancelNote(); }
});
$("tabOpen").onclick = () => showTab("open");
$("tabHist").onclick = () => showTab("history");
$("moreB").onclick = () => { const open = $("more").classList.toggle("open"); $("moreB").classList.toggle("on", open); if (open && PHONE) scrollTo(0, 0); };
// A button keeps the keyboard's focus after a click, and Space would then press it on top of playing
$("row").addEventListener("click", (e) => e.target.blur?.());
addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key;
  if (k === " ") { setPlaying(!playing); }
  else if (k === "ArrowLeft") seek(t - (e.shiftKey ? 5 : 1 / FPS));
  else if (k === "ArrowRight") seek(t + (e.shiftKey ? 5 : 1 / FPS));
  else if (k === "[") jump(-1);
  else if (k === "]") jump(1);
  else if (k === "n" || k === "N" || k === "c") openNote(null);
  else if (k === "f" || k === "F") setFree(!tools.free.on);
  else if (k === "k" || k === "K") copyCam();
  else if (k === "g" || k === "G") setFinal(!finalOn);
  else if (k === "l" || k === "L") setLoop(!looping);
  else if (k === "m" || k === "M") toggleMute();
  else if (k === "-") setFov(2);
  else if (k === "=") setFov(-2);
  else if (k >= "0" && k <= "9") chooseOption(Number(k));
  else if (tools?.free.on && "wasdqeWASDQE".includes(k)) { const s = e.shiftKey ? 0.15 : 0.04, K = k.toLowerCase(); moveCam(K === "w" ? s : K === "s" ? -s : 0, K === "d" ? s : K === "a" ? -s : 0, K === "e" ? s : K === "q" ? -s : 0); }
  else return;
  e.preventDefault();
});

const events = new EventSource("/events");
// A code change waits for a note being spoken: reloading now would throw the words away
events.addEventListener("code", () => { if (compose || playing) { reloadWaiting = true; flash("code đổi, sẽ tải lại khi dừng"); return; } sessionStorage.setItem("t", t); location.reload(); });
events.addEventListener("error-build", (e) => showError(JSON.parse(e.data)));
events.addEventListener("sound-start", () => { flash("đang trộn tiếng..."); });
events.addEventListener("sound", () => { loadMix(); loadTrials(); flash("tiếng đã cập nhật"); });
events.addEventListener("notes", loadNotes);
events.addEventListener("voice", loadVoice);
events.addEventListener("edit", async () => { const fresh = await (await fetch("/edit.json")).json(); if (JSON.stringify(fresh) !== snapshotEdit()) { setEdit(fresh); refreshTimes(); } });
if (!PHONE) audio.src = MIX_URL; // on a phone line the room comes first, or the sound eats the bandwidth while the picture stays black
main();
