// Before and after. Every change to the film is kept as a version, cheaply (the code bundle, edit.json, a fingerprint of the sound and
// assets, shared between versions when unchanged), so the studio can draw an old version beside the current one and say where they differ.
// The picture isn't compared here: a headless Chrome draws both versions and reports back, and results are saved as they come, so a stopped run resumes.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { constants as osConstants, setPriority } from "node:os";
import { readdir, stat } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { gzipSync } from "node:zlib";

const KEEP = 30;
const RANGE_GAP = 1; // seconds
const CUE_LENGTH = 0.5; // a mark needs some width to be seen and jumped to
const hash = (data) => createHash("md5").update(data).digest("hex").slice(0, 12);
const ENVELOPE_STEP = 0.05, SOUND_LIMIT = 0.001, SOUND_GAP = 0.5;
const PACED_MARGIN = 0.3, PACED_LIMIT = 0.002, PACED_RUN = 2; // tuned on a real voice mix, see the comment in soundRanges
const JOB_LIMIT = 15 * 60e3;
const START_LIMIT = 120e3; // loading both versions of a long film on a slow disk took 40s
const SCAN_QUIET = 8e3; // a scan takes a Chrome 12s to get going and pegs the machine: while an AI is still saving, the result would be thrown away anyway
const MAX_BODY = 20 * 1024 * 1024;
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

