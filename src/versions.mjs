// Before and after. Every change to the film is kept as a version, cheaply (the code bundle, edit.json, a fingerprint of the sound and
// assets, shared between versions when unchanged), so the studio can draw an old version beside the current one and say where they differ.
// The picture isn't compared here: a headless Chrome draws both versions and reports back, and results are saved as they come, so a stopped run resumes.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const KEEP = 30;
const hash = (data) => createHash("md5").update(data).digest("hex").slice(0, 12);
const ENVELOPE_STEP = 0.05, SOUND_LIMIT = 0.001, SOUND_GAP = 0.5;
const JOB_LIMIT = 15 * 60e3;
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
    for (const [i, j] of alignArrays(a, b)) {
      const was = a[i], now = b[j], at = `${path}[${j >= 0 ? j : i}]`;
      if (i < 0) out.push({ path: at, time: timeOf(now), name: nameOf(now), now: "thêm" });
      else if (j < 0) out.push({ path: at, time: timeOf(was), name: nameOf(was), now: "bỏ" });
      else walk(was, now, at, timeOf(now) ?? time, nameOf(now) ?? name, out);
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
const envelopeOf = (file) => {
  const data = readFileSync(file);
  let at = 12, channels = 1, rate = 44100, bits = 16, format = 1, start = 0, size = 0;
  while (at + 8 <= data.length) {
    const id = data.toString("latin1", at, at + 4), len = data.readUInt32LE(at + 4);
    if (id === "fmt ") { format = data.readUInt16LE(at + 8); channels = data.readUInt16LE(at + 10); rate = data.readUInt32LE(at + 12); bits = data.readUInt16LE(at + 22); }
    if (id === "data") { start = at + 8; size = Math.min(len, data.length - start); break; }
    at += 8 + len + (len % 2);
  }
  const bytes = bits / 8, per = Math.round(rate * ENVELOPE_STEP) * channels, total = Math.floor(size / bytes);
  const out = new Float32Array(Math.ceil(total / per));
  for (let i = 0; i < out.length; i++) {
    let sum = 0, n = 0;
    for (let s = i * per; s < Math.min(total, (i + 1) * per); s++, n++) {
      const v = format === 3 ? data.readFloatLE(start + s * bytes) : data.readInt16LE(start + s * bytes) / 32768;
      sum += v * v;
    }
    out[i] = n ? Math.sqrt(sum / n) : 0;
  }
  return out;
};

export const createVersions = ({ project, here, port, send, esbuild, mixFile, editFile, assetsDir }) => {
  const ROOT = join(project, "renders/versions");
  const CODE = join(ROOT, "code"), EDITS = join(ROOT, "edits"), SOUNDS = join(ROOT, "sound"), ASSETS = join(ROOT, "assets"), COMPARES = join(ROOT, "compares");
  for (const d of [CODE, EDITS, SOUNDS, ASSETS, COMPARES]) mkdirSync(d, { recursive: true });
  const INDEX = join(ROOT, "index.json");
  let index = { versions: [], seen: null, base: null };
  try { index = { ...index, ...JSON.parse(readFileSync(INDEX, "utf8")) }; } catch {}
  let code = null, job = null, timer = null;

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
  const beforeId = () => {
    const now = current();
    if (index.seen && index.seen !== now && find(index.seen)) return index.seen;
    if (index.base && index.base !== now && find(index.base)) return index.base;
    return index.versions.at(-2)?.id ?? null;
  };

  const stampAssets = (dir) => {
    const map = {};
    const go = (d) => { for (const n of readdirSync(d)) { const p = join(d, n), s = statSync(p); if (s.isDirectory()) go(p); else map[relative(dir, p).replace(/\\/g, "/")] = `${s.size}:${Math.round(s.mtimeMs)}`; } };
    try { go(dir); } catch {}
    return map;
  };

  const prune = () => {
    const keep = new Set([index.seen, index.base]);
    while (index.versions.length > KEEP) {
      const drop = index.versions.findIndex((v) => !keep.has(v.id));
      if (drop < 0 || drop >= index.versions.length - 1) break;
      index.versions.splice(drop, 1);
    }
    const live = (key) => new Set(index.versions.map((v) => v[key]));
    for (const [dir, key, ext] of [[CODE, "code", ".js"], [EDITS, "edit", ".json"], [SOUNDS, "mix", ".f32"], [ASSETS, "assets", ".json"]]) {
      const used = live(key);
      for (const f of readdirSync(dir)) if (!used.has(f.replace(ext, ""))) rmSync(join(dir, f), { force: true });
    }
    const ids = new Set(index.versions.map((v) => v.id));
    for (const f of readdirSync(COMPARES)) { const [a, b] = f.replace(".jsonl", "").split("_"); if (!ids.has(a) || !ids.has(b)) rmSync(join(COMPARES, f), { force: true }); }
  };

  const snapshot = () => {
    if (!code) return;
    let edit;
    try { edit = JSON.stringify(JSON.parse(readFileSync(editFile, "utf8"))); } catch { return; } // caught mid-save: the next change event brings it
    const codeId = hash(code), editId = hash(edit);
    let mixId = null;
    if (existsSync(mixFile)) {
      const wav = readFileSync(mixFile);
      mixId = hash(wav);
      const f = join(SOUNDS, `${mixId}.f32`);
      if (!existsSync(f)) { const e = envelopeOf(mixFile); writeFileSync(f, Buffer.from(e.buffer, e.byteOffset, e.byteLength)); }
    }
    const stamps = JSON.stringify(stampAssets(assetsDir)), assetsId = hash(stamps);
    const id = hash([codeId, editId, mixId, assetsId].join());
    if (current() === id) return;
    writeFileSync(join(CODE, `${codeId}.js`), code);
    writeFileSync(join(EDITS, `${editId}.json`), edit);
    writeFileSync(join(ASSETS, `${assetsId}.json`), stamps);
    index.versions = index.versions.filter((v) => v.id !== id);
    index.versions.push({ id, at: new Date().toISOString(), code: codeId, edit: editId, mix: mixId, assets: assetsId });
    prune();
    saveIndex();
    send("versions");
  };
  // Saves come in bursts while an AI works, and one round of fixes is one thing to compare
  const changed = () => { clearTimeout(timer); timer = setTimeout(snapshot, 1500); };

  const readEdit = (v) => JSON.parse(readFileSync(join(EDITS, `${v.edit}.json`), "utf8"));
  const soundRanges = (a, b, warpA, warpB) => {
    if (!a.mix || !b.mix || a.mix === b.mix) return [];
    const load = (v) => { const raw = readFileSync(join(SOUNDS, `${v.mix}.f32`)); return new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4); };
    const ea = load(a), eb = load(b), ranges = [];
    for (let i = 0; i < eb.length; i++) {
      const out = i * ENVELOPE_STEP, other = Math.round(mapTime(warpA, mapTime(warpB, out, 1, 0), 0, 1) / ENVELOPE_STEP);
      if (Math.abs(eb[i] - (ea[other] ?? 0)) <= SOUND_LIMIT) continue;
      const last = ranges.at(-1);
      if (last && out - last.to <= SOUND_GAP) last.to = out; else ranges.push({ from: out, to: out });
    }
    return ranges;
  };
  const assetChanges = (a, b) => {
    if (a.assets === b.assets) return [];
    const ma = JSON.parse(readFileSync(join(ASSETS, `${a.assets}.json`), "utf8")), mb = JSON.parse(readFileSync(join(ASSETS, `${b.assets}.json`), "utf8"));
    return [...new Set([...Object.keys(ma), ...Object.keys(mb)])].filter((k) => ma[k] !== mb[k]);
  };

  const chromePath = () => [process.env.LIVE_CHROME, join(project, "tools/chrome-headless-shell/chrome-headless-shell.exe"), join(project, "tools/chrome-headless-shell/chrome-headless-shell"),
    "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find((p) => p && existsSync(p));

  const stopJob = () => { if (!job) return; clearTimeout(job.limit); job.proc.kill(); const dead = job; job = null; setTimeout(() => { try { rmSync(dead.profile, { recursive: true, force: true }); } catch {} }, 1000); };
  process.on("exit", () => job?.proc.kill());
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, () => process.exit(0));
  const compareFile = (a, b) => join(COMPARES, `${a}_${b}.jsonl`);
  const readRows = (a, b) => {
    const f = compareFile(a, b);
    const rows = [];
    let total = 0, done = false, failed = null;
    if (existsSync(f)) for (const l of readFileSync(f, "utf8").split("\n")) {
      if (!l.trim()) continue;
      let r;
      try { r = JSON.parse(l); } catch { continue; } // a line cut off when a run was stopped: that frame is simply drawn again
      if (r.total) total = r.total; else if (r.done) done = true; else if (r.failed) failed = r.failed; else rows.push(r);
    }
    return { rows, total, done, failed };
  };
  const startJob = (a, b) => {
    if (job?.a === a && job?.b === b) return true;
    stopJob();
    const chrome = chromePath();
    if (!chrome) return false;
    const profile = join(ROOT, `chrome_${process.pid}`);
    mkdirSync(profile, { recursive: true });
    const proc = spawn(chrome, [chrome.includes("headless-shell") ? "--headless" : "--headless=new", "--use-gl=angle", "--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist", "--no-first-run", "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows", `--user-data-dir=${profile}`, "--remote-debugging-port=0", `http://127.0.0.1:${port}/compare-job/${a}/${b}`], { stdio: "ignore" });
    const mine = { a, b, proc, profile, limit: setTimeout(() => { if (job === mine) stopJob(); }, JOB_LIMIT) };
    job = mine;
    proc.on("error", (e) => { console.log("compare: Chrome did not start:", e.message); if (job === mine) job = null; });
    proc.on("close", () => { if (job === mine) { clearTimeout(mine.limit); job = null; } });
    return true;
  };

  const compareResult = (a, b) => {
    const A = find(a), B = find(b), editA = readEdit(A), editB = readEdit(B);
    const warpB = editB.voice?.warp, warpA = editA.voice?.warp;
    const edits = describeEdit(editA, editB).map((e) => ({ at: e.source === null ? null : mapTime(warpB, e.source, 0, 1), text: e.text }));
    const pictureMayDiffer = A.code !== B.code || A.edit !== B.edit;
    const { rows, total, done, failed } = readRows(a, b);
    let state = "none";
    if (pictureMayDiffer) {
      if (done) state = "done";
      else if (failed) state = "failed";
      else state = startJob(a, b) ? "running" : "no-chrome";
    }
    const sorted = rows.toSorted((p, q) => p.f - q.f), ranges = [];
    let open = null;
    for (const r of sorted) {
      if (!r.n) { open = null; continue; }
      if (open) { open.to = r.f / 30; open.whole ||= !!r.w; } else { open = { from: r.f / 30, to: r.f / 30, whole: !!r.w }; ranges.push(open); }
    }
    return {
      a, b, atA: A.at, atB: B.at, edits, code: A.code !== B.code, sound: soundRanges(A, B, warpA, warpB), assets: assetChanges(A, B),
      picture: { state, failed, done: rows.length, total, ranges, rows: sorted.filter((r) => r.n).map((r) => [r.f, r.w ? 1 : 0, r.b ?? []]) },
    };
  };

  const json = (res, data) => { res.setHeader("content-type", "application/json"); res.setHeader("cache-control", "no-store"); res.end(JSON.stringify(data)); };
  const missing = (res) => { res.statusCode = 404; res.end(); };
  const body = (req) => new Promise((ok, no) => { const parts = []; req.on("data", (d) => parts.push(d)); req.on("end", () => ok(JSON.parse(Buffer.concat(parts).toString("utf8")))); req.on("error", no); });

  const route = async (req, res, url) => {
    if (url === "/versions.json") {
      json(res, { current: current(), before: beforeId(), seen: index.seen, versions: index.versions.map((v) => ({ id: v.id, at: v.at })) });
      return true;
    }
    if (req.method === "POST" && url === "/seen") {
      const { id } = await body(req);
      if (find(id) && id === current() && index.seen !== id) {
        if (index.seen) index.base = index.seen;
        index.seen = id;
        saveIndex();
      }
      res.end("ok");
      return true;
    }
    const before = /^\/before\/([0-9a-f]+)\/(view\.js|edit\.json)?$/.exec(url);
    if (before) {
      const v = find(before[1]);
      if (!v) { missing(res); return true; }
      res.setHeader("cache-control", "max-age=31536000");
      if (before[2] === "view.js") { res.setHeader("content-type", "text/javascript"); res.end(readFileSync(join(CODE, `${v.code}.js`))); }
      else if (before[2] === "edit.json") { res.setHeader("content-type", "application/json"); res.end(readFileSync(join(EDITS, `${v.edit}.json`))); }
      else { res.setHeader("content-type", "text/html; charset=utf-8"); res.end('<!doctype html><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:#000;overflow:hidden}canvas{display:block;width:100%;height:100%}</style><canvas id="gl"></canvas><script type="module" src="view.js"></script>'); }
      return true;
    }
    const pair = /^\/compare(-job)?\/([0-9a-f]+)\/([0-9a-f]+)(?:\/(done|rows|start|finish|fail))?$/.exec(url);
    if (!pair) return false;
    const [, isJob, a, b, step] = pair;
    if (!find(a) || !find(b)) { missing(res); return true; }
    if (!isJob) { json(res, compareResult(a, b)); return true; }
    if (!step) { res.setHeader("content-type", "text/html; charset=utf-8"); res.end(readFileSync(join(here, "compare_job.html"))); return true; }
    if (step === "done") { json(res, readRows(a, b).rows.map((r) => r.f)); return true; }
    const data = await body(req);
    const file = compareFile(a, b);
    if (step === "start") appendFileSync(file, JSON.stringify({ total: data.total }) + "\n");
    if (step === "rows") appendFileSync(file, data.map((r) => JSON.stringify(r) + "\n").join(""));
    if (step === "finish") appendFileSync(file, '{"done":true}\n');
    if (step === "fail") appendFileSync(file, JSON.stringify({ failed: String(data.message).slice(0, 300) }) + "\n");
    send("compare", { a, b });
    if (step === "finish" || step === "fail") { if (job?.a === a && job?.b === b) stopJob(); }
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
    const ctx = await esbuild.context({ absWorkingDir: project, entryPoints: [join(here, "compare_view.ts")], bundle: true, format: "esm", outfile: join(ROOT, "view.js"), logLevel: "silent", write: false, minifyWhitespace: true, minifySyntax: true, plugins: [editAtRuntime, noteBuilt] });
    await ctx.rebuild();
    await ctx.watch();
  };

  return { route, changed, start, current };
};
