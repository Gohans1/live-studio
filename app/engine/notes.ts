// Notes: what's wrong where, said while watching. Nothing typed is lost: every keystroke is kept on the device, a note waits on
// the device until the server has it, × only moves a note aside with an undo, and the server writes the file atomically.
import { DURATION, SHOTS_OUT as SHOTS } from "film/scene";
import { EDIT, fromSource, toSource } from "film/edit";
import { toast } from "@/components/ui/toast";
import { FPS, getFile, PHONE, postJson, stamp, stored, wait } from "./env";
import { pinFade } from "./fade";
import { camLine, captionAt, drawPins, finalCanvas, render, seek, setPlaying } from "./player";
import { S } from "./state";
import { type Compose, get, type Note, type Pin, say, set, ui } from "./store";
import { shotEnd, shotIndex, wordNear } from "./timeline";

// A note remembers its place in the voice, so after voice edits it still finds its moment
export const noteAt = (n: Note) => (n.srcT != null ? fromSource(n.srcT) : n.t);
const whereText = (n: Note) => `${stamp(n.t)} | shot ${n.shot} (${n.shotName ?? ""})${n.pin ? ` | ${n.pin.what}` : ""}`;
export const openNotes = () => get().notes.filter((n) => !n.done).sort((a, b) => noteAt(a) - noteAt(b));
const lastFixAt = (n: Note) => n.fixes?.at(-1)?.at ?? n.at;
export const historyNotes = () => get().notes.filter((n) => n.done).sort((a, b) => (lastFixAt(a) < lastFixAt(b) ? 1 : -1));

// ---------- Pictures that go with a note: the frame with the pin, the area under it unmarked, and the seconds around it
// (a press during playback lands after what was being reacted to, and a note about a cut is about those seconds)
const shownAt = (x: number) => { render(x); return S.el.canvas; };
const snapshot = (pin: Pin | null | undefined, at: number) => {
  const c = document.createElement("canvas");
  c.width = 960; c.height = 540;
  const g = c.getContext("2d")!;
  g.drawImage(finalCanvas() ?? shownAt(at), 0, 0, 960, 540);
  if (pin) { g.strokeStyle = "#3AA99F"; g.lineWidth = 3; g.beginPath(); g.arc(pin.x * 960, pin.y * 540, 14, 0, 7); g.stroke(); g.strokeStyle = "#000"; g.lineWidth = 1; g.beginPath(); g.arc(pin.x * 960, pin.y * 540, 16, 0, 7); g.stroke(); }
  g.font = "bold 24px Consolas,monospace"; g.textAlign = "right"; g.fillStyle = "rgba(0,0,0,.7)"; g.fillRect(790, 8, 162, 34); g.fillStyle = "#fff"; g.fillText(stamp(at), 944, 33);
  return c.toDataURL("image/jpeg", 0.85);
};
const pinCrop = (pin: Pin) => {
  const from = finalCanvas() ?? S.el.canvas, side = Math.round(from.height * 0.34);
  const c = document.createElement("canvas");
  c.width = c.height = 480;
  c.getContext("2d")!.drawImage(from, pin.x * from.width - side / 2, pin.y * from.height - side / 2, side, side, 0, 0, 480, 480);
  return c.toDataURL("image/jpeg", 0.85);
};
const STRIP = [-2, -1, 0, 1];
const momentStrip = (at: number) => {
  const w = 400, h = 225, c = document.createElement("canvas");
  c.width = w * STRIP.length; c.height = h;
  const g = c.getContext("2d")!;
  g.font = "bold 20px Consolas,monospace";
  STRIP.forEach((d, i) => {
    const x = Math.min(Math.max(0, at + d), DURATION - 0.02);
    g.drawImage(shownAt(x), i * w, 0, w, h);
    g.fillStyle = "rgba(0,0,0,.7)"; g.fillRect(i * w + 4, 4, 128, 28);
    g.fillStyle = d === 0 ? "#3AA99F" : "#fff"; g.fillText(stamp(x), i * w + 8, 25);
    g.fillStyle = "#000"; g.fillRect(i * w, 0, 2, h);
  });
  return c.toDataURL("image/jpeg", 0.8);
};
// Everything around the moment, as the film stood when the note was written
const noteContext = (c: Compose) => {
  const { voiceOut } = S, audio = S.el.audio;
  const near = (from: number, to: number, within: number) => c.t >= from - within && c.t <= to + within;
  const here = voiceOut.findIndex((l) => c.t >= l.s && c.t <= l.e + 0.35);
  const after = voiceOut.findIndex((l) => l.s > c.t);
  const before = here >= 0 ? here - 1 : after > 0 ? after - 1 : after < 0 ? voiceOut.length - 1 : -1;
  const next = here >= 0 ? here + 1 : after;
  const all = voiceOut.flatMap((l) => l.words);
  const word = wordNear(c.t).word, wi = word ? all.indexOf(word) : -1;
  const beats = Object.entries(EDIT.beats).map(([id, b]) => ({ id, title: b.title, kind: b.kind, at: +fromSource(b.at).toFixed(3), dur: b.dur, sounds: b.sounds })).filter((b) => near(b.at, b.at + (b.dur ?? 0), 1.5));
  return {
    playing: !!c.wasPlaying, // pressed during playback: what it's about may be a moment earlier
    rate: audio.playbackRate,
    muted: audio.muted || undefined,
    volume: audio.volume !== 1 ? audio.volume : undefined,
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
    view: { phone: PHONE, lite: !!window.__assets?.includes("lite"), canvas: [S.el.canvas.width, S.el.canvas.height], screen: [innerWidth, innerHeight] },
  };
};

