// The studio's player: the same scene as the render, drawn live, with the sound as the clock. Saving the film's code shows
// "Có bản mới" on the picture; the page reloads at the same second only when that is pressed.
import * as THREE from "three";
import * as FILM from "film/scene";
import { buildScene, DURATION, SHOTS_OUT as SHOTS } from "film/scene";
import { checkFilm, problems, Sections } from "../../src/contract.mjs";
import { onEvent, onHello } from "../events";
import { AWAY, FPS, getFile, MIX_URL, PHONE, postJson, stamp, stored, wait } from "./env";
import { flushNotes, followNotes, loadNotes, noteAt, openNote, pinsHere, restoreDraft } from "./notes";
import { audioCtx, followChips, loadSounds, loadTrials, optionRanges } from "./options";
import { type Elements, type Line, S } from "./state";
import { get, type Pin, say, set, showError } from "./store";
import { attachTimeline, drawTimelines, marks, refreshTimes, shotEnd, shotIndex } from "./timeline";
import { createFlight } from "./flight";

// ---------- Time
export const render = (x: number) => S.render?.(x);
// The mix can be shorter than the film: the film grew and its sound wasn't remixed yet. Past the mix's end the picture keeps
// its own clock, because playing a sound that has ended starts it over from 0, and the picture follows the sound
const pastMix = (audio: HTMLAudioElement) => Number.isFinite(audio.duration) && S.t >= audio.duration - 0.05;
// Every place that starts the sound goes through here. False: the picture is past the mix's end and plays on without it
const startSound = () => {
  const audio = S.el.audio;
  if (pastMix(audio)) { audio.pause(); return false; }
  audio.currentTime = S.t;
  audio.play().catch(() => {});
  return true;
};
export const seek = (x: number) => {
  S.t = Math.max(0, Math.min(DURATION - 0.01, Math.round(x * FPS) / FPS)); // whole frames, so a time said out loud is a frame that exists
  const audio = S.el.audio;
  if (audio.readyState > 0) audio.currentTime = S.t;
  if (S.playing && audio.paused && audio.readyState > 0) startSound(); // back inside the mix from past its end
  S.clockStart = performance.now() - S.t * 1000;
  S.dirty = true;
};
export const setPlaying = (p: boolean) => {
  S.playing = p;
  set({ playing: p });
  const audio = S.el.audio;
  if (p) { S.clockStart = performance.now() - S.t * 1000; if (!startSound()) say("tiếng ngắn hơn phim: từ đây chỉ có hình, chờ trộn lại tiếng"); audioCtx.resume(); }
  else { audio.pause(); seek(Math.round(S.t * FPS) / FPS); }
};
// The film's new code waits for the creator, who loads it with "Có bản mới" when it suits: an agent fixing notes saves code
// all through a review, and a reload on every stop broke the note being written next. Same second after; a draft comes back
export const reloadNow = () => { stored.set("t", String(S.t), sessionStorage); location.reload(); };
export const togglePlay = () => setPlaying(!S.playing);
export const step = (seconds: number) => seek(S.t + seconds);
export const jumpShot = (d: number) => { const i = shotIndex(S.t); seek(d < 0 && S.t - SHOTS[i].t > 0.4 ? SHOTS[i].t : SHOTS[Math.max(0, Math.min(SHOTS.length - 1, i + d))].t); };
export const setLoop = (on: boolean) => { window.__loopFrom = on ? S.t : undefined; set({ loop: on }); };
export const setRate = (r: number) => { const a = S.el.audio; a.defaultPlaybackRate = a.playbackRate = r; set({ rate: r }); };

