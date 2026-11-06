// Draft renders of any film, from inside the film: node node_modules/live-studio/render.mjs [stills|clip]   (none: both)
// Builds the film with the studio's own bundler (src/vite_film.mjs, the same build the studio page uses), opens it in a
// headless Chrome on the GPU, and writes what the page sends back: stills to renders/, the film as 30 s H.264 chunks to
// renders/chunks/, joined losslessly into renders/draft_video.mp4. Nothing is written on any other drive.
//   AT=40,41.5                 stills at these heard seconds (default 1), named still_<s>s.jpg
//   NOLIST=1                   without the list of what is going on (draw.describe), to judge the picture itself
//   CHUNKS=3,4                 re-render only those chunks (0-based: 3 is 1:30-2:00) and join them with the ones already there
//   INSPECT=px,py,pz,lx,ly,lz,fov  every still from this one fixed camera (the studio's free camera) instead of the film's
//   CHECK=slide:0,108;trace:50,51,0.1  run the film's draw.checks.slide(0, 108) etc. and print the lines they return
//   ENTRY=lab/prop.ts          run a page of the film's own instead (it imports "live-studio/lab"); LAB_VIEW=desk reaches it as cfg.lab.view
// The film's package.json "live-studio": { "chrome": path } names its headless Chrome (default tools/chrome-headless-shell/...).
import { spawn, spawnSync } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { build } from "vite";
import { STUDIO, threeFromOf } from "./src/film.mjs";
import { filmPlugin } from "./src/vite_film.mjs";

const what = process.argv[2] ?? "all";
if (!["all", "stills", "clip"].includes(what)) { console.log("usage: node node_modules/live-studio/render.mjs [stills|clip]"); process.exit(2); }
const PROJECT = resolve(process.env.LIVE_PROJECT ?? process.cwd());
if (!existsSync(join(PROJECT, "src/scene.ts"))) { console.error(`${PROJECT} has no src/scene.ts: run this inside a film`); process.exit(1); }
const FPS = 30, CHUNK = 30;
const RENDERS = join(PROJECT, "renders"), CHUNKS = join(RENDERS, "chunks"), OUT = join(PROJECT, "node_modules/.vite/live-studio-render");
const pkg = existsSync(join(PROJECT, "package.json")) ? JSON.parse(readFileSync(join(PROJECT, "package.json"), "utf8")) : {};
const CHROME = join(PROJECT, pkg["live-studio"]?.chrome ?? "tools/chrome-headless-shell/chrome-headless-shell.exe");
if (!existsSync(CHROME)) { console.error(`no headless Chrome at ${CHROME}: name it in package.json "live-studio": { "chrome": "..." }`); process.exit(1); }
const numbers = (s) => s.split(",").map(Number);
const env = process.env;
const choicesFile = ["choices.json", "sound_choices.json"].map((f) => join(PROJECT, f)).find(existsSync);

const cfg = {
  W: 1280, H: 720, draft: true, quality: 0.9,
  stills: what === "clip" ? [] : numbers(env.AT ?? "1").map((s) => ({ name: `still_${s}s.jpg`, frame: Math.round(s * FPS) })),
  clip: what === "stills" ? null : { chunk: CHUNK, only: env.CHUNKS ? numbers(env.CHUNKS) : null, samples: 1, bitrate: 4e6 },
  list: !env.NOLIST,
  inspect: env.INSPECT ? numbers(env.INSPECT) : null,
  checks: (env.CHECK ?? "").split(";").filter(Boolean).map((c) => { const [name, args = ""] = c.split(":"); return [name.trim(), args ? numbers(args) : []]; }),
  choices: choicesFile ? JSON.parse(readFileSync(choicesFile, "utf8")) : {},
  lab: Object.fromEntries(Object.entries(env).filter(([k]) => k.startsWith("LAB_")).map(([k, v]) => [k.slice(4).toLowerCase(), v])),
};

