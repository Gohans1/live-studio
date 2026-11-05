// Options to choose between, in one list: looks of a prop (the film's draw.variants) and sounds (trials.json from the film's
// sound.py). A look is swapped in the scene; a sound is played from here and left out of the live mix. Either way a switch
// shows or sounds at once, and "Chốt" writes the pick to the film's choices file, which its renders read.
// A sound group is either cues (one hit per cue) or kind "stem": one recording per option covering from..to on the mix's clock.
// The page also plays every beat sound in edit.json itself (the live mix leaves them out), so moving one is heard at once.
import type { Variant } from "film/scene";
import { EDIT, fromSource } from "film/edit";
import { AWAY, FPS, getFile, letter, postJson, stored } from "./env";
import { S } from "./state";
import { type ChipView, get, type GroupView, say, set } from "./store";

interface SoundOption { id: string; title: string; files?: string[]; source?: string; buffers?: AudioBuffer[]; loading?: Promise<void>; level?: number; scale?: number; plain?: boolean }
interface Cue { at: number; pick: number; rate: number; gain: number }
interface Group {
  title: string; kind?: "stem" | "picture"; from?: number; to?: number; cues?: Cue[]; variant?: Variant;
  options: SoundOption[]; chosen: { set: string; gain?: number } | null;
}
interface Pick { set: string; gain: number }

export const audioCtx = new AudioContext();
const master = audioCtx.createGain();
master.connect(audioCtx.destination);
let trials: Record<string, Group> = {};
const picked: Record<string, Pick> = JSON.parse(stored.get("picked", sessionStorage) ?? "{}");
let sounding: AudioBufferSourceNode[] = [], anchor: { base: number; speed: number; from: number } | null = null, stems: Record<string, AudioBufferSourceNode | null> = {};

const pickOf = (name: string): Pick => picked[name] ?? { set: trials[name].chosen?.set ?? trials[name].options[0].id, gain: trials[name].chosen?.gain ?? 1 };
const optionOf = (name: string) => trials[name].options.find((o) => o.id === pickOf(name).set) ?? trials[name].options[0];
const chosenOf = (name: string) => trials[name].chosen?.set ?? trials[name].options[0].id;
// Film seconds where a group is on screen or heard
export const rangesOf = (name: string): [number, number][] => {
  const g = trials[name];
  if (g.kind === "picture") return g.variant!.ranges;
  if (g.kind === "stem") return [[g.from!, g.to!]];
  return (g.cues ?? []).map((c) => { const o = fromSource(c.at); return [o, o]; });
};

const track = (src: AudioBufferSourceNode) => { src.onended = () => { sounding = sounding.filter((s) => s !== src); }; sounding.push(src); };
const silence = () => { for (const s of sounding) { try { s.stop(); } catch {} } sounding = []; stems = {}; anchor = null; };
// Only the sound in use comes down: the others wait until someone picks them. A look has nothing to load
const loadOption = (o: SoundOption) => (o.files
  ? (o.loading ??= Promise.all(o.files.map(async (f) => audioCtx.decodeAudioData(await (await getFile(f)).arrayBuffer()))).then((b) => { o.buffers = b; }))
  : Promise.resolve());