// ---------- The sound's source
const setAudio = (url: string) => {
  const audio = S.el.audio;
  audio.src = url;
  audio.addEventListener("loadedmetadata", () => { if (S.playing) startSound(); else audio.currentTime = S.t; }, { once: true });
};
// A phone line can stall for seconds: the whole mix comes down once and then plays from memory, so nothing the line does can cut it
let mixLoad = 0, mixBlob = "";
const loadWholeMix = async () => {
  const mine = ++mixLoad;
  for (let tries = 0; mine === mixLoad; tries++) {
    try {
      const r = await fetch(MIX_URL);
      if (!r.ok || !r.body) throw new Error(String(r.status));
      const total = Number(r.headers.get("content-length")), reader = r.body.getReader(), parts: Uint8Array<ArrayBuffer>[] = [];
      for (let got = 0; ;) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value);
        got += value.length;
        if (total) say(`đang tải tiếng ${Math.round((got / total) * 100)}%`, 0);
      }
      if (mine !== mixLoad) return;
      URL.revokeObjectURL(mixBlob);
      mixBlob = URL.createObjectURL(new Blob(parts, { type: "audio/webm" }));
      setAudio(mixBlob);
      say("tiếng đã tải xong");
      return;
    } catch {
      say(`mạng chập chờn, tải lại tiếng lần ${tries + 1}…`, 0);
      await wait(2000);
    }
  }
};
const loadMix = () => { if (AWAY) loadWholeMix(); else setAudio(`${MIX_URL}?${Date.now()}`); };
// The browser can pause the sound by itself (a notification, autoplay rules) while the picture runs on: pick it up where the picture is
const keepSound = () => { const a = S.el?.audio; if (S.playing && a?.paused && a.readyState > 0) startSound(); };
setInterval(keepSound, 1000);
document.addEventListener("pointerdown", keepSound);

// Phones leave the level to their own buttons (iOS ignores a page setting it), so there the speaker only mutes.
// A level of 0 counts as muted, and unmuting goes back to the last level that was heard
let heardLevel = 1;
const showVolume = () => { const a = S.el.audio; set({ muted: a.muted, volume: a.volume }); stored.set("volume", String(heardLevel)); };
export const setVolume = (v: number) => {
  const a = S.el.audio;
  v = Math.max(0, Math.min(1, Math.round(v * 20) / 20));
  a.muted = v === 0;
  if (v) { a.volume = v; heardLevel = v; }
  showVolume();
};
export const toggleMute = () => { if (S.el.audio.muted) setVolume(heardLevel); else { S.el.audio.muted = true; showVolume(); } };
export const nudgeVolume = (up: boolean) => { const a = S.el.audio; setVolume((a.muted ? (up ? heardLevel - 0.1 : 0) : a.volume) + (up ? 0.1 : -0.1)); };

