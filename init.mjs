// Connects a film project to this studio: node init.mjs PROJECT [--dry]
// The film keeps only what is its own, plus four package.json scripts that point here (bun run studio, notes, note, render).
// It never holds a copy of the studio, so a fix made here reaches every film at once. What a project lacks comes from the demo,
// and nothing it already has is overwritten (its src/edit.ts may merge files of its own).
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const STARTER = ["src/scene.ts", "src/edit.ts", "src/edit.json", "voice_map.py", "sound.py", "assets/public", ".gitignore"];
// What the film used to hold to reach the studio; package.json scripts do it now (bun run studio, notes, note, render)
const OLD_POINTERS = {
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
};

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const target = args.find((a) => !a.startsWith("--"));
if (!target) { console.log("usage: node init.mjs PROJECT [--dry]"); process.exit(2); }
const PROJECT = resolve(target);
if (realpathSync(PROJECT) === realpathSync(HERE)) { console.error("that's the studio itself: point this at a film"); process.exit(1); }
const inProject = (f) => join(PROJECT, f);
const say = (what, file) => console.log(`${what.padEnd(9)} ${file}`);
const write = (file, text) => { if (!dry) { mkdirSync(dirname(inProject(file)), { recursive: true }); writeFileSync(inProject(file), text); } };
const run = (cmd, cwd) => { const r = spawnSync(cmd, { cwd, stdio: "inherit", shell: true }); if (r.status) process.exit(r.status); };

for (const f of STARTER) {
  if (existsSync(inProject(f))) continue;
  say("starter", f);
  if (!dry) cpSync(join(HERE, "demo", f), inProject(f), { recursive: true });
}
for (const [f, text] of Object.entries(OLD_POINTERS)) {
  if (existsSync(inProject(f)) && readFileSync(inProject(f), "utf8").replace(/\r\n/g, "\n") === text) { say("removed", f); if (!dry) rmSync(inProject(f)); }
}

// Linked by the name `bun link` registers, so node_modules/live-studio is this folder itself, never a copy. Bun 1.4 on
// Windows fails a link: given as a path ("failed linking dependency"), and file: copies the folder
const pkgFile = inProject("package.json");
const pkg = existsSync(pkgFile) ? JSON.parse(readFileSync(pkgFile, "utf8")) : { private: true, type: "module", dependencies: { three: "0.187.0" } };
pkg.dependencies = { ...pkg.dependencies, "live-studio": "link:live-studio" };
const SCRIPTS = {
  studio: "node node_modules/live-studio/src/live.mjs", // add the film's port, e.g. 4324
  notes: "python node_modules/live-studio/notes_report.py",
  note: "node node_modules/live-studio/note.mjs",
  render: "node node_modules/live-studio/render.mjs",
};
// A script that only opened the old pointer files goes; one a film wrote its own way stays
const old = { studio: /^node src\/live\.mjs/, notes: /notes_report\.py/ };
pkg.scripts = { ...SCRIPTS, ...Object.fromEntries(Object.entries(pkg.scripts ?? {}).filter(([k, v]) => !old[k]?.test(v))) };
say("linked", "live-studio -> link:live-studio");
write("package.json", JSON.stringify(pkg, null, 2) + "\n");
if (!dry) { run("bun link", HERE); run("bun install", PROJECT); }
console.log(dry ? "nothing changed" : "done: bun run studio");
