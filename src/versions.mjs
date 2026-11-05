// What changed since the version last watched. Every change to the film is kept as a version, cheaply (edit.json, how loud the
// mix was over time, a fingerprint of the film's code and of its assets, shared between versions when unchanged), and two
// versions are told apart in words: edits from edit.json with their times, where the sound changed, whether code or asset
// files changed. No old version is drawn: trying looks or sounds side by side is the film's own options (draw.variants,
// trials.json), far cheaper than building and scanning a whole old film.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";

const KEEP = 30;
const CUE_LENGTH = 0.5; // a mark needs some width to be seen and jumped to
const hash = (data) => createHash("md5").update(data).digest("hex").slice(0, 12);
const ENVELOPE_STEP = 0.05, SOUND_LIMIT = 0.001, SOUND_GAP = 0.5;
const PACED_MARGIN = 0.3, PACED_LIMIT = 0.002, PACED_RUN = 2; // tuned on a real voice mix, see the comment in soundRanges
const SOUND_FILE = /\.(wav|mp3|ogg|opus|flac|m4a|aac|webm)$/i;
const TOP_NAMES = { beats: "hành động", camera: "camera", cuts: "điểm cắt", face: "mặt", voice: "giọng", zoomRate: "tốc độ zoom" };

// Same mapping as edit.ts, for a version's own voice edit
const mapTime = (warp, x, a, b) => {
  if (!warp || warp.length < 2) return x;
  if (x <= warp[0][a]) return x - warp[0][a] + warp[0][b];
  const last = warp[warp.length - 1];
  if (x >= last[a]) return x - last[a] + last[b];
  let lo = 0, hi = warp.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (warp[m][a] <= x) lo = m; else hi = m; }
  return warp[lo][b] + ((x - warp[lo][a]) / (warp[hi][a] - warp[lo][a])) * (warp[hi][b] - warp[lo][b]);
};

// ---------- What changed in edit.json, in words
const timeOf = (v) => (v && typeof v === "object" ? (Array.isArray(v) ? (typeof v[0] === "number" ? v[0] : null) : typeof v.at === "number" ? v.at : typeof v.t === "number" ? v.t : null) : null);
const nameOf = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v.title ?? v.word ?? v.name ?? null : null);
const short = (v) => { const s = JSON.stringify(v, (_, x) => (typeof x === "number" ? +x.toFixed(4) : x)) ?? "-"; return s.length > 40 ? s.slice(0, 37) + "..." : s; };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const isPlain = (v) => v && typeof v === "object" && !Array.isArray(v);

// Inserting one camera key must read as one key added, not every later key changed
const alignArrays = (a, b) => {
  const ka = a.map((v) => JSON.stringify(v)), kb = b.map((v) => JSON.stringify(v));
  const lcs = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) lcs[i][j] = ka[i] === kb[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const pairs = [];
  let i = 0, j = 0, gapA = [], gapB = [];
  const flush = () => { for (let n = 0; n < Math.max(gapA.length, gapB.length); n++) pairs.push([gapA[n] ?? -1, gapB[n] ?? -1]); gapA = []; gapB = []; };
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && ka[i] === kb[j]) { flush(); i++; j++; }
    else if (j >= b.length || (i < a.length && lcs[i + 1][j] >= lcs[i][j + 1])) gapA.push(i++);
    else gapB.push(j++);
  }
  flush();
  return pairs;
};