// ---------- Captions: one transcribed line can run to 95 words, so a caption is the piece being said now, cut where a reader would pause
const CAPTION_WORDS = 10;
const captionPieces = (words: Line["words"]) => {
  const pieces: Line["words"][] = [];
  let piece: Line["words"] = [];
  for (const word of words) {
    piece.push(word);
    if (/[.?!]["']?$/.test(word.w) || (/[,;:]$/.test(word.w) && piece.length >= 5) || piece.length >= CAPTION_WORDS) { pieces.push(piece); piece = []; }
  }
  if (piece.length) { if (piece.length < 3 && pieces.length) pieces.at(-1)!.push(...piece); else pieces.push(piece); }
  return pieces;
};
export const captionAt = (x: number) => {
  const line = S.voiceOut.find((l) => x >= l.s && x <= l.e + 0.35);
  if (!line) return null;
  if (!line.words.length) return line.text;
  line.pieces ??= captionPieces(line.words);
  const now = line.pieces.findLast((piece) => x >= piece[0].s) ?? line.pieces[0];
  return now.map((word) => word.w).join(" ");
};

// ---------- Saying what a click landed on
const ray = new THREE.Raycaster();
const BONE_PARTS: [RegExp, string][] = [[/Head|Neck/, "đầu"], [/Left.*Hand|LeftHand/, "bàn tay trái"], [/Right.*Hand|RightHand/, "bàn tay phải"], [/LeftFoot|LeftToe/, "bàn chân trái"], [/RightFoot|RightToe/, "bàn chân phải"], [/LeftForeArm|LeftArm|LeftShoulder/, "tay trái"], [/RightForeArm|RightArm|RightShoulder/, "tay phải"], [/LeftUpLeg|LeftLeg/, "chân trái"], [/RightUpLeg|RightLeg/, "chân phải"], [/Spine|Hips/, "thân"]];
const shown = (o: THREE.Object3D | null) => { for (let c = o; c; c = c.parent) if (!c.visible) return false; return true; };
const firstMaterial = (o: THREE.Object3D) => [(o as THREE.Mesh).material].flat()[0];
const whatIs = (hit: THREE.Intersection) => {
  const tools = S.tools!;
  let found: [THREE.Object3D, string] | null = null;
  for (let c: THREE.Object3D | null = hit.object; c && !found; c = c.parent) found = (tools.objects ?? []).find(([obj]) => obj === c) ?? null;
  if (found && found[0] === tools.rig && tools.bones) {
    let best = "", d = 1e9;
    const v = new THREE.Vector3();
    for (const n in tools.bones) { const e = tools.bones[n].getWorldPosition(v).distanceToSquared(hit.point); if (e < d) { d = e; best = n; } }
    const part = BONE_PARTS.find(([re]) => re.test(best))?.[1];
    return part ? `nhân vật, ${part}` : "nhân vật";
  }
  if (found) return found[1];
  const byMat = (tools.materials ?? []).find(([mat]) => mat === firstMaterial(hit.object));
  if (byMat) return byMat[1];
  const n = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : null;
  if (n && n.y > 0.7) return "mặt trên một vật";
  return hit.object.name || "vật không tên";
};
const lookAtClick = (x: number, y: number) => {
  const tools = S.tools!;
  ray.setFromCamera(new THREE.Vector2(x * 2 - 1, 1 - y * 2), tools.camera);
  const hit = ray.intersectObjects(tools.scene.children, true).find((h) => {
    if (!(h.object as THREE.Mesh).isMesh || !shown(h.object)) return false;
    const m = firstMaterial(h.object);
    return !(m.transparent && !m.depthWrite);
  });
  if (!hit) return { what: "khoảng trống" };
  return { what: whatIs(hit), world: hit.point.toArray().map((v) => +v.toFixed(3)) };
};

// ---------- The camera as a line: what makes this exact frame. A film whose camera lives in SHOTS (tools.zoomOf and
// tools.smoother) gets a SHOTS line with the shot's slow zoom and its head offset taken out; any other the camera in world terms
export const camLine = () => {
  const tools = S.tools!, cam = tools.camera, i = shotIndex(S.t), shot = SHOTS[i];
  const look = tools.free.on ? tools.free.l : tools.look;
  if (!tools.zoomOf || !tools.smoother) {
    const r = (v: THREE.Vector3) => v.toArray().map((x) => +x.toFixed(3));
    return { shot: i, line: `p: [${r(cam.position)}], l: [${r(look)}], fov: ${+cam.fov.toFixed(1)}`, world: { p: r(cam.position), l: r(look) } };
  }
  const u = (S.t - shot.t) / (shotEnd(i) - shot.t);
  const k = tools.zoomOf(i) * (tools.smoother(u) - 0.5);
  const off = new THREE.Vector3();
  if (shot.rel && tools.head) { off.copy(tools.head); if (shot.off) off.x += tools.CELL ?? 0; }
  const l = look.clone().sub(off);
  const p = cam.position.clone().addScaledVector(look, -k).divideScalar(1 - k).sub(off);
  const V = (v: THREE.Vector3) => `V(${v.x.toFixed(3)}, ${v.y.toFixed(3)}, ${v.z.toFixed(3)})`;
  const warn = [shot.pan && "shot này có pan", shot.follow && "shot này bám đầu", shot.walk && "shot này đi bộ"].filter(Boolean).join(", ");
  return { shot: i, line: `p: [${V(p)}, ${V(p)}], l: [${V(l)}, ${V(l)}], fov: ${+cam.fov.toFixed(1)}`, world: { p: cam.position.toArray().map((v) => +v.toFixed(3)), l: look.toArray().map((v) => +v.toFixed(3)) }, warn: warn || undefined };
};
export const copyCam = () => {
  const c = camLine(), s = `${stamp(S.t)} shot ${c.shot}: ${c.line}${c.warn ? ` (${c.warn})` : ""}`;
  navigator.clipboard?.writeText(s);
  say("đã chép góc máy");
};

// ---------- Free camera, held like a camera: turning stays where you stand, because orbiting a target leaves these small rooms at once
const camDir = new THREE.Vector3(), camRight = new THREE.Vector3(), camUp = new THREE.Vector3(), sph = new THREE.Spherical();
const turnAbout = (centre: THREE.Vector3, moving: THREE.Vector3, dx: number, dy: number) => {
  camDir.copy(moving).sub(centre);
  sph.setFromVector3(camDir);
  sph.theta += dx; sph.phi = Math.max(0.03, Math.min(Math.PI - 0.03, sph.phi + dy));
  camDir.setFromSpherical(sph);
  moving.copy(centre).add(camDir);
};
export const moveCam = (forward: number, right: number, up: number) => {
  const f = S.tools!.free;
  camDir.copy(f.l).sub(f.p).normalize(); camRight.crossVectors(camDir, THREE.Object3D.DEFAULT_UP).normalize(); camUp.crossVectors(camRight, camDir);
  const d = new THREE.Vector3().addScaledVector(camDir, forward).addScaledVector(camRight, right).addScaledVector(camUp, up);
  f.p.add(d); f.l.add(d);
  S.dirty = true;
};
export const setFree = (on: boolean) => {
  const tools = S.tools;
  if (!tools) return;
  const f = tools.free;
  if (on) { f.p.copy(tools.camera.position); f.l.copy(tools.look); f.fov = tools.camera.fov; }
  f.on = on;
  set({ free: on });
  S.dirty = true;
};
export const setFov = (d: number) => {
  const f = S.tools?.free;
  if (!f?.on) return;
  f.fov = Math.max(8, Math.min(100, f.fov + d));
  S.dirty = true;
  say(`ống kính ${f.fov}`);
};

// ---------- Final look of one frame, on demand
export const finalCanvas = () => (get().final && S.finalRender ? S.el.final : null);
const drawFinal = () => {
  const fr = S.finalRender!, free = S.tools!.free;
  Object.assign(fr.tools.free, { on: free.on, fov: free.fov });
  fr.tools.free.p.copy(free.p); fr.tools.free.l.copy(free.l);
  fr(S.t);
  S.finalAt = S.t;
  S.el.final.hidden = false;
};
export const setFinal = async (on: boolean) => {
  if (AWAY) return;
  set({ final: on });
  if (!on) { S.el.final.hidden = true; return; }
  if (S.playing) setPlaying(false);
  if (!S.finalRender) {
    set({ loading: "đang dựng bản final (khoảng 10 giây, chỉ lần đầu)…" });
    S.finalRender = await buildScene(S.el.final, 1920, 1080, false);
    set({ loading: "" });
  }
  S.finalAt = -1;
  S.dirty = true;
};

// ---------- Drawn every frame, straight into the page
// The film's own list of what is going on at t (draw.describe), read right after render(t). Rebuilt only when it changes
let reviewKey = "", reviewChecked = false;
const drawReview = () => {
  const box = S.el.review, describe = S.render?.describe;
  if (!get().review || !describe) { box.hidden = true; reviewKey = ""; return; }
  let sections;
  try { sections = describe(S.t); } catch (e) { sections = [{ head: "DESCRIBE FAILED", lines: [{ text: String((e as Error)?.message ?? e).slice(0, 200) }] }]; }
  if (!reviewChecked) { reviewChecked = true; const p = problems(Sections, sections, "draw.describe(t) result"); if (p.length) { reportFilm([...filmProblems, ...p]); return; } }
  const key = JSON.stringify(sections);
  box.hidden = false;
  if (key === reviewKey) return;
  reviewKey = key;
  queueMicrotask(fitOverlays);
  box.replaceChildren(...sections.map(({ head, lines }) => {
    const s = document.createElement("section");
    const h = document.createElement("h4");
    h.textContent = head;
    s.append(h, ...lines.map(({ text, fresh }) => {
      const p = document.createElement("p");
      if (fresh) { p.className = "new"; const b = document.createElement("b"); b.textContent = "NEW"; p.append(b); }
      p.append(text);
      return p;
    }));
    return s;
  }));
};
// The review list (top left) wraps into as many columns as the picture's height asks for; where they would run under the
// option chips (right), it becomes one column that scrolls, as on a phone
export const fitOverlays = () => {
  const list = S.el?.review, box = S.el?.chips;
  if (!list || !box) return;
  list.classList.remove("narrow");
  if (list.hidden || !box.children.length) return;
  const edge = Math.min(...[...box.children].map((c) => c.getBoundingClientRect().left)) - 8;
  if (Math.max(...[...list.children].map((c) => c.getBoundingClientRect().right)) <= edge) return;
  list.classList.add("narrow");
  list.style.setProperty("--room", `${Math.max(120, edge - list.getBoundingClientRect().left)}px`);
};
addEventListener("resize", () => { reviewKey = ""; S.dirty = true; });
export const setReview = (on: boolean) => { set({ review: on }); stored.set("reviewList", on ? "on" : "off"); reviewKey = ""; S.dirty = true; };
export const setCaptions = (on: boolean) => { set({ captions: on }); stored.set("captions", on ? "on" : "off"); S.dirty = true; };
export const setTryOn = (on: boolean) => { set({ tryOn: on }); stored.set("tryNow", on ? "on" : "off"); S.dirty = true; };
export const drawPins = () => {
  const box = S.el?.pins;
  if (!box) return;
  // A saved note shows its words, the one being written what was tapped; past 60% across the words go on the left to stay in frame
  const add = (pin: Pin, saved: boolean, words: string | undefined, fade = 1) => {
    const d = document.createElement("div");
    d.className = saved ? "pin saved" : "pin";
    d.style.left = `${pin.x * 100}%`; d.style.top = `${pin.y * 100}%`;
    if (fade < 1) d.style.opacity = String(fade);
    if (words) { const i = document.createElement("i"); i.textContent = words; if (pin.x > 0.6) i.className = "left"; d.append(i); }
    box.append(d);
  };
  box.replaceChildren();
  for (const n of pinsHere()) add(n.pin, true, n.text, n.fade);
  const own = get().compose?.pin;
  if (own) add(own, false, own.what);
};

// ---------- The film contract (contract.mjs, docs/film-contract.md): the server checks the film's files, this page its code
let filmProblems: string[] = [], fileProblems: string[] = [];
const showContract = () => set({ contract: [...fileProblems, ...filmProblems] });
const reportFilm = (list: string[]) => { filmProblems = list; showContract(); postJson("/api/contract", { problems: list }).catch(() => {}); };
// Everything a page away from this PC fetched, at its size on the wire even when it came from the cache this time: what a
// first visit costs. The studio warns in its terminal when that is too much (src/weight.mjs)
const reportWeight = () => {
  if (!AWAY) return;
  const files = [...performance.getEntriesByType("navigation"), ...performance.getEntriesByType("resource")]
    .map((e) => ({ url: new URL(e.name), bytes: (e as PerformanceResourceTiming).encodedBodySize }))
    .filter(({ url, bytes }) => url.origin === location.origin && bytes > 0)
    .map(({ url, bytes }) => ({ path: url.pathname, bytes }));
  postJson("/api/weight", { files }).catch(() => {});
};
const loadContract = async () => {
  const r = await fetch("/api/contract.json").catch(() => null);
  if (!r?.ok) return;
  fileProblems = (await r.json()).files ?? [];
  showContract();
};

const loadVoice = async () => { const r = await getFile("/api/voice_map.json"); if (r.ok) { S.voice = await r.json(); refreshTimes(); } };

// ---------- Picture: fills the room it has, and a click on it pins a note there
const fit = () => {
  const r = S.el.view.getBoundingClientRect(), s = Math.min(r.width / 16, r.height / 9);
  S.el.stage.style.width = `${Math.floor(s * 16)}px`; S.el.stage.style.height = `${Math.floor(s * 9)}px`;
};
const attachPicture = () => {
  const { canvas } = S.el;
  new ResizeObserver(fit).observe(S.el.view);
  let downAt: [number, number] | null = null, camDrag: { x: number; y: number; mode: "look" | "orbit" | "slide" } | null = null;
  canvas.addEventListener("pointerdown", (e) => {
    downAt = [e.clientX, e.clientY];
    if (!S.tools?.free.on) return;
    canvas.setPointerCapture(e.pointerId);
    camDrag = { x: e.clientX, y: e.clientY, mode: e.button !== 0 ? "slide" : e.shiftKey ? "orbit" : "look" };
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!camDrag || !S.tools) return;
    const f = S.tools.free, dx = e.clientX - camDrag.x, dy = e.clientY - camDrag.y;
    camDrag.x = e.clientX; camDrag.y = e.clientY;
    if (camDrag.mode === "look") turnAbout(f.p, f.l, -dx * 0.0025, dy * 0.0025);
    else if (camDrag.mode === "orbit") turnAbout(f.l, f.p, -dx * 0.005, -dy * 0.005);
    else { const s = f.p.distanceTo(f.l) * 0.0012; moveCam(0, -dx * s, dy * s); }
    S.dirty = true;
  });
  addEventListener("pointerup", () => { camDrag = null; });
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  // Walking keys, by their place on the keyboard (any layout). Typing a note or a shortcut with Ctrl never walks
  addEventListener("keydown", (e) => {
    if (!S.tools?.free.on || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target instanceof HTMLElement && e.target.closest("input, textarea, select, [contenteditable]")) return;
    if (flight.press(e.code)) { e.preventDefault(); S.dirty = true; }
  });
  addEventListener("keyup", (e) => flight.release(e.code));
  addEventListener("blur", () => flight.clear()); // a key let go in another window never comes back as a keyup
  canvas.addEventListener("wheel", (e) => { if (!S.tools?.free.on) return; e.preventDefault(); moveCam((e.deltaY > 0 ? -1 : 1) * (e.shiftKey ? 0.03 : 0.12), 0, 0); }, { passive: false });
  // On click, not pointerup: a phone only lets the note box take focus and raise its keyboard from a click
  canvas.addEventListener("click", (e) => {
    if (!downAt || e.button !== 0 || !S.render) return;
    const moved = Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]);
    downAt = null;
    if (moved > 4) return; // that was the free camera being dragged
    const r = canvas.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    if (S.playing) setPlaying(false);
    render(S.t);
    openNote({ x: +x.toFixed(4), y: +y.toFixed(4), ...lookAtClick(x, y) });
  });
};

