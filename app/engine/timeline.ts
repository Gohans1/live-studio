// The two timelines, drawn on canvases: the whole film above (shots, voice, notes, the stretch shown below) and the
// stretch around the playhead below (shot names, each sentence's pace, the words, actions and sounds in lanes, option ranges).
// Custom canvas on purpose: the waveform is drawn through the voice edit's time warp and the rows come from edit.json, which no
// waveform or timeline library models. The studio only reads the timeline; changes are made from notes, in edit.json.
import { applyEdit, DURATION, SHOTS_OUT as SHOTS } from "film/scene";
import { EDIT, fromSource, toSource } from "film/edit";
import { pad, stamp, stored } from "./env";
import { S } from "./state";
import { set } from "./store";

const SLOW_WPM = 130, FAST_WPM = 280, STILL = 6; // a sentence outside these reads as off pace; this long with nothing moving reads as stuck
const HOLDS = new Set(["zz", "note1", "code", "typing"]); // these say when something is shown, not that it moves
const SHADES = ["#1C1B1A", "#282726"];
const UI_FONT = "system-ui,Segoe UI,Roboto,sans-serif";

export const shotIndex = (x: number) => { let i = 0; SHOTS.forEach((s, n) => { if (x >= s.t) i = n; }); return i; };
export const shotEnd = (i: number) => SHOTS[i + 1]?.t ?? DURATION;

type Box = { type: "beat"; id: string; x0: number; x1: number; y0: number; y1: number } | { type: "line" | "gap" | "cut"; i: number; x0: number; x1: number; y0: number; y1: number };
let boxes: Box[] = [];
let selected: { type: "beat"; id: string } | { type: "line"; i: number } | null = null;
let stuck: [number, number][] = [];
let overBg: HTMLCanvasElement | null = null;
let span = Number(stored.get("span", sessionStorage)) || Infinity; // the whole film until zoomed in
const shown = () => Math.min(span, DURATION); // seconds the detail timeline shows
let frozenCentre: number | null = null;
// What else the timelines mark, set by the parts that own it
export const marks = {
  notes: () => [] as { t: number; done: boolean }[],
  optionRanges: () => [] as [number, number][],
};

export const paceOf = (i: number) => {
  const l = S.voice.lines[i];
  if (!l || l.words.length < 4 || l.e <= l.s) return null;
  return (l.words.length / (l.e - l.s)) * 60 * (EDIT.voice.edits[i]?.speed ?? 1);
};
// Stretches where neither the camera nor anything in frame moves
const findStuck = () => {
  const out: [number, number][] = [];
  SHOTS.forEach((s, i) => {
    if (s.pull || s.walk || s.pan) return;
    const a = s.t, b = shotEnd(i);
    const moves = Object.entries(EDIT.beats)
      .filter(([id, m]) => m.kind === "motion" && (!HOLDS.has(id) || (id === "typing" && !s.hideMan)))
      .map(([, m]) => [fromSource(m.at), fromSource(m.at + m.dur)])
      .filter(([x, y]) => y > a && x < b)
      .sort((p, q) => p[0] - q[0]);
    let from = a;
    for (const [x, y] of moves) { if (x - from >= STILL) out.push([from, x]); from = Math.max(from, y); }
    if (b - from >= STILL) out.push([from, b]);
  });
  return out;
};
export const wordNear = (out: number) => {
  let best = null, d = 1e9;
  for (const l of S.voiceOut) for (const w of l.words) { const e = Math.abs(w.s - out); if (e < d) { d = e; best = w; } }
  return { word: best, gap: d };
};

const describeSelection = () => {
  if (selected?.type === "beat") {
    const b = EDIT.beats[selected.id], out = fromSource(b.at);
    set({ selection: [b.title, `${stamp(out)}, ngay chữ "${wordNear(out).word?.w ?? ""}"`] });
  } else if (selected?.type === "line") {
    const i = selected.i, l = S.voice.lines[i], pace = paceOf(i), next = S.voice.lines[i + 1];
    set({ selection: [l.text, `${pace ? `${Math.round(pace)} từ/phút, ` : ""}nghỉ sau câu ${(next ? next.s - l.e : 0).toFixed(2)} giây`] });
  } else {
    const off = S.voice.lines.filter((_, i) => { const p = paceOf(i); return p && (p > FAST_WPM || p < SLOW_WPM); }).length;
    set({ selection: [`${off} câu lệch nhịp (tô màu), ${stuck.length} đoạn đứng yên quá ${STILL} giây (vạch đỏ)`, `Zoom ${((EDIT.zoomRate ?? 0) * 100).toFixed(1)}% mỗi giây`] });
  }
};