// ---------- The page: the studio's render page, or the film's own lab page, built with the film inside
const entry = env.ENTRY ? resolve(PROJECT, env.ENTRY) : join(STUDIO, "render/page.ts");
const t0 = Date.now();
await build({
  configFile: false,
  root: join(STUDIO, "render"),
  publicDir: false, // the film's assets are served from where they are, never copied
  logLevel: "error",
  plugins: [filmPlugin({ SRC: join(PROJECT, "src"), threeFrom: threeFromOf(PROJECT) })],
  build: {
    outDir: OUT, emptyOutDir: true, minify: false, reportCompressedSize: false, chunkSizeWarningLimit: Infinity,
    rolldownOptions: { input: entry, output: { entryFileNames: "page.js", chunkFileNames: "_render/[name]-[hash].js", assetFileNames: "_render/[name]-[hash][extname]" } },
  },
});
console.log(`built in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

// ---------- Serve it to a headless Chrome and keep what it posts back
mkdirSync(CHUNKS, { recursive: true });
const MIME = { ".js": "text/javascript", ".json": "application/json", ".wasm": "application/wasm", ".png": "image/png", ".jpg": "image/jpeg", ".glb": "model/gltf-binary" }; // wasm: instantiateStreaming refuses anything else
const chunkFile = (i) => join(CHUNKS, `c${String(i).padStart(2, "0")}.mp4`);
const body = (req) => new Promise((done) => { const c = []; req.on("data", (d) => c.push(d)); req.on("end", () => done(Buffer.concat(c))); });
let finish, failed = false, chunks = null;
const finished = new Promise((done) => { finish = done; });
const server = createServer(async (req, res) => {
  const url = decodeURIComponent(req.url.split("?")[0]);
  if (req.method === "POST") {
    const b = await body(req);
    if (url === "/log") { const m = b.toString(); console.log(m); if (m.startsWith("ERROR")) { failed = true; finish(); } }
    else if (url.startsWith("/still/")) writeFileSync(join(RENDERS, url.slice(7)), b);
    else if (url.startsWith("/chunk/")) writeFileSync(chunkFile(+url.slice(7)), b);
    else if (url === "/done") { chunks = b.length ? +b.toString() : null; finish(); }
    res.end("ok");
    return;
  }
  // The classic script reports errors thrown while the module's imports evaluate, before the page's own handlers exist
  if (url === "/") { res.setHeader("content-type", "text/html"); res.end('<!doctype html><canvas id="gl"></canvas><script>onerror = (m, s, l, c, e) => { fetch("/log", { method: "POST", body: "ERROR " + (e && e.stack || m) }); };</script><script type="module" src="/page.js"></script>'); return; }
  if (url === "/config") { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(cfg)); return; }
  const file = url === "/page.js" || url.startsWith("/_render/") ? join(OUT, url) : join(PROJECT, "assets/public", url);
  if (!existsSync(file)) { res.statusCode = 404; res.end(); return; }
  res.setHeader("content-type", MIME[extname(file)] ?? "application/octet-stream");
  createReadStream(file).pipe(res);
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const profile = join(tmpdir(), `live_render_${process.pid}`);
mkdirSync(profile, { recursive: true });
const chrome = spawn(CHROME, ["--headless", "--use-gl=angle", "--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--disable-gpu-vsync", "--disable-frame-rate-limit", "--no-first-run", "--disable-background-timer-throttling", "--disable-renderer-backgrounding", `--user-data-dir=${profile}`, `http://127.0.0.1:${server.address().port}/`], { stdio: "ignore" });
// A page that dies before saying it is done would otherwise leave this waiting forever
const limit = setTimeout(() => { console.log("ERROR no answer from the page after an hour"); failed = true; finish(); }, 3600e3);
await finished;
clearTimeout(limit);
chrome.kill();
server.close();
server.closeAllConnections?.();
try { rmSync(profile, { recursive: true, force: true }); } catch { /* Chrome may still hold it for a moment */ }
console.log(`render ${what}: ${((Date.now() - t0) / 1000).toFixed(1)}s`);

// Every chunk starts on a keyframe with the same encoder settings, so the join is a lossless stream copy
if (!failed && chunks) {
  const all = Array.from({ length: chunks }, (_, i) => chunkFile(i));
  const missing = all.filter((f) => !existsSync(f));
  if (missing.length) console.log(`not joined, chunks missing: ${missing.join(", ")}`);
  else {
    writeFileSync(join(CHUNKS, "list.txt"), all.map((f) => `file '${f.replace(/\\/g, "/")}'`).join("\n"));
    const j = spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", join(CHUNKS, "list.txt"), "-c", "copy", join(RENDERS, "draft_video.mp4")], { stdio: "inherit" });
    console.log(j.status === 0 ? "joined renders/draft_video.mp4" : "ERROR join failed");
    if (j.status) failed = true;
  }
}
process.exit(failed ? 1 : 0);