const walk = (a, b, path, time, name, out) => {
  if (same(a, b)) return;
  if (Array.isArray(a) && Array.isArray(b) && [...a, ...b].every((v) => timeOf(v) !== null)) {
    // A beat's sounds start with an offset from the beat; every other timed list holds film times
    const whenOf = path.endsWith(".sounds") ? (v) => time + v[0] : timeOf;
    for (const [i, j] of alignArrays(a, b)) {
      const was = a[i], now = b[j], at = `${path}[${j >= 0 ? j : i}]`;
      if (i < 0) out.push({ path: at, time: whenOf(now), name: nameOf(now), now: "thêm" });
      else if (j < 0) out.push({ path: at, time: whenOf(was), name: nameOf(was), now: "bỏ" });
      else walk(was, now, at, whenOf(now) ?? time, nameOf(now) ?? name, out);
    }
    return;
  }
  if (isPlain(a) && isPlain(b)) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const was = a[k], now = b[k], at = path ? `${path}.${k}` : k;
      const keyTime = /^\d+(\.\d+)?$/.test(k) ? Number(k) : null;
      const when = (isPlain(now) ? timeOf(now) : null) ?? (isPlain(was) ? timeOf(was) : null) ?? keyTime ?? time; // an array here is a position like [x, y, z], not a time
      const who = nameOf(now) ?? nameOf(was) ?? name;
      if (was === undefined) out.push({ path: at, time: when, name: who, now: "thêm" });
      else if (now === undefined) out.push({ path: at, time: when, name: who, now: "bỏ" });
      else walk(was, now, at, when, who, out);
    }
    return;
  }
  out.push({ path, time, name, was: short(a), now: short(b) });
};