// Every time the edit or the voice map changes: the heard seconds of everything move
export const refreshTimes = () => {
  applyEdit();
  S.voiceOut = S.voice.lines.map((l) => ({ ...l, s: fromSource(l.s), e: fromSource(l.e), words: l.words.map((w) => ({ ...w, s: fromSource(w.s), e: fromSource(w.e) })) }));
  overBg = null;
  S.dirty = true;
  stuck = findStuck();
  describeSelection();
  if (S.tools) drawTimelines();
};

const sized = (c: HTMLCanvasElement) => {
  const r = c.getBoundingClientRect(), d = devicePixelRatio || 1;
  if (c.width !== Math.round(r.width * d) || c.height !== Math.round(r.height * d)) { c.width = Math.round(r.width * d); c.height = Math.round(r.height * d); }
  const g = c.getContext("2d")!;
  g.setTransform(d, 0, 0, d, 0, 0);
  return { g, w: r.width, h: r.height };
};
const drawWave = (g: CanvasRenderingContext2D, a: number, b: number, w: number, y: number, h: number) => {
  const { peaks, step } = S.voice;
  if (!peaks.length) return;
  g.fillStyle = "#878580";
  for (let x = 0; x < w; x++) {
    const i0 = Math.floor(toSource(a + (x / w) * (b - a)) / step), i1 = Math.max(i0 + 1, Math.floor(toSource(a + ((x + 1) / w) * (b - a)) / step));
    let p = 0;
    for (let i = Math.max(0, i0); i < Math.min(peaks.length, i1); i++) if (peaks[i] > p) p = peaks[i];
    if (p > 0.012) { const d = (p * h) / 2; g.fillRect(x, y + h / 2 - d, 1, Math.max(1, d * 2)); }
  }
};
export const viewCentre = () => {
  const c = frozenCentre ?? S.t;
  return shown() >= DURATION ? DURATION / 2 : Math.max(shown() / 2, Math.min(DURATION - shown() / 2, c));
};

const drawOverview = () => {
  const c = S.el.over, { g, w, h } = sized(c);
  if (!c.width || !c.height) return; // a page loaded out of sight has no size yet; the resize observer draws it once it has
  if (!overBg || overBg.width !== c.width) {
    overBg = document.createElement("canvas"); overBg.width = c.width; overBg.height = c.height;
    const b = overBg.getContext("2d")!, d = c.width / w;
    b.scale(d, d);
    SHOTS.forEach((s, i) => { b.fillStyle = SHADES[i % 2]; b.fillRect((s.t / DURATION) * w, 0, ((shotEnd(i) - s.t) / DURATION) * w + 1, h); });
    drawWave(b, 0, DURATION, w, 2, h - 4);
  }
  g.drawImage(overBg, 0, 0, w, h);
  for (const n of marks.notes()) if (!n.done) { g.fillStyle = "#3AA99F"; g.fillRect((n.t / DURATION) * w - 1, 0, 2, 7); }
  const a = viewCentre() - shown() / 2;
  g.fillStyle = "rgba(255,255,255,.1)"; g.fillRect((a / DURATION) * w, 0, (shown() / DURATION) * w, h);
  drawNow(g, (S.t / DURATION) * w, h, false);
};