// ---------- Kept on the device until the server has it: a bad line delays a note, it never eats one
interface Outgoing { note: Note; img?: string | null; crop?: string | null; strip?: string | null }
type Op = { text?: string; remove?: boolean; restore?: boolean; done?: boolean };
let heldNotes: Outgoing[] | null = null, heldOps: Record<string, Op> | null = null;
// A queue spoilt on the device (cut short by a full disk, edited by hand) must not stop every later note from sending
const readQueue = <T,>(key: string, empty: T): T => { try { return JSON.parse(stored.get(key) ?? "null") ?? empty; } catch { return empty; } };
const unsent = (): Outgoing[] => heldNotes ?? readQueue("unsentNotes", []);
const keepUnsent = (list: Outgoing[]) => {
  // Storage full: the words matter more than the pictures, the main picture more than the extras. No storage at all: they wait in this page
  for (const slim of [(x: Outgoing) => x, (x: Outgoing) => ({ note: x.note, img: x.img }), (x: Outgoing) => ({ note: x.note })]) {
    if (stored.set("unsentNotes", JSON.stringify(list.map(slim)))) { heldNotes = null; return; }
  }
  heldNotes = list;
};
const unsentOps = (): Record<string, Op> => heldOps ?? readQueue("unsentEdits", {});
const keepOps = (all: Record<string, Op>) => { heldOps = stored.set("unsentEdits", JSON.stringify(all)) ? null : all; };
const queueOp = (id: string, op: Op) => keepOps({ ...unsentOps(), [id]: op });

let flushing = false;
export const flushNotes = async () => {
  if (flushing) return;
  flushing = true;
  for (let list = unsent(), ops = Object.entries(unsentOps()); list.length || ops.length; list = unsent(), ops = Object.entries(unsentOps())) {
    set({ saved: "busy" });
    try {
      if (list.length) {
        const r = await postJson("/api/notes", list[0]);
        if (!r.ok) throw new Error(String(r.status));
        keepUnsent(unsent().filter((x) => x.note.id !== list[0].note.id));
      } else {
        const [id, op] = ops[0];
        const r = await postJson(`/api/notes/${id}`, op);
        if (!r.ok) throw new Error(String(r.status));
        const now = unsentOps();
        if (JSON.stringify(now[id]) === JSON.stringify(op)) { delete now[id]; keepOps(now); }
      }
    } catch {
      set({ saved: "fail" });
      await wait(3000);
    }
  }
  flushing = false;
  set({ saved: null });
};