// ---------- The film's saves, from the studio's server (app/events.ts)
const listen = () => {
  const codeChanged = () => set({ newBuild: true });
  onEvent("code", codeChanged);
  onEvent("build-error", (message) => showError(`Code lỗi, trang vẫn chạy bản trước. Sửa xong là trang tự tải lại.\n\n${message}`));
  onEvent("sound-start", () => say("đang trộn tiếng…"));
  onEvent("sound", () => { loadMix(); loadTrials(); say("tiếng đã cập nhật"); });
  onEvent("notes", loadNotes);
  onEvent("voice", loadVoice);
  onEvent("contract", loadContract);
  // Back after the line dropped or the studio restarted: catch up on what changed meanwhile
  onHello((current, reconnect) => {
    if (!current) codeChanged();
    // Not the mix: that is the whole WAV again on every phone unlock. The rest answers "unchanged" for a few bytes
    if (reconnect) { loadNotes(); loadVoice(); loadContract(); loadTrials(); }
  });
};

// ---------- Start, then draw whenever something changed
export const start = async (el: Elements) => {
  S.el = el;
  THREE.DefaultLoadingManager.onError = (url) => { S.failedFile = url; };
  THREE.DefaultLoadingManager.onProgress = (_, done, total) => { if (!S.render) set({ loading: `đang dựng căn phòng... ${done}/${total}` }); };
  marks.notes = () => get().notes.map((n) => ({ t: noteAt(n), done: n.done }));
  marks.optionRanges = optionRanges;
  try { const v = Number(stored.get("volume") ?? 1); if (v > 0 && v <= 1) setVolume(v); } catch {}
  listen();
  attachPicture();
  attachTimeline(seek, setPlaying);
  fit();
  if (!AWAY) el.audio.src = MIX_URL; // on a phone line the room comes first, or the sound eats the bandwidth while the picture stays black
  flushNotes();
  FILM.applyEdit();
  S.comments = await (await getFile("/api/shots.json")).json();
  const t0 = performance.now();
  // A phone gets fewer pixels to draw; clicks and pins are in fractions of the picture, so nothing else notices
  if (PHONE) { el.canvas.width = 640; el.canvas.height = 360; }
  const timeline = Promise.all([loadNotes(), loadVoice()]); // the words and notes don't wait for the room
  try {
    S.render = await buildScene(el.canvas, PHONE ? 640 : 960, PHONE ? 360 : 540, true);
  } catch (e) {
    // A file lost on a bad line: start again, the browser keeps the ones that arrived. Giving up has to say which file
    const tries = Number(stored.get("loadTries", sessionStorage)) || 0;
    if (tries < 3) {
      stored.set("loadTries", String(tries + 1), sessionStorage);
      set({ loading: `mạng chập chờn, tải lại lần ${tries + 1}…` });
      // Only once the line is back: reloading into no network would leave the browser's own error page
      for (;;) { await wait(1500); try { if ((await fetch("/api/edit.json")).ok) break; } catch {} }
      location.reload();
      return;
    }
    stored.remove("loadTries", sessionStorage);
    throw new Error(`Không tải được ${S.failedFile || "căn phòng"}. Kiểm tra mạng rồi tải lại trang. (${(e as Error).message})`);
  }
  stored.remove("loadTries", sessionStorage);
  if (AWAY) loadWholeMix();
  S.tools = S.render.tools;
  reportFilm(checkFilm(FILM, S.render));
  loadContract();
  set({ reviewAvailable: !!S.render.describe, loading: "", ready: true });
  say(`dựng xong trong ${((performance.now() - t0) / 1000).toFixed(1)}s`);
  const extras = Promise.all([timeline, loadTrials(), loadSounds()]).then(() => { refreshTimes(); S.dirty = true; });
  refreshTimes();
  seek(S.t);
  loop();
  extras.then(() => { restoreDraft(); window.__readyAt = Date.now(); reportWeight(); });
};