const drawDetail = () => {
  const { g, w, h } = sized(S.el.detail);
  const v = shown(), a = viewCentre() - v / 2, b = a + v, t = S.t;
  const X = (s: number) => ((s - a) / v) * w;
  g.fillStyle = "#100F0F"; g.fillRect(0, 0, w, h);
  g.font = `12px ${UI_FONT}`; g.textBaseline = "middle";
  SHOTS.forEach((s, i) => {
    const e = shotEnd(i);
    if (e < a || s.t > b) return;
    const x0 = Math.max(0, X(s.t)), x1 = Math.min(w, X(e));
    g.fillStyle = i === shotIndex(t) ? "#403E3C" : SHADES[i % 2];
    g.fillRect(x0, 0, x1 - x0 - 1, 20);
    g.save(); g.beginPath(); g.rect(x0, 0, x1 - x0 - 3, 20); g.clip();
    g.fillStyle = "#CECDC3"; g.fillText(`${i} ${S.comments[i] ?? ""}`, x0 + 4, 10);
    g.restore();
    g.fillStyle = "#343331"; g.fillRect(X(s.t), 20, 1, h - 20);
  });
  boxes = [];
  SHOTS.forEach((s, i) => { if (i && s.t >= a && s.t <= b) boxes.push({ type: "cut", i, x0: X(s.t) - 4, x1: X(s.t) + 4, y0: 0, y1: 20 }); });
  g.fillStyle = "#D14D41";
  for (const [x, y] of stuck) if (y > a && x < b) g.fillRect(X(x), 18, X(y) - X(x), 3);
  // Voice: each sentence's pace behind the wave
  S.voiceOut.forEach((l, i) => {
    const n = S.voiceOut[i + 1];
    if (n && n.s > a && l.e < b && X(n.s) - X(l.e) > 4) boxes.push({ type: "gap", i, x0: X(l.e), x1: X(n.s), y0: 22, y1: 66 });
    if (l.e < a || l.s > b) return;
    const pace = paceOf(i), on = selected?.type === "line" && selected.i === i;
    g.fillStyle = on ? "#333D12" : pace && pace > FAST_WPM ? "#3A1C19" : pace && pace < SLOW_WPM ? "#152A40" : "#1C1B1A";
    g.fillRect(X(l.s), 22, X(l.e) - X(l.s), 44);
    boxes.push({ type: "line", i, x0: X(l.s), x1: X(l.e), y0: 22, y1: 66 });
    if (EDIT.voice.edits[i]) { g.fillStyle = "#3AA99F"; g.fillRect(X(l.s), 22, X(l.e) - X(l.s), 2); }
  });
  drawWave(g, a, b, w, 22, 44);
  // Actions and sounds, in lanes so they don't cover each other
  const short = h < 160; // on a phone the notes need the room
  const lanes: Record<string, number[]> = short ? { motion: [-1e9, -1e9], sound: [-1e9] } : { motion: [-1e9, -1e9, -1e9], sound: [-1e9, -1e9] };
  const BASE: Record<string, number> = { motion: 90, sound: short ? 118 : 132 };
  g.font = `11px ${UI_FONT}`;
  for (const [id, m] of Object.entries(EDIT.beats).sort((p, q) => p[1].at - q[1].at)) {
    const o0 = fromSource(m.at), o1 = fromSource(m.at + m.dur);
    if (o1 < a || o0 > b) continue;
    const row = lanes[m.kind], x0 = X(o0), x1 = Math.max(x0 + 10, X(o1));
    let lane = row.findIndex((end) => x0 >= end + 2);
    if (lane < 0) lane = 0;
    const label = HOLDS.has(id) ? x0 + 6 : x1;
    row[lane] = Math.max(x1, x0 + (m.title.length * 5.6 + 8));
    const y = BASE[m.kind] + lane * 14, on = selected?.type === "beat" && selected.id === id;
    g.fillStyle = m.kind === "sound" ? "#5E409D" : HOLDS.has(id) ? "#4A5A12" : m.curve === "snap" ? "#BC5215" : "#205EA6";
    g.fillRect(x0, y, x1 - x0, 13);
    if (on) { g.strokeStyle = "#3AA99F"; g.lineWidth = 2; g.strokeRect(x0 + 1, y + 1, x1 - x0 - 2, 11); }
    g.fillStyle = "#E6E4D9"; g.fillText(m.title, x0 + 3, y + 7);
    g.fillStyle = "#3AA99F";
    for (const [off] of m.sounds) if (m.kind === "motion") g.fillRect(X(fromSource(m.at + off)), y + 10, 2, 3);
    boxes.unshift({ type: "beat", id, x0, x1: Math.min(x1, label + 60), y0: y, y1: y + 13 });
  }
  g.fillStyle = "#D0A215";
  for (const [s0, s1] of marks.optionRanges()) if (s1 >= a && s0 <= b) g.fillRect(X(s0), h - 16, Math.max(1, X(s1) - X(s0)), 4);
  // Words, as many as fit
  g.font = `12px ${UI_FONT}`; g.fillStyle = "#CECDC3";
  let right = -1;
  for (const l of S.voiceOut) {
    if (l.e < a || l.s > b) continue;
    for (const word of l.words) {
      const x = X(word.s);
      if (x < -40 || x > w) continue;
      const wd = g.measureText(word.w).width;
      if (x <= right + 3) continue;
      g.fillStyle = t >= word.s && t <= word.e ? "#3AA99F" : "#CECDC3";
      g.fillText(word.w, x, 77);
      right = x + wd;
    }
  }
  if (!S.voice.lines.length) { g.fillStyle = "#878580"; g.fillText("đang nghe giọng đọc để hiện lời thoại…", 8, 77); }
  // Seconds, with room for each label whatever the screen
  g.fillStyle = "#878580"; g.font = "10px Consolas,monospace";
  const tick = [1, 2, 5, 10, 30, 60].find((n) => (n / shown()) * w >= 56) ?? 60;
  for (let s = Math.max(0, Math.ceil(a / tick) * tick); s <= b; s += tick) { g.fillRect(X(s), h - 5, 1, 5); g.fillText(`${pad(Math.floor(s / 60))}:${pad(s % 60)}`, X(s) + 3, h - 7); }
  // Notes: a marker each, their lines faint so many of them don't drown the playhead; a done note keeps only a dim marker
  for (const n of marks.notes()) {
    if (n.t < a || n.t > b) continue;
    const x = X(n.t);
    g.fillStyle = n.done ? "#575653" : "#3AA99F";
    g.beginPath(); g.moveTo(x - 5, 21); g.lineTo(x + 5, 21); g.lineTo(x, 30); g.fill();
    if (!n.done) { g.globalAlpha = 0.4; g.fillRect(x, 30, 1, h - 30); g.globalAlpha = 1; }
  }
  drawNow(g, X(t), h, true);
};