const changed = (notes: Note[]) => { set({ notes }); S.dirty = true; };
export const loadNotes = async () => {
  const have: Note[] = await (await getFile("/api/notes")).json();
  const ops = unsentOps(), mine = get().notes;
  const back = mine.filter((n) => ops[n.id]?.restore && !have.some((h) => h.id === n.id));
  const notes = [...have, ...unsent().map((x) => x.note).filter((n) => !have.some((h) => h.id === n.id)), ...back].filter((n) => !ops[n.id]?.remove);
  for (const n of notes) {
    if (typeof ops[n.id]?.text === "string") { n.text = ops[n.id].text!; n.done = false; }
    if (ops[n.id]?.done === false) n.done = false;
  }
  changed(notes);
  if (flushing) set({ saved: "busy" });
};

let editSend = 0;
const editNote = (id: string, words: string) => {
  const n = get().notes.find((x) => x.id === id);
  if (!n || !words || words === n.text) return;
  changed(get().notes.map((x) => (x.id === id ? { ...x, text: words, done: false } : x)));
  queueOp(id, { text: words });
  set({ saved: "busy" });
  clearTimeout(editSend);
  editSend = window.setTimeout(flushNotes, 400);
};
const showUndo = (title: string, undo: () => void) => {
  const id = toast.add({ title, timeout: 10000, actionProps: { children: "Hoàn tác", onClick: () => { toast.close(id); undo(); } } });
};

// ---------- Writing a note
// What's being typed is on the device from the first letter: a reload or a killed tab brings it back
export const setDraft = (words: string) => {
  set({ draft: words });
  const { compose } = get();
  if (compose && words.trim()) stored.set("noteDraft", JSON.stringify({ compose, words }));
  else stored.remove("noteDraft");
};
const openBox = (compose: Compose, words = "") => {
  set({ compose, settingsOpen: false });
  setDraft(words);
  drawPins();
  ui.focusNote();
};
export const openNote = (pin: Pin | null) => {
  const { compose, draft } = get();
  if (compose?.editing) { ui.focusNote(); return; } // an old note's box stays on that note until Xong or Hủy
  const wasPlaying = compose ? compose.wasPlaying : S.playing;
  // Words already written belong to the note they were written for: a new place starts a new note. On the same frame a click just moves the pin
  if (compose && draft.trim() && Math.abs(S.t - compose.t) > 0.01) { set({ compose: { ...compose, resume: false } }); saveNote(); }
  if (S.playing) setPlaying(false);
  render(S.t);
  const i = shotIndex(S.t);
  openBox({ t: S.t, shot: i, shotName: S.comments[i] ?? "", pin, resume: !!wasPlaying, wasPlaying, spoken: captionAt(S.t) ?? undefined }, get().draft);
};
export const restoreDraft = () => {
  let d: { compose: Compose; words: string } | null = null;
  try { d = JSON.parse(stored.get("noteDraft") ?? "null"); } catch {}
  if (!d?.words) return;
  seek(d.compose.t);
  openBox({ ...d.compose, resume: false }, d.words);
};
// An old note opens in the same box, with its words. Nothing is overwritten until Xong
export const editOldNote = (n: Note) => {
  const { compose, draft } = get();
  if (compose?.editing === n.id) { ui.focusNote(); return; }
  const wasPlaying = compose ? compose.resume : S.playing;
  if (compose && draft.trim()) { set({ compose: { ...compose, resume: false } }); saveNote(); } else if (compose) closeNote();
  if (S.playing) setPlaying(false);
  openBox({ t: S.t, shot: n.shot, shotName: n.shotName ?? "", pin: null, resume: wasPlaying, editing: n.id, time: stamp(noteAt(n)), original: n.text }, n.text);
};
export const closeNote = () => {
  const resume = get().compose?.resume;
  set({ compose: null });
  setDraft("");
  ui.blurNote();
  drawPins();
  if (resume) setPlaying(true);
};
// Hủy asks nothing: the words stay one press away in case it was a slip
export const cancelNote = () => {
  const { compose: was, draft: words } = get();
  if (!was) return;
  const lost = !!words.trim() && words.trim() !== (was.original ?? "");
  closeNote();
  if (lost) showUndo(was.editing ? `Đã bỏ chữ vừa sửa ở ${was.time}` : "Đã hủy ghi chú", () => {
    if (get().compose) { set({ compose: { ...get().compose!, resume: false } }); saveNote(); }
    if (S.playing) setPlaying(false);
    if (!was.editing) seek(was.t);
    openBox({ ...was, resume: false }, words);
  });
};
export const saveNote = () => {
  const { compose, draft, notes } = get();
  const body = draft.trim();
  if (!compose) return;
  if (compose.editing) {
    const id = compose.editing, was = notes.find((x) => x.id === id);
    if (!body || body === compose.original) { closeNote(); return; } // emptied gets its words back: × is what removes a note
    const before = compose.original!;
    if (was) editNote(id, body);
    else { queueOp(id, { restore: true, text: body }); flushNotes(); } // removed elsewhere meanwhile: these words still count
    const at = compose.time;
    closeNote();
    showUndo(`Đã ghi đè ghi chú ${at}`, () => editNote(id, before));
    return;
  }
  if (!body) { closeNote(); return; }
  const tools = S.tools!;
  const n: Note = {
    id: Date.now().toString(36), at: new Date().toISOString(), t: +compose.t.toFixed(3), time: stamp(compose.t), frame: Math.round(compose.t * FPS),
    shot: compose.shot, shotName: compose.shotName, srcT: +toSource(compose.t).toFixed(3), spoken: compose.spoken, pin: compose.pin, cam: camLine(),
    freeCam: tools.free.on || undefined, finalLook: get().final || undefined, context: noteContext(compose), text: body, done: false,
  };
  // The note's own frame in its picture, even if the film has moved on since. No picture is no reason to lose the words
  let img: string | null = null, crop: string | null = null, strip: string | null = null;
  try { strip = momentStrip(compose.t); } catch {}
  try { render(compose.t); img = snapshot(n.pin, compose.t); if (n.pin) crop = pinCrop(n.pin); } catch {}
  S.dirty = true;
  changed([...notes, n]);
  keepUnsent([...unsent(), { note: n, img, crop, strip }]);
  flushNotes();
  closeNote();
};

