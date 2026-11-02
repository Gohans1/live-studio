// Connects a film project to this studio: node init.mjs PROJECT [--dry]
// The film keeps only what is its own, plus three small files that point here. It never holds a copy of the studio,
// so a fix made here reaches every film at once. A project without a film yet starts from the demo's parts.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const COPIES = ["src/live_page.ts", "src/studio.html", "src/versions.mjs", "src/compare_view.ts", "src/compare_job.html"];
const STARTER = ["src/scene.ts", "src/edit.json", "src/timing.ts", "voice_map.py", "voice_edit.py", "sound.py", "make_lite.py", "assets/public", ".gitignore"];
const OLD_MANIFEST = ".live-studio.json"; // left by the time each project held its own copy
const POINTERS = {
  "src/live.mjs": `// Opens this film in the studio, which lives in its own repo: node_modules/live-studio links to it.
import { fileURLToPath } from "node:url";

process.env.LIVE_PROJECT = fileURLToPath(new URL("..", import.meta.url));
await import("live-studio/src/live.mjs");
`,
  "notes_report.py": `"""Reads this film's notes with the studio's report: python notes_report.py [ID ...] [--shot N]"""
import os
import runpy
from pathlib import Path

os.chdir(Path(__file__).resolve().parent)
runpy.run_path("node_modules/live-studio/notes_report.py", run_name="__main__")
`,
  "src/edit.ts": readFileSync(join(HERE, "demo/src/edit.ts"), "utf8"),
};

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const target = args.find((a) => !a.startsWith("--"));
if (!target) { console.log("usage: node init.mjs PROJECT [--dry]"); process.exit(2); }
const PROJECT = resolve(target);
const inProject = (f) => join(PROJECT, f);
const lf = (buf) => buf.toString("utf8").replace(/\r\n/g, "\n");

const git = (...a) => spawnSync("git", a, { cwd: HERE, encoding: "buffer", maxBuffer: 1 << 28 });
const dirty = git("status", "--porcelain").stdout.toString().trim();
if (dirty) { console.error(`commit the studio first, so its history can tell a project's own changes from older studio code:\n${dirty}`); process.exit(1); }
const everCommitted = (file, text) => {
  const log = git("log", "--format=%H", "--", file).stdout.toString().trim().split("\n");
  return log.some((c) => { const r = git("show", `${c}:${file}`); return r.status === 0 && lf(r.stdout) === text; });
};

// Work a project added to its copy must not vanish: stop and say which file, before anything changes
const own = [...COPIES, ...Object.keys(POINTERS)].filter((f) => {
  if (!existsSync(inProject(f))) return false;
  const text = lf(readFileSync(inProject(f)));
  return text !== POINTERS[f] && !everCommitted(f, text);
});
if (own.length) { console.error(`these hold changes the studio never had; move them into the studio first:\n  ${own.join("\n  ")}`); process.exit(1); }

const say = (what, file) => console.log(`${what.padEnd(9)} ${file}`);
const write = (file, text) => { if (!dry) { mkdirSync(dirname(inProject(file)), { recursive: true }); writeFileSync(inProject(file), text); } };

if (!existsSync(inProject("src/scene.ts"))) for (const f of STARTER) {
  if (existsSync(inProject(f))) continue;
  say("starter", f);
  if (!dry) cpSync(join(HERE, "demo", f), inProject(f), { recursive: true });
}

for (const f of COPIES) if (existsSync(inProject(f))) { say("removed", f); if (!dry) rmSync(inProject(f)); }
if (existsSync(inProject(OLD_MANIFEST))) { say("removed", OLD_MANIFEST); if (!dry) rmSync(inProject(OLD_MANIFEST)); }
for (const [f, text] of Object.entries(POINTERS)) { say("pointer", f); write(f, text); }

const pkgFile = inProject("package.json");
const pkg = existsSync(pkgFile) ? JSON.parse(readFileSync(pkgFile, "utf8")) : { private: true, type: "module", dependencies: { esbuild: "0.28.1", three: "0.186.1" } };
pkg.dependencies = { ...pkg.dependencies, "live-studio": `file:${relative(PROJECT, HERE).replace(/\\/g, "/")}` };
say("linked", `live-studio -> ${pkg.dependencies["live-studio"]}`);
write("package.json", JSON.stringify(pkg, null, 2) + "\n");
if (!dry && !existsSync(inProject("node_modules/live-studio"))) {
  const r = spawnSync("npm", ["install", "--no-audit", "--no-fund"], { cwd: PROJECT, stdio: "inherit", shell: process.platform === "win32" });
  if (r.status) process.exit(r.status);
}
console.log(dry ? "nothing changed" : "done: node src/live.mjs");