const playHit = (name: string, cue: Cue, when: number, speed: number) => {
  const o = optionOf(name), buf = o.buffers?.[cue.pick % o.buffers.length];
  if (!buf) { loadOption(o); return; }
  const src = audioCtx.createBufferSource(), g = audioCtx.createGain();
  src.buffer = buf;
  src.playbackRate.value = (o.plain ? 1 : cue.rate) * speed;
  g.gain.value = (o.level ?? 1) * (o.scale ?? 1) * (o.plain ? 1 : cue.gain) * pickOf(name).gain;
  src.connect(g).connect(master);
  src.start(when);
  track(src);
  const audio = S.el.audio;
  window.__hits = { n: (window.__hits?.n ?? 0) + 1, set: o.id, at: cue.at, late: +(cue.at - (audio.currentTime + (when - audioCtx.currentTime) * audio.playbackRate)).toFixed(4) };
};
// A stem is mixed at the film's level already; offset is seconds into it. With a length it is a preview, faded out so it doesn't click
const playStem = (name: string, when: number, offset: number, speed: number, length?: number) => {
  const o = optionOf(name), buf = o.buffers?.[0];
  if (!buf) { loadOption(o); return null; }
  const src = audioCtx.createBufferSource(), g = audioCtx.createGain(), v = pickOf(name).gain;
  src.buffer = buf;
  src.playbackRate.value = speed;
  g.gain.value = v;
  if (length) { g.gain.setValueAtTime(v, when + length - 0.08); g.gain.linearRampToValueAtTime(0, when + length); }
  src.connect(g).connect(master);
  if (length) src.start(when, offset, length); else src.start(when, offset);
  track(src);
  window.__stems = { ...window.__stems, [name]: { set: o.id, offset: +offset.toFixed(3) } };
  return src;
};
const soundFiles: Record<string, { buf: AudioBuffer; scale: number }> = {};
export const loadSounds = async () => {
  const names = new Set(Object.values(EDIT.beats).flatMap((b) => b.sounds.map((s) => s[1])));
  await Promise.all([...names].map(async (n) => {
    const small = AWAY ? await getFile(`/lite/agent/sfx2/${n}.webm`) : null;
    const buf = await audioCtx.decodeAudioData(await (small?.ok ? small : await getFile(`/agent/sfx2/${n}.wav`)).arrayBuffer());
    let peak = 1e-6;
    for (const v of buf.getChannelData(0)) if (Math.abs(v) > peak) peak = Math.abs(v);
    soundFiles[n] = { buf, scale: 0.9 / peak };
  }));
};
const playSound = (name: string, v: number, when: number, speed: number) => {
  const f = soundFiles[name];
  if (!f) return;
  const src = audioCtx.createBufferSource(), g = audioCtx.createGain();
  src.buffer = f.buf; src.playbackRate.value = speed;
  g.gain.value = v * f.scale;
  src.connect(g).connect(master);
  src.start(when);
  track(src);
  window.__sounds = (window.__sounds ?? 0) + 1;
};

let masterLevel = 1;
// Every 50 ms: what is due in the next quarter second, timed against the mix's own clock
const scheduleHits = () => {
  const audio = S.el?.audio;
  if (!audio) return;
  const level = audio.muted ? 0 : audio.volume;
  if (masterLevel !== level) { masterLevel = level; master.gain.setTargetAtTime(level, audioCtx.currentTime, 0.015); } // eased, or a slider drag clicks
  if (!S.playing || audio.paused || audio.readyState < 3) { if (anchor) silence(); return; }
  const now = audio.currentTime, speed = audio.playbackRate, base = audioCtx.currentTime - now / speed;
  // A seek shows up as a jump in the sound's clock; small wobble in that clock is ignored, so the rhythm of the presses stays even
  if (!anchor || anchor.speed !== speed || Math.abs(anchor.base - base) > 0.05) { silence(); anchor = { base, speed, from: now }; }
  const a = anchor, until = now + 0.25 * speed;
  const due = (at: number) => at >= a.from && at < until && at > now - 0.1;
  const when = (at: number) => Math.max(audioCtx.currentTime, a.base + at / speed);
  for (const name in trials) {
    const g = trials[name];
    if (g.cues) { for (const c of g.cues) { const at = Math.round(fromSource(c.at) * FPS) / FPS; if (due(at)) playHit(name, c, when(at), speed); } }
    else if (g.kind === "stem" && !stems[name] && g.from! < until && now < g.to!) { const at = Math.max(now, g.from!); stems[name] = playStem(name, when(at), at - g.from!, speed); }
  }
  for (const b of Object.values(EDIT.beats)) for (const [off, name, v] of b.sounds) { const at = Math.round(fromSource(b.at + off) * FPS) / FPS; if (due(at)) playSound(name, v, when(at), speed); }
  a.from = until;
};
setInterval(scheduleHits, 50);

