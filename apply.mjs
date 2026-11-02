// Puts the studio into a film project, or brings a project's copy up to date: node apply.mjs PROJECT [--init] [--dry]
// The project owns its copy and may change it. Updates are a three-way merge against the commit it last took (.live-studio.json),
// so its own changes survive and a real clash leaves its file untouched.
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const STUDIO = ["src/live.mjs", "src/live_page.ts", "src/studio.html", "src/edit.ts", "notes_report.py"];
// A film's own parts: the demo's versions are only a starting point, and are never written over anything
const STARTER = [".gitignore", "package.json", "src/scene.ts", "src/edit.json", "src/timing.ts", "voice_map.py", "voice_edit.py", "sound.py", "make_lite.py", "assets/public/agent/full_voice.wav", "assets/public/agent/sfx2/.gitkeep", "assets/public/agent/sfx_try/.gitkeep"];
const MANIFEST = ".live-studio.json";
const SOURCE = "https://github.com/Gohans1/live-studio";

const args = process.argv.slice(2);
const init = args.includes("--init"), dry = args.includes("--dry");
const target = args.find((a) => !a.startsWith("--"));
if (!target) { console.log("usage: node apply.mjs PROJECT [--init] [--dry]"); process.exit(2); }
const PROJECT = resolve(target);

const git = (...a) => {
  const r = spawnSync("git", a, { cwd: HERE, encoding: "buffer", maxBuffer: 1 << 28 });
  if (r.status) { console.error(`git ${a.join(" ")}: ${r.stderr}`); process.exit(1); }
  return r.stdout;
};
const lf = (buf) => buf.toString("utf8").replace(/\r\n/g, "\n");
const at = (commit, file) => lf(git("show", `${commit}:${file}`));

const head = git("rev-parse", "HEAD").toString().trim();
const dirty = git("status", "--porcelain", "--", ...STUDIO).toString().trim();
if (dirty) { console.error(`commit the studio first, a project must record what it took:\n${dirty}`); process.exit(1); }

const manifestFile = join(PROJECT, MANIFEST);
const base = existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, "utf8")).commit : head;
if (!existsSync(join(PROJECT, "src/scene.ts")) && !init) { console.error(`${PROJECT} has no src/scene.ts: add --init to start it from the demo`); process.exit(1); }

const put = (file, text, crlf) => {
  if (dry) return;
  mkdirSync(dirname(join(PROJECT, file)), { recursive: true });
  writeFileSync(join(PROJECT, file), crlf ? text.replace(/\n/g, "\r\n") : text);
};
const merge = (ours, older, theirs) => {
  const dir = mkdtempSync(join(tmpdir(), "live-studio-"));
  try {
    const [a, b, c] = ["ours", "base", "theirs"].map((n) => join(dir, n));
    writeFileSync(a, ours); writeFileSync(b, older); writeFileSync(c, theirs);
    const r = spawnSync("git", ["merge-file", "-p", a, b, c], { encoding: "utf8", maxBuffer: 1 << 28 });
    return r.status === 0 ? r.stdout : null;
  } finally { rmSync(dir, { recursive: true, force: true }); }
};

let clashes = 0;
for (const file of STUDIO) {
  const theirs = lf(git("show", `HEAD:${file}`));
  const path = join(PROJECT, file);
  if (!existsSync(path)) { put(file, theirs); console.log(`added      ${file}`); continue; }
  const raw = readFileSync(path), ours = lf(raw), crlf = raw.includes("\r\n");
  const older = at(base, file);
  if (ours === theirs) console.log(`same       ${file}`);
  else if (ours === older) { put(file, theirs, crlf); console.log(`updated    ${file}`); }
  else if (theirs === older) console.log(`own change ${file} (kept)`);
  else {
    const merged = merge(ours, older, theirs);
    if (merged === null) { clashes++; console.log(`CLASH      ${file}: left as it is, merge it by hand`); } else { put(file, merged, crlf); console.log(`merged     ${file} (own change kept)`); }
  }
}
if (init) for (const file of STARTER) {
  if (existsSync(join(PROJECT, file))) continue;
  if (!dry) { mkdirSync(dirname(join(PROJECT, file)), { recursive: true }); copyFileSync(join(HERE, file), join(PROJECT, file)); }
  console.log(`starter    ${file}`);
}
if (clashes) { console.log(`${clashes} file(s) clashed: ${MANIFEST} keeps the old commit, so this can be run again`); process.exit(1); }
if (!dry) writeFileSync(manifestFile, JSON.stringify({ source: SOURCE, commit: head }, null, 1) + "\n");
console.log(`${dry ? "would take" : "took"} ${head.slice(0, 7)}`);
