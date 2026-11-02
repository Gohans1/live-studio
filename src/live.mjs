// Live viewer: node src/live.mjs [port], then open http://localhost:4321
// Saving scene.ts or anything it imports reloads the picture at the same second; saving sound.py or an audio file remixes.
import { execFileSync, spawn } from "node:child_process";
import { appendFileSync, copyFileSync, createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, watch, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { brotliCompressSync, constants as zlibConsts, gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { networkInterfaces } from "node:os";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import { createVersions, readJson } from "./versions.mjs";

const here = dirname(fileURLToPath(import.meta.url));
// The film being opened: its launcher says so, or the folder this runs in. Everything of the film's is under here, everything in this file's folder is the studio's.
const PROJECT = resolve(process.env.LIVE_PROJECT ?? process.cwd());
const SRC = join(PROJECT, "src");
if (!existsSync(join(SRC, "scene.ts"))) { console.error(`${PROJECT} has no src/scene.ts: run this inside a film, or try npm run demo`); process.exit(1); }
// One copy of three: the film's and the studio's would each otherwise bring their own, and objects from one fail instanceof in the other
const THREE_FROM = existsSync(join(PROJECT, "node_modules/three")) ? PROJECT : here;
// Asked for by name from that folder, not an alias to its path: an alias skips three's exports map, and three/addons, three/webgpu and three/tsl stop resolving
const oneThree = { name: "one-three", setup(b) { b.onResolve({ filter: /^three(\/|$)/ }, (args) => (args.pluginData?.oneThree ? undefined : b.resolve(args.path, { kind: args.kind, resolveDir: THREE_FROM, pluginData: { oneThree: true } }))); } };
const ALIAS = { film: SRC, "live-studio/edit": join(here, "edit.ts") };
const VENV_PYTHON = join(PROJECT, process.platform === "win32" ? ".venv/Scripts/python.exe" : ".venv/bin/python");
const PYTHON = existsSync(VENV_PYTHON) ? VENV_PYTHON : process.platform === "win32" ? "python" : "python3";
const PUBLIC = join(PROJECT, "assets/public");
const WORK = join(PROJECT, "renders/live");
const MIX = join(WORK, "mix_dry.wav"); // without the sounds being tried: the page plays those itself
const MIX_SMALL = join(WORK, "mix_small.webm"); // the same mix for anything but this machine: a fifteenth of the size, and Opus stays on the clock where mp3 ran up to 30ms off
const LITE = join(WORK, "lite"); // small copies of the assets, see make_lite.py
const TRIALS = join(WORK, "trials.json");
const EDIT = join(SRC, "edit.json");
const CHOICES = join(PROJECT, "sound_choices.json");
const PORT = Number(process.argv[2]) || 4321;
mkdirSync(WORK, { recursive: true });
const MIME = { ".gltf": "application/json", ".glb": "model/gltf-binary", ".jpg": "image/jpeg", ".png": "image/png", ".bin": "application/octet-stream", ".js": "text/javascript", ".wav": "audio/wav", ".webm": "audio/webm" };
// Text and geometry shrink a lot and pictures don't. Squeezed once per version, so the next visit costs nothing here either
const packed = new Map();
const squeeze = (req, res, buf, tag) => {
  const accepts = req.headers["accept-encoding"] ?? "", how = /\bbr\b/.test(accepts) ? "br" : /gzip/.test(accepts) ? "gzip" : "";
  res.setHeader("vary", "accept-encoding");
  if (!how) return buf;
  const key = how + tag;
  if (!packed.has(key)) {
    if (packed.size > 400) packed.clear();
    packed.set(key, how === "br" ? brotliCompressSync(buf, { params: { [zlibConsts.BROTLI_PARAM_QUALITY]: 9 } }) : gzipSync(buf));
  }
  res.setHeader("content-encoding", how);
  return packed.get(key);
};
// Unchanged means no download, and asking costs a few bytes
const sendText = (req, res, buf) => {
  const tag = `"${createHash("md5").update(buf).digest("base64url")}"`;
  res.setHeader("etag", tag);
  res.setHeader("cache-control", "no-cache");
  if (req.headers["if-none-match"] === tag) { res.statusCode = 304; res.end(); return; }
  res.end(squeeze(req, res, buf, tag));
};
let smallMixing = null;
const smallMix = () => {
  if (existsSync(MIX_SMALL) && statSync(MIX_SMALL).mtimeMs >= statSync(MIX).mtimeMs) return Promise.resolve();
  // Made beside it and swapped in whole: a phone may be halfway through downloading the old one
  const fresh = MIX_SMALL + ".new.webm";
  return (smallMixing ??= new Promise((done) => spawn("ffmpeg", ["-v", "error", "-y", "-i", MIX, "-ac", "1", "-c:a", "libopus", "-b:a", "48k", fresh], { stdio: "inherit" }).on("error", (e) => console.log("ffmpeg is needed for the small mix:", e.message)).on("close", async (code) => { if (!code) await swapIn(fresh, MIX_SMALL); smallMixing = null; done(); })));
};

let bundle = "";
const clients = new Set();
const send = (event, data = "") => { for (const c of clients) c.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };
const versions = createVersions({ project: PROJECT, here, alias: ALIAS, plugins: [oneThree], port: PORT, send, esbuild, squeeze, mixFile: MIX, editFile: EDIT, assetsDir: PUBLIC });

// Notes spoken in the studio: one JSON object per line, so an AI agent can read them. Pictures sit beside them in notes/img
const NOTES = join(PROJECT, "notes/notes.jsonl");
const NOTE_IMG = join(PROJECT, "notes/img");
mkdirSync(dirname(NOTES), { recursive: true });
mkdirSync(NOTE_IMG, { recursive: true });
if (!existsSync(NOTES)) writeFileSync(NOTES, "");
// Notes are an hour of someone's work: one bad line can't hide the rest, a crash mid-write can't cut the file, and copies pile up on the other drive
const parseNotes = (file) => (existsSync(file) ? readFileSync(file, "utf8") : "").split("\n").filter((l) => l.trim()).flatMap((l) => { try { return [JSON.parse(l)]; } catch { console.error("bad note line kept in backups:", l); return []; } });
const readNotes = () => parseNotes(NOTES);
const DELETED = join(PROJECT, "notes/deleted.jsonl"); // × only moves a note here
const BACKUPS = join(PROJECT, "renders/notes_backup"); // renders is on E:
mkdirSync(BACKUPS, { recursive: true });
let backedUp = 0;
const backupNotes = () => {
  if (Date.now() - backedUp < 5 * 60e3 || !existsSync(NOTES) || !statSync(NOTES).size) return; // gone is no reason to refuse the next note
  backedUp = Date.now();
  copyFileSync(NOTES, join(BACKUPS, `notes-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`));
};
const writeNotes = (a) => {
  backupNotes();
  const fresh = `${NOTES}.new`;
  writeFileSync(fresh, a.map((n) => JSON.stringify(n) + "\n").join(""), { flush: true });
  for (let i = 0; ; i++) {
    try { renameSync(fresh, NOTES); return; } // Windows refuses while something is reading it
    catch (e) { if (i >= 20) throw e; Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50); }
  }
};

const readChoices = () => (existsSync(CHOICES) ? JSON.parse(readFileSync(CHOICES, "utf8")) : {});

const VOICE_MAP = join(WORK, "voice_map.json");
const VOICE = join(PUBLIC, "agent/full_voice.wav");
let mapping = false;
const mapVoice = () => {
  if (mapping) return;
  mapping = true;
  const p = spawn(PYTHON, ["voice_map.py", VOICE_MAP], { cwd: PROJECT, stdio: ["ignore", "pipe", "inherit"] });
  p.stdout.on("data", () => send("voice"));
  p.on("close", (code) => { mapping = false; if (code) console.log("voice map failed"); else if (!Object.keys(JSON.parse(readFileSync(EDIT, "utf8")).voice.edits).length) editVoice(); });
};

const shotComments = () => {
  const s = readFileSync(join(SRC, "scene.ts"), "utf8").replace(/\r/g, "");
  return s.slice(s.indexOf("export const SHOTS = ["), s.indexOf("];\nexport let DURATION")).split("\n").slice(1).filter((l) => l.trim()).map((l) => l.match(/\/\/ (.*)$/)?.[1] ?? "");
};

// Windows won't replace a file someone is still reading. A mix swaps in by cutting its readers off: the page fetches the new one right after
const readers = new Set();
const streamFile = (file, res, range) => {
  const s = createReadStream(file, range), me = { file, stop: () => { s.destroy(); res.destroy(); } };
  readers.add(me);
  s.on("error", () => res.destroy());
  s.on("close", () => readers.delete(me));
  res.on("close", () => s.destroy());
  s.pipe(res);
};
const swapIn = async (fresh, target) => {
  for (let i = 0; i < 50; i++) {
    for (const r of readers) if (r.file === target) r.stop();
    try { renameSync(fresh, target); return true; } catch { await new Promise((done) => setTimeout(done, 100)); }
  }
  console.log("could not replace", target);
  return false;
};
// No password here, so nothing but this machine and names the film lists may even ask. A website can point its own name at this machine (DNS rebinding) or post to it from the visitor's browser.
// The list stays in the film: a machine's private name has no place in this public repo
const HOSTS_FILE = join(PROJECT, ".live_hosts");
const EXTRA_HOSTS = (existsSync(HOSTS_FILE) ? readFileSync(HOSTS_FILE, "utf8") : "").split(/\s+/).filter(Boolean).map((n) => n.toLowerCase());
const knownHost = (host) => { const n = (host ?? "").replace(/:\d+$/, "").toLowerCase(); return n === "localhost" || n === "[::1]" || /^\d+\.\d+\.\d+\.\d+$/.test(n) || EXTRA_HOSTS.includes(n); };
const fromElsewhere = (req) => { try { return !!req.headers.origin && new URL(req.headers.origin).host !== req.headers.host; } catch { return true; } };
const inside = (root, file) => { const r = relative(root, file); return r && !r.startsWith("..") && !isAbsolute(r); };

const handle = async (req, res) => {
  if (!knownHost(req.headers.host) || (req.method !== "GET" && fromElsewhere(req))) { res.statusCode = 403; res.end(); return; }
  const url = decodeURIComponent(req.url.split("?")[0]);
  if (url === "/favicon.ico") { res.statusCode = 204; res.end(); return; }
  if (await versions.route(req, res, url)) return;
  if (url === "/") { res.setHeader("content-type", "text/html; charset=utf-8"); sendText(req, res, readFileSync(join(here, "studio.html"))); return; }
  if (url === "/notes.json") { res.setHeader("content-type", "application/json"); res.setHeader("cache-control", "no-store"); res.end(JSON.stringify(readNotes())); return; }
  if (url === "/voice_map.json") {
    if (!existsSync(VOICE_MAP)) { res.statusCode = 404; res.end(); return; }
    res.setHeader("content-type", "application/json"); res.setHeader("cache-control", "no-store"); sendText(req, res, readFileSync(VOICE_MAP)); return;
  }
  if (url === "/edit.json") { res.setHeader("content-type", "application/json"); sendText(req, res, readFileSync(EDIT)); return; }
  // The studio only looks and takes notes; a page still open from before can't write its old copy back
  if (req.method === "POST" && url === "/edit") { res.statusCode = 403; res.end(); return; }
  if (url === "/trials.json") {
    if (!existsSync(TRIALS)) { res.statusCode = 404; res.end(); return; }
    const trials = JSON.parse(readFileSync(TRIALS, "utf8"));
    const chosen = readChoices();
    for (const g in trials) trials[g].chosen = chosen[g] ?? null;
    res.setHeader("content-type", "application/json"); sendText(req, res, Buffer.from(JSON.stringify(trials))); return;
  }
  if (req.method === "POST" && url === "/choose") {
    const { group, set, gain } = await readJson(req);
    writeFileSync(CHOICES, JSON.stringify({ ...readChoices(), [group]: { set, gain } }, null, 1) + "\n");
    res.end("ok");
    return;
  }
  if (req.method === "POST" && url === "/notes") {
    try {
      const { note, img, crop, strip } = await readJson(req);
      if (!/^[a-z0-9]+$/.test(note.id)) { res.statusCode = 400; res.end(); return; }
      note.img = img ? `notes/img/${note.id}.jpg` : undefined;
      if (img) writeFileSync(join(NOTE_IMG, `${note.id}.jpg`), Buffer.from(img.split(",")[1], "base64"));
      for (const [kind, pic] of [["crop", crop], ["strip", strip]]) {
        if (!pic) continue;
        note[kind] = `notes/img/${note.id}_${kind}.jpg`;
        writeFileSync(join(NOTE_IMG, `${note.id}_${kind}.jpg`), Buffer.from(pic.split(",")[1], "base64"));
      }
      // Which version of the film this was said about
      try { note.version = execFileSync("git", ["describe", "--tags", "--always", "--dirty"], { cwd: PROJECT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch {}
      note.film = versions.current() ?? undefined; // works without git too: renders/versions/index.json says what this version was
      const all = readNotes();
      if (!all.some((n) => n.id === note.id)) writeNotes([...all, note]); // a retry after a lost answer isn't a second note
      res.end("ok");
    } catch (e) { console.error("note not saved:", e); res.statusCode = 500; res.end(); } // the page keeps it and tries again
    return;
  }
  const noteRoute = req.method === "POST" && /^\/notes\/([a-z0-9]+)$/.exec(url);
  if (noteRoute) {
    try {
      const change = await readJson(req);
      const all = readNotes();
      let n = all.find((x) => x.id === noteRoute[1]);
      if (n && change.remove) {
        appendFileSync(DELETED, JSON.stringify(n) + "\n", { flush: true });
        writeNotes(all.filter((x) => x !== n));
      } else if (change.restore) {
        const gone = parseNotes(DELETED);
        if (!n) { n = gone.findLast((x) => x.id === noteRoute[1]); if (n) all.push(n); }
        if (n && typeof change.text === "string") n.text = change.text;
        writeNotes(all);
        writeFileSync(DELETED, gone.filter((x) => x.id !== noteRoute[1]).map((x) => JSON.stringify(x) + "\n").join(""));
      } else if (n && change.fix) { // answered: stays as history with what was done
        n.done = true;
        n.fixes = [...(n.fixes ?? []), { ...change.fix, at: new Date().toISOString() }];
        writeNotes(all);
      } else if (n && typeof change.text === "string") { // changed words are open again, and what they said stays on record
        if (change.text !== n.text) n.edits = [...(n.edits ?? []), { at: new Date().toISOString(), was: n.text }];
        n.text = change.text;
        n.done = false;
        writeNotes(all);
      } else if (n) { n.done = !!change.done; writeNotes(all); }
      res.end("ok");
    } catch (e) { console.error("note change not saved:", e); res.statusCode = 500; res.end(); }
    return;
  }
  if (url === "/events") { res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store" }); res.write("\n"); clients.add(res); req.on("close", () => clients.delete(res)); return; }
  if (url === "/shots.json") { res.setHeader("content-type", "application/json"); sendText(req, res, Buffer.from(JSON.stringify(shotComments()))); return; }
  // Held whole in memory: a page loading while a save rebuilds must never get half a file
  if (url === "/live_page.js") { res.setHeader("content-type", "text/javascript"); sendText(req, res, bundle); return; }
  const notePic = /^\/note-img\/([a-z0-9]+)\.jpg$/.exec(url);
  if (notePic) {
    const pic = join(NOTE_IMG, `${notePic[1]}.jpg`);
    if (!existsSync(pic)) { res.statusCode = 404; res.end(); return; }
    res.setHeader("content-type", "image/jpeg");
    res.setHeader("cache-control", "max-age=31536000");
    res.end(readFileSync(pic));
    return;
  }
  if (url === "/mix_small.webm") await smallMix();
  const lite = url.startsWith("/lite/");
  const file = url === "/mix.wav" ? MIX : url === "/mix_small.webm" ? MIX_SMALL : lite ? join(LITE, url.slice(5)) : join(PUBLIC, url);
  if ((file !== MIX && file !== MIX_SMALL && !inside(lite ? LITE : PUBLIC, file)) || !existsSync(file) || statSync(file).isDirectory()) { res.statusCode = 404; res.end(); return; }
  const { size, mtimeMs } = statSync(file);
  res.setHeader("content-type", MIME[extname(file)] ?? "application/octet-stream");
  res.setHeader("accept-ranges", "bytes");
  if (url === "/mix.wav") res.setHeader("cache-control", "no-store");
  else {
    // A reload on a phone must not fetch the room again
    const tag = `"${size}-${Math.round(mtimeMs)}"`;
    res.setHeader("etag", tag);
    res.setHeader("cache-control", "no-cache"); // unchanged means no download, and a re-made copy shows up at once
    if (req.headers["if-none-match"] === tag && !req.headers.range) { res.statusCode = 304; res.end(); return; }
    if (lite && /\.(bin|glb|gltf)$/.test(file) && !req.headers.range) { res.end(squeeze(req, res, readFileSync(file), tag)); return; }
  }
  // Seeking in the sound needs byte ranges
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? "");
  if (m) {
    const a = m[1] ? +m[1] : 0, b = m[2] ? Math.min(+m[2], size - 1) : size - 1;
    if (a > b) { res.writeHead(416, { "content-range": `bytes */${size}` }); res.end(); return; } // a page still reading past the end of a mix that got shorter
    res.writeHead(206, { "content-range": `bytes ${a}-${b}/${size}`, "content-length": b - a + 1 });
    streamFile(file, res, { start: a, end: b });
    return;
  }
  res.setHeader("content-length", size);
  streamFile(file, res);
};
// One bad request must not take the studio down with it
const server = createServer((req, res) => handle(req, res).catch((e) => { console.log(`${req.method} ${req.url}: ${e.message}`); if (!res.headersSent) res.statusCode = 400; res.end(); }));

let mixing = false, again = false;
const remix = () => {
  if (mixing) { again = true; return; }
  mixing = true;
  send("sound-start");
  const t0 = Date.now();
  // Written beside the old mix and swapped in whole, so a page playing it never reads a half-written file
  const fresh = MIX + ".new.wav";
  spawn(PYTHON, ["sound.py", fresh, "--dry"], { cwd: PROJECT, stdio: "inherit" }).on("close", async (code) => {
    if (!code) await swapIn(fresh, MIX);
    mixing = false;
    console.log(code ? "sound mix failed" : `sound mixed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    if (!code) { send("sound"); versions.changed(); }
    if (again) { again = false; remix(); }
  });
};
// A paced voice moves everything after it: work out where the words land, tell the film, then mix
let voicing = false, voiceAgain = false;
const editVoice = () => {
  if (voicing) { voiceAgain = true; return; }
  voicing = true;
  send("sound-start");
  const p = spawn(PYTHON, ["voice_edit.py"], { cwd: PROJECT, stdio: ["ignore", "pipe", "inherit"] });
  let out = "";
  p.stdout.on("data", (d) => { out += d; });
  p.on("close", (code) => {
    voicing = false;
    if (code) { console.log("voice edit failed"); return; }
    let now, paced;
    try { now = JSON.parse(readFileSync(EDIT, "utf8")); paced = JSON.parse(out); } catch { console.log("voice edit: the edit file was mid-save, trying again"); setTimeout(editVoice, 500); return; }
    // Written only when pacing really moved, or a file already right would be reformatted and read as a change
    if (Object.keys(paced).some((k) => JSON.stringify(now.voice[k]) !== JSON.stringify(paced[k]))) {
      Object.assign(now.voice, paced);
      writeFileSync(EDIT, JSON.stringify(now, null, 0));
    }
    if (voiceAgain) { voiceAgain = false; editVoice(); return; }
    remix();
  });
};
const debounce = (f, ms) => { let h; return (...a) => { clearTimeout(h); h = setTimeout(() => f(...a), ms); }; };
// Windows can report a file as changed just because something read it, and every remix restarts the sound on every open page:
// what counts is whether anything's size or time really moved
const stamp = (p) => { const s = statSync(p); return s.isDirectory() ? readdirSync(p).map((n) => n + stamp(join(p, n))).join() : `:${s.size}:${s.mtimeMs}`; };
const soundFiles = [join(PROJECT, "sound.py"), join(SRC, "timing.ts"), join(PUBLIC, "agent/sfx2"), join(PUBLIC, "agent/sfx_try")].filter((f) => existsSync(f));
const stamps = () => soundFiles.map(stamp).join();
let soundsSeen = stamps();
const soundsChanged = debounce(() => { const now = stamps(); if (now !== soundsSeen) { soundsSeen = now; remix(); } }, 300);
for (const f of soundFiles) watch(f, { recursive: statSync(f).isDirectory() }, soundsChanged);
if (!existsSync(MIX) || !existsSync(TRIALS)) remix();
// Windows can report a file as changed just because something read it: only a new take is worth a Whisper run
if (existsSync(VOICE)) {
  let voiceSeen = statSync(VOICE).mtimeMs;
  watch(VOICE, debounce(() => { const now = statSync(VOICE).mtimeMs; if (now !== voiceSeen) { voiceSeen = now; remix(); mapVoice(); } }, 500));
  if (!existsSync(VOICE_MAP) || statSync(VOICE_MAP).mtimeMs < statSync(VOICE).mtimeMs) mapVoice();
}
if (!existsSync(LITE)) spawn(PYTHON, ["make_lite.py"], { cwd: PROJECT, stdio: "inherit" });
if (existsSync(PUBLIC)) watch(PUBLIC, { recursive: true }, debounce(() => versions.changed(), 500));
watch(NOTES, debounce(() => send("notes"), 100)); // Claude ticking a note off shows up here too
watch(join(here, "studio.html"), debounce(() => send("code"), 100));
// Voice edits are made in the file: the voice and the mix follow it
const voiceEdits = () => { try { return JSON.stringify(JSON.parse(readFileSync(EDIT, "utf8")).voice.edits); } catch { return null; } };
let editsSeen = voiceEdits();
watch(EDIT, debounce(() => { send("edit"); versions.changed(); const now = voiceEdits(); if (now !== null && now !== editsSeen) { editsSeen = now; editVoice(); } }, 100));

// The edit file is read fresh by the page, so saving it must not reload the page: esbuild isn't told to watch it
const editOutsideWatch = {
  name: "edit-outside-watch",
  setup(b) {
    b.onResolve({ filter: /\/edit\.json$/ }, () => ({ path: "edit.json", namespace: "edit-file" }));
    b.onLoad({ filter: /.*/, namespace: "edit-file" }, () => ({ contents: readFileSync(EDIT, "utf8"), loader: "json" }));
  },
};
const notify = {
  name: "notify",
  setup(b) {
    b.onEnd((r) => {
      if (r.errors.length) { const m = r.errors.map((e) => `${e.location?.file}:${e.location?.line} ${e.text}`).join("\n"); console.log(m); send("error-build", m); if (!bundle) bundle = `throw new Error(${JSON.stringify(m)})`; } else { bundle = r.outputFiles[0].contents; send("code"); console.log("built"); }
    });
  },
};
const ctx = await esbuild.context({
  absWorkingDir: PROJECT, entryPoints: [join(here, "live_page.ts")], alias: ALIAS, bundle: true, format: "esm", outfile: join(WORK, "live_page.js"), logLevel: "silent", write: false, minifyWhitespace: true, minifySyntax: true,
  plugins: [oneThree, editOutsideWatch, notify],
});
await ctx.rebuild().catch(() => {}); // notify has it: the page says what's wrong and comes up when it's fixed
await ctx.watch();
await versions.start();
// This machine only, unless asked: --lan opens it to the network for a phone, and nothing here asks for a password
const LAN = process.argv.includes("--lan");
server.listen(PORT, LAN ? "0.0.0.0" : "127.0.0.1", () => {
  console.log(`live at http://localhost:${PORT}`);
  if (LAN) for (const nets of Object.values(networkInterfaces())) for (const n of nets) if (n.family === "IPv4" && !n.internal) console.log(`on the phone: http://${n.address}:${PORT}`);
});