// ---------- What the controls show
const publish = () => {
  const groups: GroupView[] = Object.keys(trials).map((name) => {
    const g = trials[name], p = pickOf(name);
    return { name, title: g.title, picture: g.kind === "picture", options: g.options.map((o) => ({ id: o.id, title: o.title, source: o.source })), chosen: chosenOf(name), pick: p.set, gain: p.gain, ranges: rangesOf(name) };
  });
  const { groupName } = get();
  set({ groups, groupName: groupName && trials[groupName] ? groupName : groups[0]?.name ?? null });
  chipKey = "";
  S.dirty = true;
};
// On the picture: the groups seen or heard around the playhead, so a choice turns up when its moment does
const SOON = 2, LATE = 0.5;
let chipKey = "";
export const followChips = () => {
  const { tryOn } = get();
  const near: ChipView[] = !tryOn ? [] : Object.keys(trials).flatMap((name) => {
    const r = rangesOf(name).find(([a, b]) => b >= S.t - LATE && a <= S.t + SOON);
    return r ? [{ name, range: r }] : [];
  });
  const key = JSON.stringify(near);
  if (key === chipKey) return;
  chipKey = key;
  set({ chips: near });
};
export const optionRanges = () => { const { groupName } = get(); return groupName && trials[groupName] ? rangesOf(groupName) : []; };

const setPicked = (name: string, change: Partial<Pick>) => {
  picked[name] = { ...pickOf(name), ...change };
  stored.set("picked", JSON.stringify(picked), sessionStorage);
  const g = trials[name];
  if (g.kind === "picture") g.variant!.set(pickOf(name).set);
  else if (anchor) { silence(); scheduleHits(); }
  publish();
};
export const choose = (name: string, i: number) => {
  const g = trials[name], o = g?.options[i];
  if (!o) return;
  audioCtx.resume();
  setPicked(name, { set: o.id });
  say(`${g.title}: ${letter(i)} ${o.title}`);
  if (g.kind === "picture") return;
  // Paused: still say what it sounds like
  loadOption(o).then(() => {
    if (S.playing) return;
    if (g.cues?.length) playHit(name, g.cues[Math.floor(Math.random() * g.cues.length)], audioCtx.currentTime, 1);
    else if (g.kind === "stem") { const len = Math.min(2.5, g.to! - g.from!); playStem(name, audioCtx.currentTime, Math.min(Math.max(0, S.t - g.from!), g.to! - g.from! - len), 1, len); }
  });
};
export const chooseInGroup = (i: number) => { const { groupName } = get(); if (groupName) choose(groupName, i); };
export const setGain = (name: string, gain: number) => setPicked(name, { gain });
export const pinPick = async (name: string) => {
  const p = pickOf(name), r = await postJson("/api/choose", { group: name, ...p }).catch(() => null);
  if (!r?.ok) { say("chưa chốt được: studio không trả lời, bấm Chốt lại khi studio chạy", 6000); return; }
  trials[name].chosen = p;
  publish();
  say(`đã chốt ${trials[name].title}: ${optionOf(name).title}, bản render sau sẽ dùng`);
};
// The next place a group is seen or heard, a little before it
export const whereNext = (name: string) => {
  const r = rangesOf(name);
  if (!r.length) return null;
  return Math.max(0, (r.find(([a]) => a > S.t + 0.7) ?? r[0])[0] - 0.6);
};
export const loadTrials = async () => {
  const [r, c] = await Promise.all([getFile("/api/trials.json"), getFile("/api/choices.json")]);
  const chosen = c.ok ? await c.json() : {}, sounds: Record<string, Group> = r.ok ? await r.json() : {};
  const looks: Record<string, Group> = Object.fromEntries((S.render?.variants ?? []).map((v) => [v.id, { title: v.title, kind: "picture", variant: v, options: v.options, chosen: chosen[v.id] ?? null }]));
  silence();
  trials = { ...looks, ...sounds };
  for (const name in looks) looks[name].variant!.set(pickOf(name).set);
  publish();
  await Promise.all(Object.keys(trials).map((name) => loadOption(optionOf(name))));
};
export const groupTitle = (name: string) => trials[name]?.title ?? name;