export const describeEdit = (a, b) => {
  const found = [];
  walk(a, b, "", null, null, found);
  const byTop = new Map();
  for (const f of found) { const top = f.path.match(/^[^.[]+/)?.[0] ?? f.path; byTop.set(top, [...(byTop.get(top) ?? []), f]); }
  const items = [];
  for (const [top, list] of byTop) {
    const label = TOP_NAMES[top] ?? top;
    // A re-timed voice touches hundreds of numbers: that's one fact, not a list to read
    if (list.length > 40) { items.push({ source: null, text: `${label}: ${list.length} chỗ đổi` }); continue; }
    for (const f of list) {
      const rest = f.path.slice(top.length).replace(/^\./, "");
      const what = `${label}${rest ? ` ${rest}` : ""}${f.name ? ` ("${f.name}")` : ""}`;
      items.push({ source: f.time, text: f.was === undefined ? `${what}: ${f.now}` : `${what}: ${f.was} → ${f.now}` });
    }
  }
  return items;
};

// ---------- The sound, as loudness over time
export const envelopeOf = (file) => {
  const data = readFileSync(file);
  let at = 12, channels = 1, rate = 44100, bits = 16, format = 1, start = 0, size = 0;
  while (at + 8 <= data.length) {
    const id = data.toString("latin1", at, at + 4), len = data.readUInt32LE(at + 4);
    if (id === "fmt ") { format = data.readUInt16LE(at + 8); if (format === 0xfffe) format = data.readUInt16LE(at + 32); channels = data.readUInt16LE(at + 10); rate = data.readUInt32LE(at + 12); bits = data.readUInt16LE(at + 22); }
    if (id === "data") { start = at + 8; size = Math.min(len, data.length - start); break; }
    at += 8 + len + (len % 2);
  }
  const bytes = bits / 8, per = Math.round(rate * ENVELOPE_STEP) * channels, total = Math.floor(size / bytes);
  const out = new Float32Array(Math.ceil(total / per));
  for (let i = 0; i < out.length; i++) {
    let sum = 0, n = 0;
    for (let s = i * per; s < Math.min(total, (i + 1) * per); s++, n++) {
      const o = start + s * bytes;
      const v = format === 3 ? (bits === 64 ? data.readDoubleLE(o) : data.readFloatLE(o)) : bits === 24 ? data.readIntLE(o, 3) / 8388608 : bits === 32 ? data.readInt32LE(o) / 2147483648 : data.readInt16LE(o) / 32768;
      sum += v * v;
    }
    out[i] = n ? Math.sqrt(sum / n) : 0;
  }
  return out;
};

export const pickBefore = (index) => {
  const now = index.versions.at(-1)?.id ?? null, has = (id) => index.versions.some((v) => v.id === id);
  if (index.seen && index.seen !== now && has(index.seen)) return index.seen;
  if (index.base && index.base !== now && has(index.base)) return index.base;
  return index.versions.at(-2)?.id ?? null;
};

export const soundRanges = (ea, eb, warpA, warpB) => {
  const ranges = [];
  let run = 0;
  for (let i = 0; i < eb.length; i++) {
    const out = i * ENVELOPE_STEP, at = mapTime(warpA, mapTime(warpB, out, 1, 0), 0, 1) / ENVELOPE_STEP;
    let differs, need = 1;
    if (Math.abs(at - i) < 1e-6) differs = Math.abs(eb[i] - (ea[i] ?? 0)) > SOUND_LIMIT;
    else {
      // Re-paced: the windows no longer line up, and in speech one window's loudness says little about the next, so comparing them
      // marked nearly everything after the edit. A window straddling two old ones can only be about as loud as they were: only leaving
      // the loudness around it counts. On a real mix this left the inserted pause and a few stray marks, and still found a quiet tone under speech
      const f = Math.floor(at), near = [f - 1, f, f + 1, f + 2].map((n) => ea[n] ?? 0), low = Math.min(...near), high = Math.max(...near);
      differs = eb[i] > high * (1 + PACED_MARGIN) + PACED_LIMIT || eb[i] < low * (1 - PACED_MARGIN) - PACED_LIMIT;
      need = PACED_RUN;
    }
    run = differs ? run + 1 : 0;
    if (run < need) continue;
    const last = ranges.at(-1);
    if (last && out - last.to <= SOUND_GAP) last.to = out; else ranges.push({ from: (i - run + 1) * ENVELOPE_STEP, to: out });
  }
  // Sound the new mix no longer reaches has nothing above to be compared with
  const end = Math.ceil(mapTime(warpA, mapTime(warpB, eb.length * ENVELOPE_STEP, 1, 0), 0, 1) / ENVELOPE_STEP);
  if (ea.subarray(Math.max(0, end)).some((v) => v > SOUND_LIMIT)) ranges.push({ from: Math.max(0, eb.length - 1) * ENVELOPE_STEP, to: eb.length * ENVELOPE_STEP });
  return ranges;
};

// The live mix leaves out the sounds tied to actions, the page plays those itself, so a moved one only shows in edit.json.
// Same voice second on both sides: re-pacing the voice carries them along and isn't a change
export const cueRanges = (editA, editB, warpB) => {
  const cues = (e) => new Map(Object.values(e.beats ?? {}).flatMap((m) => (Array.isArray(m.sounds) ? m.sounds : []).filter((s) => Array.isArray(s) && typeof s[0] === "number").map(([off, name, v]) => { const at = m.at + off; return [`${at.toFixed(3)}|${name}|${v}`, at]; })));
  const ca = cues(editA), cb = cues(editB);
  const moved = [...[...ca].filter(([k]) => !cb.has(k)), ...[...cb].filter(([k]) => !ca.has(k))];
  return moved.map(([, at]) => mapTime(warpB, at, 0, 1)).map((t) => ({ from: t, to: t + CUE_LENGTH }));
};

// Oldest go first, but never what "before" still points at, and never the current one
export const trimVersions = (versions, keep) => {
  const out = [...versions];
  while (out.length > KEEP) {
    const drop = out.findIndex((v) => !keep.has(v.id));
    if (drop < 0 || drop >= out.length - 1) break;
    out.splice(drop, 1);
  }
  return out;
};

// Every file's size and time, in a fixed order. Follows junctions, which is why nothing cheaper will do: a film's assets are mostly behind them, and fs.watch sees nothing there.
// Async, because thousands of files on a slow disk would otherwise hold up every request for a second
export const stampAssets = async (dir) => {
  const map = {};
  const go = async (d) => {
    let names = [];
    try { names = await readdir(d); } catch { return; }
    await Promise.all(names.map(async (n) => {
      const p = join(d, n);
      try { const s = await stat(p); if (s.isDirectory()) await go(p); else map[relative(dir, p).replace(/\\/g, "/")] = `${s.size}:${Math.round(s.mtimeMs)}`; } catch {} // gone since it was listed
    }));
  };
  await go(dir);
  return Object.fromEntries(Object.entries(map).sort(([p], [q]) => (p < q ? -1 : 1)));
};


// The film's own code, by content: saving a file unchanged is no new version. edit.json is a version's edit, not its code
const hashCode = async (dir, skip) => {
  const h = createHash("md5");
  const go = async (d) => {
    let names = [];
    try { names = (await readdir(d)).sort(); } catch { return; }
    for (const n of names) {
      const p = join(d, n);
      if (p === skip) continue;
      try { if ((await stat(p)).isDirectory()) await go(p); else h.update(relative(dir, p)).update(await readFile(p)); } catch {} // gone since it was listed
    }
  };
  await go(dir);
  return h.digest("hex").slice(0, 12);
};

export const createVersions = ({ project, send, mixFile, editFile, assetsDir, codeDir }) => {
  const ROOT = join(project, "renders/versions");
  const EDITS = join(ROOT, "edits"), SOUNDS = join(ROOT, "sound"), ASSETS = join(ROOT, "assets");
  for (const d of [EDITS, SOUNDS, ASSETS]) mkdirSync(d, { recursive: true });
  // Left by the studio that drew old versions and scanned their pictures: tens of MB nothing reads any more
  for (const n of readdirSync(ROOT)) if (["code", "compares", "view.js"].includes(n) || n.startsWith("chrome_")) { try { rmSync(join(ROOT, n), { recursive: true, force: true }); } catch {} }
  const INDEX = join(ROOT, "index.json");
  let index = { versions: [], seen: null, base: null };
  try { index = { ...index, ...JSON.parse(readFileSync(INDEX, "utf8")) }; } catch {}
  let timer = null, mixSeen = {}, retries = 0, snapshotting = false;

  const saveIndex = () => {
    const fresh = `${INDEX}.new`;
    writeFileSync(fresh, JSON.stringify(index));
    for (let i = 0; ; i++) {
      try { renameSync(fresh, INDEX); return; } catch (e) { if (i >= 20) throw e; Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50); }
    }
  };
  const current = () => index.versions.at(-1)?.id ?? null;
  const find = (id) => index.versions.find((v) => v.id === id);
  // What "before" means: the version last actually watched. Opening the page isn't watching, using it is (the page reports that).
  // Once the current version has been watched, the one watched before it stays the comparison until the film changes again
  const beforeId = () => pickBefore(index);

  const prune = () => {
    index.versions = trimVersions(index.versions, new Set([index.seen, index.base]));
    const live = (key) => new Set(index.versions.map((v) => v[key]));
    for (const [dir, key, ext] of [[EDITS, "edit", ".json"], [SOUNDS, "mix", ".f32"], [ASSETS, "assets", ".json"]]) {
      const used = live(key);
      for (const f of readdirSync(dir)) if (!used.has(f.replace(ext, ""))) rmSync(join(dir, f), { force: true });
    }
  };

  const snapshot = async () => {
    const stamps = JSON.stringify(await stampAssets(assetsDir)), assetsId = hash(stamps); // first: everything after this happens in one go
    const codeId = await hashCode(codeDir, editFile);
    let edit;
    try { edit = JSON.stringify(JSON.parse(readFileSync(editFile, "utf8"))); } catch { return; } // caught mid-save: the next change event brings it
    const editId = hash(edit);
    let mixId = null;
    if (existsSync(mixFile)) {
      // Windows reports files as changed when they're only read, so this runs often: the mix is only read when it really moved
      const { size, mtimeMs } = statSync(mixFile), mark = `${size}:${mtimeMs}`;
      if (mixSeen.mark !== mark) mixSeen = { mark, id: hash(readFileSync(mixFile)) };
      mixId = mixSeen.id;
      const f = join(SOUNDS, `${mixId}.f32`);
      if (!existsSync(f)) { const e = envelopeOf(mixFile); writeFileSync(f, Buffer.from(e.buffer, e.byteOffset, e.byteLength)); }
    }
    const id = hash([codeId, editId, mixId, assetsId].join());
    if (current() === id) return;
    writeFileSync(join(EDITS, `${editId}.json`), edit);
    writeFileSync(join(ASSETS, `${assetsId}.json`), stamps);
    index.versions = index.versions.filter((v) => v.id !== id);
    index.versions.push({ id, at: new Date().toISOString(), code: codeId, edit: editId, mix: mixId, assets: assetsId });
    prune();
    saveIndex();
    send("versions");
  };
  // Saves come in bursts while an AI works, and one round of fixes is one thing to compare
  // The mix can be half written or locked when this runs: the next look finds it whole
  const changed = () => { clearTimeout(timer); timer = setTimeout(async () => {
    if (snapshotting) { changed(); return; }
    snapshotting = true;
    try { await snapshot(); retries = 0; } catch (e) { console.log("versions: trying again:", e.message); if (++retries < 20) changed(); }
    snapshotting = false;
  }, 1500); };

  const readEdit = (v) => JSON.parse(readFileSync(join(EDITS, `${v.edit}.json`), "utf8"));
  const mergeRanges = (list) => {
    const out = [];
    for (const r of list.toSorted((p, q) => p.from - q.from)) { const last = out.at(-1); if (last && r.from - last.to <= SOUND_GAP) last.to = Math.max(last.to, r.to); else out.push({ ...r }); }
    return out;
  };
  const mixRanges = (a, b, warpA, warpB) => {
    if (!a.mix || !b.mix || a.mix === b.mix) return [];
    const load = (v) => { const raw = readFileSync(join(SOUNDS, `${v.mix}.f32`)); return new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4); };
    return soundRanges(load(a), load(b), warpA, warpB);
  };
  const assetChanges = (a, b) => {
    if (a.assets === b.assets) return [];
    const ma = JSON.parse(readFileSync(join(ASSETS, `${a.assets}.json`), "utf8")), mb = JSON.parse(readFileSync(join(ASSETS, `${b.assets}.json`), "utf8"));
    return [...new Set([...Object.keys(ma), ...Object.keys(mb)])].filter((k) => ma[k] !== mb[k] && !SOUND_FILE.test(k)); // sound shows as where the mix changed
  };
  const compareResult = (a, b) => {
    const A = find(a), B = find(b), editA = readEdit(A), editB = readEdit(B);
    const warpB = editB.voice?.warp, warpA = editA.voice?.warp;
    const edits = describeEdit(editA, editB).map((e) => ({ at: e.source === null ? null : mapTime(warpB, e.source, 0, 1), text: e.text }));
    return { a, b, atA: A.at, atB: B.at, edits, code: A.code !== B.code, sound: mergeRanges([...mixRanges(A, B, warpA, warpB), ...cueRanges(editA, editB, warpB)]), assets: assetChanges(A, B) };
  };

  const list = () => ({ current: current(), before: beforeId(), seen: index.seen, versions: index.versions.map((v) => ({ id: v.id, at: v.at })) });
  // The page says when the current version has really been watched
  const seen = (id) => {
    if (!find(id) || id !== current() || index.seen === id) return;
    if (index.seen) index.base = index.seen;
    index.seen = id;
    saveIndex();
  };
  const compare = (a, b) => (find(a) && find(b) ? compareResult(a, b) : null);

  return { list, seen, compare, changed, current };
};