// The playhead, the one line to find at a glance: a dark edge so no colour behind it hides it, and on the detail a head
const NOW = "#EC8B49";
const drawNow = (g: CanvasRenderingContext2D, x: number, h: number, head: boolean) => {
  g.fillStyle = "#000"; g.fillRect(x - 2, 0, 4, h);
  g.fillStyle = NOW; g.fillRect(x - 1, 0, 2, h);
  if (!head) return;
  g.beginPath(); g.moveTo(x - 7, 0); g.lineTo(x + 7, 0); g.lineTo(x + 7, 10); g.lineTo(x, 17); g.lineTo(x - 7, 10); g.closePath();
  g.fillStyle = NOW; g.fill(); g.strokeStyle = "#000"; g.lineWidth = 1; g.stroke();
};

export const drawTimelines = () => { if (!S.el) return; drawOverview(); drawDetail(); };
export const zoomSpan = (k: number) => { span = Math.max(6, Math.min(DURATION, shown() * k)); stored.set("span", String(span), sessionStorage); drawTimelines(); };

const boxAt = (e: PointerEvent) => {
  const r = S.el.detail.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
  // A fingertip covers more than these thin rows: take what's nearest within reach, and keep a cut's edge easy to catch
  const reach = e.pointerType === "touch" ? 9 : 0;
  let best: Box | null = null, d = 1e9;
  for (const b of boxes) {
    const dx = Math.max(b.x0 - reach - x, 0, x - b.x1 - reach), dy = Math.max(b.y0 - reach - y, 0, y - b.y1 - reach);
    if (dx || dy) continue;
    const e2 = Math.abs(y - (b.y0 + b.y1) / 2) + (b.type === "line" || b.type === "gap" ? 20 : 0);
    if (e2 < d) { d = e2; best = b; }
  }
  return best;
};

// Scrubbing: a press on either timeline seeks and drags; the stretch below holds still under the finger while it drags
export const attachTimeline = (seek: (x: number) => void, setPlaying: (p: boolean) => void) => {
  const { over, detail } = S.el;
  const scrub = (c: HTMLCanvasElement, toTime: (e: PointerEvent) => number) => {
    const down = (e: PointerEvent) => {
      c.setPointerCapture(e.pointerId);
      S.dragging = { resume: S.playing };
      if (S.playing) setPlaying(false);
      if (c === detail) frozenCentre = viewCentre();
      seek(toTime(e));
    };
    const move = (e: PointerEvent) => { if (S.dragging) seek(toTime(e)); };
    const up = () => { if (!S.dragging) return; const r = S.dragging.resume; S.dragging = null; frozenCentre = null; S.dirty = true; if (r) setPlaying(true); };
    c.addEventListener("pointerdown", down);
    c.addEventListener("pointermove", move);
    c.addEventListener("pointerup", up);
    c.addEventListener("pointercancel", up);
  };
  // A press picks what the panel describes, and still scrubs
  detail.addEventListener("pointerdown", (e) => {
    const b = boxAt(e);
    selected = b?.type === "beat" ? { type: "beat", id: b.id } : b && (b.type === "line" || b.type === "gap") ? { type: "line", i: b.i } : null;
    describeSelection();
  });
  scrub(over, (e) => { const r = over.getBoundingClientRect(); return ((e.clientX - r.left) / r.width) * DURATION; });
  scrub(detail, (e) => { const r = detail.getBoundingClientRect(); return viewCentre() - shown() / 2 + ((e.clientX - r.left) / r.width) * shown(); });
  detail.addEventListener("wheel", (e) => { e.preventDefault(); zoomSpan(e.deltaY > 0 ? 1.2 : 1 / 1.2); }, { passive: false });
  new ResizeObserver(() => { overBg = null; drawTimelines(); }).observe(S.el.timeline);
  window.__editor ??= { boxes: () => boxes, seek, duration: () => DURATION, clear: () => { selected = null; describeSelection(); }, words: () => S.voice.lines.flatMap((l) => l.words.map((w) => w.s)) };
};