export const parseRows = (text) => {
  const rows = [];
  let total = 0, done = false, ends = null;
  for (const l of text.split("\n")) {
    if (!l.trim()) continue;
    let r;
    try { r = JSON.parse(l); } catch { continue; } // a line cut off when a run was stopped: that frame is simply drawn again
    if (r.total) { total = r.total; ends = r.ends ?? ends; } else if (r.done) done = true; else if (!r.failed) rows.push(r);
  }
  return { rows, total, done, ends };
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

export const readJson = (req) => new Promise((ok, no) => { const parts = []; let size = 0; req.on("data", (d) => { size += d.length; if (size > MAX_BODY) { no(new Error("request too large")); req.destroy(); } else parts.push(d); }); req.on("end", () => { try { ok(JSON.parse(Buffer.concat(parts).toString("utf8"))); } catch (e) { no(e); } }); req.on("error", no); });

export const createVersions = ({ project, here, alias, plugins, port, send, esbuild, squeeze, mixFile, editFile, assetsDir }) => {
  const ROOT = join(project, "renders/versions");
  const CODE = join(ROOT, "code"), EDITS = join(ROOT, "edits"), SOUNDS = join(ROOT, "sound"), ASSETS = join(ROOT, "assets"), COMPARES = join(ROOT, "compares");
  for (const d of [CODE, EDITS, SOUNDS, ASSETS, COMPARES]) mkdirSync(d, { recursive: true });
  const INDEX = join(ROOT, "index.json");
  let index = { versions: [], seen: null, base: null };
  try { index = { ...index, ...JSON.parse(readFileSync(INDEX, "utf8")) }; } catch {}
  let code = null, job = null, timer = null, mixSeen = {}, retries = 0, snapshotting = false, lastChange = 0, quietTimer = null;
  const removeProfile = (dir) => { try { rmSync(dir, { recursive: true, force: true }); } catch {} }; // a Chrome just killed can still hold it: the next start clears it
  const sweepProfiles = () => { for (const n of readdirSync(ROOT)) if (n.startsWith("chrome_")) removeProfile(join(ROOT, n)); }; // left by a killed studio or a Chrome still closing: tens of MB each
  sweepProfiles();
  const failures = new Map(); // for this run only: restarting the studio tries a failed pair again, from where it stopped
  const crashes = new Map();
  const wanted = []; // pairs a page still waits on while another runs: only one Chrome at a time

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
    for (const [dir, key, ext] of [[CODE, "code", ".js"], [EDITS, "edit", ".json"], [SOUNDS, "mix", ".f32"], [ASSETS, "assets", ".json"]]) {
      const used = live(key);
      for (const f of readdirSync(dir)) if (!used.has(f.replace(ext, ""))) rmSync(join(dir, f), { force: true });
    }
    const ids = new Set(index.versions.map((v) => v.id));
    for (const f of readdirSync(COMPARES)) { const [a, b] = f.replace(".jsonl", "").split("_"); if (!ids.has(a) || !ids.has(b)) rmSync(join(COMPARES, f), { force: true }); }
  };

  const snapshot = async () => {
    if (!code) return;
    const stamps = JSON.stringify(await stampAssets(assetsDir)), assetsId = hash(stamps); // first: everything after this happens in one go
    let edit;
    try { edit = JSON.stringify(JSON.parse(readFileSync(editFile, "utf8"))); } catch { return; } // caught mid-save: the next change event brings it
    const codeId = hash(code), editId = hash(edit);
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
    writeFileSync(join(CODE, `${codeId}.js`), code);
    writeFileSync(join(EDITS, `${editId}.json`), edit);
    writeFileSync(join(ASSETS, `${assetsId}.json`), stamps);
    index.versions = index.versions.filter((v) => v.id !== id);
    index.versions.push({ id, at: new Date().toISOString(), code: codeId, edit: editId, mix: mixId, assets: assetsId });
    prune();
    saveIndex();
    lastChange = Date.now();
    stopJob(); // what it's scanning was just replaced
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
    return [...new Set([...Object.keys(ma), ...Object.keys(mb)])].filter((k) => ma[k] !== mb[k] && !SOUND_FILE.test(k)); // sound is compared on its own: the warning is about old versions showing today's pictures
  };

  const chromePath = () => [process.env.LIVE_CHROME, join(project, "tools/chrome-headless-shell/chrome-headless-shell.exe"), join(project, "tools/chrome-headless-shell/chrome-headless-shell"),
    "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find((p) => p && existsSync(p));

  const stopJob = () => { if (!job) return; clearTimeout(job.limit); job.proc.kill(); job = null; };
  process.on("exit", () => job?.proc.kill());
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, () => process.exit(0));
  const compareFile = (a, b) => join(COMPARES, `${a}_${b}.jsonl`);
  const readRows = (a, b) => { const f = compareFile(a, b); return parseRows(existsSync(f) ? readFileSync(f, "utf8") : ""); };
  const startJob = (a, b) => {
    if (job?.a === a && job?.b === b) return true;
    if (job && job.b === current() && !wanted.some((w) => w[0] === job.a && w[1] === job.b)) wanted.unshift([job.a, job.b]);
    stopJob();
    const chrome = chromePath();
    if (!chrome) return false;
    sweepProfiles();
    const profile = join(ROOT, `chrome_${process.pid}_${Date.now()}`); // its own: the last job's Chrome may still be closing
    mkdirSync(profile, { recursive: true });
    const proc = spawn(chrome, [chrome.includes("headless-shell") ? "--headless" : "--headless=new", "--use-gl=angle", "--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist", "--no-first-run", "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows", `--user-data-dir=${profile}`, "--remote-debugging-port=0", `http://127.0.0.1:${port}/compare-job/${a}/${b}`], { stdio: "ignore" });
    try { setPriority(proc.pid, osConstants.priority.PRIORITY_BELOW_NORMAL); } catch {} // the film being watched goes first
    const key = `${a}_${b}`;
    const fail = (message) => { failures.set(key, message); send("compare", { a, b }); };
    const mine = { a, b, proc, limit: setTimeout(() => { if (job === mine) { stopJob(); fail("quá lâu, bật lại studio để dò tiếp"); nextJob(); } }, JOB_LIMIT) };
    job = mine;
    setTimeout(() => { if (job === mine && !mine.started) { stopJob(); fail("Chrome không chạy được, bật lại studio để thử lại"); nextJob(); } }, START_LIMIT);
    proc.on("error", (e) => { if (job !== mine) return; clearTimeout(mine.limit); job = null; fail(`không mở được Chrome: ${e.message}`); nextJob(); });
    // Closing by itself means it crashed: what it found is saved, so go on from there, but don't loop on a crash that keeps happening
    proc.on("close", () => {
      removeProfile(profile);
      if (job !== mine) return;
      clearTimeout(mine.limit);
      job = null;
      const n = (crashes.get(key) ?? 0) + 1;
      crashes.set(key, n);
      if (n > 2) { fail("Chrome cứ tắt giữa chừng, bật lại studio để dò tiếp"); nextJob(); return; }
      console.log("compare: Chrome closed, going on");
      setTimeout(() => { if (!job) startJob(a, b); }, 1000);
    });
    return true;
  };

  const nextJob = () => {
    while (wanted.length && !job) {
      const [a, b] = wanted.shift();
      if (find(a) && find(b) && b === current() && !readRows(a, b).done && !failures.has(`${a}_${b}`)) startJob(a, b);
    }
  };
  // Scanning draws two more copies of the film, so it waits until someone is comparing: it would otherwise run on every save, under whatever is being watched
  const compareResult = (a, b, scan) => {
    const A = find(a), B = find(b), editA = readEdit(A), editB = readEdit(B);
    const warpB = editB.voice?.warp, warpA = editA.voice?.warp;
    const edits = describeEdit(editA, editB).map((e) => ({ at: e.source === null ? null : mapTime(warpB, e.source, 0, 1), text: e.text }));
    const pictureMayDiffer = A.code !== B.code || A.edit !== B.edit;
    const { rows, total, done, ends } = readRows(a, b), failed = failures.get(`${a}_${b}`) ?? null;
    let state = "none";
    if (pictureMayDiffer) {
      if (done) state = "done";
      else if (failed) state = "failed";
      else if (!scan) state = "waiting";
      else if (Date.now() - lastChange < SCAN_QUIET) {
        state = "settling";
        clearTimeout(quietTimer);
        quietTimer = setTimeout(() => send("compare", { a, b }), SCAN_QUIET - (Date.now() - lastChange) + 100); // the page asks again, and this time it starts
      }
      else state = startJob(a, b) ? "running" : "no-chrome";
    }
    const sorted = rows.toSorted((p, q) => p.f - q.f), ranges = [];
    let open = null;
    for (const r of sorted) {
      if (!r.n) continue;
      // A hand that pauses for half a second is still one change
      if (open && r.f / 30 - open.to <= RANGE_GAP) { open.to = r.f / 30; open.whole ||= !!r.w; } else { open = { from: r.f / 30, to: r.f / 30, whole: !!r.w }; ranges.push(open); }
    }
    // Both scans stop where the new film ends, so a cut tail can't show up as a difference in the picture
    const length = ends && Math.abs(ends[1] - ends[0]) > 0.05 ? { at: mapTime(warpB, Math.min(...ends), 0, 1), by: ends[1] - ends[0] } : null;
    return {
      length, a, b, atA: A.at, atB: B.at, edits, code: A.code !== B.code, sound: mergeRanges([...mixRanges(A, B, warpA, warpB), ...cueRanges(editA, editB, warpB)]), assets: assetChanges(A, B),
      picture: { state, failed, done: rows.length, total, ranges, rows: sorted.filter((r) => r.n).map((r) => [r.f, r.w ? 1 : 0, r.b ?? []]) },
    };
  };

  const json = (req, res, data) => {
    res.setHeader("content-type", "application/json");
    res.setHeader("cache-control", "no-store");
    const text = JSON.stringify(data);
    if (text.length < 1024 || !/gzip/.test(req.headers["accept-encoding"] ?? "")) { res.end(text); return; }
    res.setHeader("content-encoding", "gzip"); // sent every second during a scan, over a phone's relay
    res.end(gzipSync(text));
  };
  const missing = (res) => { res.statusCode = 404; res.end(); };

  const route = async (req, res, url) => {
    if (url === "/versions.json") {
      json(req, res, { current: current(), before: beforeId(), seen: index.seen, versions: index.versions.map((v) => ({ id: v.id, at: v.at })) });
      return true;
    }
    if (req.method === "POST" && url === "/seen") {
      const { id } = await readJson(req);
      if (find(id) && id === current() && index.seen !== id) {
        if (index.seen) index.base = index.seen;
        index.seen = id;
        saveIndex();
      }
      res.end("ok");
      return true;
    }
    // By the code's own hash: most saves change only the edit, and a new version shouldn't download the same film again
    const bundle = /^\/before\/code\/([0-9a-f]+)\.js$/.exec(url);
    if (bundle) {
      const f = join(CODE, `${bundle[1]}.js`);
      if (!existsSync(f)) { missing(res); return true; }
      res.setHeader("cache-control", "max-age=31536000");
      res.setHeader("content-type", "text/javascript");
      res.end(squeeze(req, res, readFileSync(f), bundle[1]));
      return true;
    }
    const before = /^\/before\/([0-9a-f]+)\/(edit\.json)?$/.exec(url);
    if (before) {
      const v = find(before[1]);
      if (!v) { missing(res); return true; }
      res.setHeader("cache-control", before[2] ? "max-age=31536000" : "no-cache"); // an edit never changes under its version's name, the page around it can
      if (before[2] === "edit.json") { res.setHeader("content-type", "application/json"); res.end(readFileSync(join(EDITS, `${v.edit}.json`))); }
      else { res.setHeader("content-type", "text/html; charset=utf-8"); res.end('<!doctype html><meta charset="utf-8"><base href="/"><style>html,body{margin:0;height:100%;background:#000;overflow:hidden}canvas{display:block;width:100%;height:100%}</style><canvas id="gl"></canvas><script>addEventListener("error",e=>parent.postMessage({filmError:e.message},"*"))</script><script type="module" src="/before/code/' + v.code + '.js"></script>'); }
      return true;
    }
    const pair = /^\/compare(-job)?\/([0-9a-f]+)\/([0-9a-f]+)(?:\/(done|rows|start|finish|fail))?$/.exec(url);
    if (!pair) return false;
    const [, isJob, a, b, step] = pair;
    if (!find(a) || !find(b)) { missing(res); return true; }
    if (!isJob) { json(req, res, compareResult(a, b, req.url.includes("scan=1"))); return true; }
    if (!step) { res.setHeader("content-type", "text/html; charset=utf-8"); res.end(readFileSync(join(here, "compare_job.html"))); return true; }
    if (step === "done") { json(req, res, readRows(a, b).rows.map((r) => r.f)); return true; }
    const data = await readJson(req);
    const file = compareFile(a, b);
    if (step === "start" && job?.a === a && job?.b === b) job.started = true;
    if (step === "start") appendFileSync(file, JSON.stringify({ total: data.total, ends: data.ends }) + "\n");
    if (step === "rows") appendFileSync(file, data.map((r) => JSON.stringify(r) + "\n").join(""));
    if (step === "finish") appendFileSync(file, '{"done":true}\n');
    send("compare", { a, b });
    if (step === "finish" && job?.a === a && job?.b === b) { stopJob(); nextJob(); }
    // Only the job running now counts: one just stopped for another pair can report the failures of its own stopping.
    // A file that failed to load may load next time, a film that throws will say so again
    if (step === "fail" && job?.a === a && job?.b === b) {
      stopJob();
      const key = `${a}_${b}`, n = (crashes.get(key) ?? 0) + 1;
      crashes.set(key, n);
      if (n > 2) { failures.set(key, String(data.message).slice(0, 300)); send("compare", { a, b }); nextJob(); } else setTimeout(() => { if (!job) startJob(a, b); }, 1000);
    }
    res.end("ok");
    return true;
  };

  const start = async () => {
    // The bundle holds code only: its edit.json comes from the version being shown, before anything in the film runs
    const editAtRuntime = { name: "edit-at-runtime", setup(b) {
      b.onResolve({ filter: /\/edit\.json$/ }, () => ({ path: "edit.json", namespace: "version-edit" }));
      b.onLoad({ filter: /.*/, namespace: "version-edit" }, () => ({ contents: 'export default await (await fetch(new URL("edit.json", location.href))).json();', loader: "js" }));
    } };
    const noteBuilt = { name: "note-built", setup(b) { b.onEnd((r) => { if (!r.errors.length) { code = r.outputFiles[0].contents; changed(); } }); } };
    const ctx = await esbuild.context({ absWorkingDir: project, entryPoints: [join(here, "compare_view.ts")], alias, bundle: true, format: "esm", outfile: join(ROOT, "view.js"), logLevel: "silent", write: false, minifyWhitespace: true, minifySyntax: true, plugins: [...plugins, editAtRuntime, noteBuilt] });
    await ctx.rebuild().catch(() => {}); // the film doesn't build yet: the page says why, and the next save builds it
    await ctx.watch();
  };

  return { route, changed, start, current };
};