export const removeNote = (n: Note) => {
  const waiting = unsent().find((x) => x.note.id === n.id);
  if (waiting) keepUnsent(unsent().filter((x) => x.note.id !== n.id));
  changed(get().notes.filter((x) => x.id !== n.id));
  queueOp(n.id, { remove: true });
  flushNotes();
  if (get().compose?.editing === n.id) closeNote();
  showUndo(`Đã xóa ghi chú ${n.time}`, () => {
    changed([...get().notes, n]);
    queueOp(n.id, { restore: true, text: n.text });
    if (waiting) keepUnsent([...unsent(), waiting]);
    flushNotes();
  });
};
// History is a record: the way back is "Chưa ưng"
export const reopenNote = (n: Note) => {
  changed(get().notes.map((x) => (x.id === n.id ? { ...x, done: false } : x)));
  queueOp(n.id, { done: false });
  flushNotes();
  say(`ghi chú ${stamp(noteAt(n))} đã về Cần sửa`);
};
export const goToNote = (n: Note) => { if (S.playing) setPlaying(false); seek(noteAt(n)); };
export const copyAll = () => {
  navigator.clipboard?.writeText(openNotes().map((n) => `${whereText(n)}: ${n.text}`).join("\n"));
  say("đã chép hết");
};
// The note nearest the playhead, for the list to keep in view
export const followNotes = () => {
  let near: string | null = null, best = Infinity;
  for (const n of openNotes()) { const d = Math.abs(noteAt(n) - S.t); if (d < best) { best = d; near = n.id; } }
  if (near !== get().nearNote) set({ nearNote: near });
};
export const pinsHere = () => {
  if (S.tools?.free.on) return [];
  const rate = get().rate;
  return get().notes.flatMap((n) => {
    const fade = n.pin && !n.done && !n.freeCam ? pinFade(noteAt(n), S.t, rate) : 0;
    return fade > 0 ? [{ pin: n.pin!, text: n.text, fade }] : [];
  });
};

addEventListener("online", flushNotes);
document.addEventListener("visibilitychange", () => { if (!document.hidden) flushNotes(); });