const warm = SHOTS.map((_, i) => i).sort((a, b) => Math.abs(SHOTS[a].t - S.t) - Math.abs(SHOTS[b].t - S.t));
let drawMs = 0, frames = 0, fpsAt = performance.now(), shownShot = -1, lastFrame = performance.now();
const flight = createFlight();
// A film that throws at one moment still lets the dev move to another: the error shows and the next frame comes anyway
const loop = () => {
  try { frame(); } catch (e) { showError(e); }
  // A page in the background gets no animation frames, and the sound would carry on without the picture
  if (document.hidden) setTimeout(loop, 100); else requestAnimationFrame(loop);
};
const frame = () => {
  const { audio } = S.el;
  const dt = Math.min(0.1, (performance.now() - lastFrame) / 1000); // a frame after a stall moves a little, never across the room
  lastFrame = performance.now();
  if (S.tools?.free.on) { const d = flight.step(dt); if (d) moveCam(...d); } else flight.clear();
  if (S.playing) {
    // Sound is the clock, so picture and voice can't drift; slow frames are skipped, never delayed.
    // A stalled sound holds the picture: running on would mean jumping back when the sound catches up. Only no sound at all lets the clock run
    const rate = audio.playbackRate;
    if (!audio.paused && audio.readyState > 2) { S.t = audio.currentTime; S.clockStart = performance.now() - (S.t * 1000) / rate; }
    else if (!audio.src || audio.error || pastMix(audio)) S.t = ((performance.now() - S.clockStart) / 1000) * rate;
    else S.clockStart = performance.now() - (S.t * 1000) / rate;
    if (S.t >= DURATION - 0.02) { S.t = DURATION - 0.02; setPlaying(false); }
    if (get().loop) { const i = shotIndex(window.__loopFrom ?? S.t); if (S.t >= shotEnd(i) - 0.02) seek(SHOTS[i].t); }
    S.dirty = true;
  }
  if (S.dirty) {
    S.dirty = false;
    const a = performance.now();
    render(S.t);
    drawReview();
    followChips();
    drawMs = drawMs * 0.9 + (performance.now() - a) * 0.1;
    frames++;
    const i = shotIndex(S.t);
    S.el.clock.textContent = stamp(S.t);
    if (i !== shownShot) { shownShot = i; set({ shot: `shot ${i}: ${S.comments[i] ?? ""}` }); }
    S.el.caption.textContent = get().captions ? captionAt(S.t) ?? "" : "";
    drawTimelines();
    drawPins();
    if (get().final && S.finalRender) {
      if (S.playing || S.dragging) S.el.final.hidden = true;
      else if (S.finalAt !== S.t) drawFinal();
    }
    followNotes();
    stored.set("t", String(S.t), sessionStorage);
    window.__live = { t: S.t, shot: i, drawMs };
  } else if (warm.length) {
    // While nothing is asked of it: touch one more shot, nearest first, so its shaders and textures are ready before the first
    // jump there. The current frame is redrawn in the same task, so the screen never shows the detour
    render(SHOTS[warm.shift()!].t + 0.1);
    render(S.t);
  }
  const now = performance.now();
  if (now - fpsAt > 500) {
    const fps = (frames * 1000) / (now - fpsAt);
    frames = 0; fpsAt = now;
    set({ perf: `${S.playing ? fps.toFixed(0) + " fps, " : ""}${drawMs.toFixed(0)} ms/frame` });
  }
};

