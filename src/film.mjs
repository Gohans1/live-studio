// One film opened in the studio: where its files are, and the jobs that keep the studio's copies of them fresh (the sound mix,
// the voice's word times, the phone copies, the film contract). Everything under `project` is the film's,
// everything beside this file is the studio's.
import { execFile, spawn } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, watch as fsWatch, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkFiles, Choices, DOC, Edit, problems, Trials } from "./contract.mjs";
import { createNotes } from "./notes.mjs";

export const STUDIO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// One copy of three: the film's and the studio's would each otherwise bring their own, and objects from one fail instanceof in the other
export const threeFromOf = (project) => (existsSync(join(project, "node_modules/three")) ? project : STUDIO);

const debounce = (f, ms) => { let h; return (...a) => { clearTimeout(h); h = setTimeout(() => f(...a), ms); }; };

export const openFilm = (projectDir, { send }) => {
  const PROJECT = resolve(projectDir);
  const SRC = join(PROJECT, "src");
  if (!existsSync(join(SRC, "scene.ts"))) throw new Error(`${PROJECT} has no src/scene.ts: run this inside a film, or try bun run demo`);
  const VENV_PYTHON = join(PROJECT, process.platform === "win32" ? ".venv/Scripts/python.exe" : ".venv/bin/python");
  const PYTHON = existsSync(VENV_PYTHON) ? VENV_PYTHON : process.platform === "win32" ? "python" : "python3";
  const PUBLIC = join(PROJECT, "assets/public");
  const WORK = join(PROJECT, "renders/live");
  const MIX = join(WORK, "mix_dry.wav"); // without the sounds being tried: the page plays those itself
  const MIX_SMALL = join(WORK, "mix_small.webm"); // the same mix for anything but this machine: a fifteenth of the size, and Opus stays on the clock where mp3 ran up to 30ms off
  const LITE = join(WORK, "lite"); // small copies of the assets, see make_lite.py
  const TRIALS = join(WORK, "trials.json");
  const EDIT = join(SRC, "edit.json");
  const VOICE_MAP = join(WORK, "voice_map.json");
  const VOICE = join(PUBLIC, "agent/full_voice.wav");
  // What was picked in the studio ("Chốt"), {group: {set, gain}}, read by the film's own renders; older films named it sound_choices.json
  const CHOICES = [join(PROJECT, "sound_choices.json"), join(PROJECT, "choices.json")].find(existsSync) ?? join(PROJECT, "choices.json");
  // A machine's private name (Tailscale) has no place in the studio's public repo: the film lists the names it is reached by
  const HOSTS_FILE = join(PROJECT, ".live_hosts");
  const hosts = (existsSync(HOSTS_FILE) ? readFileSync(HOSTS_FILE, "utf8") : "").split(/\s+/).filter(Boolean).map((n) => n.toLowerCase());
  const threeFrom = threeFromOf(PROJECT);
  // What sound.py reads, so a change to any of it remixes: package.json "live-studio": { "sound": [paths] }, files or folders.
  // Never list a folder the mix writes into, or every remix starts the next. Without the key: what films made before it mixed from
  const pkg = existsSync(join(PROJECT, "package.json")) ? JSON.parse(readFileSync(join(PROJECT, "package.json"), "utf8")) : {};
  const SOUND_INPUTS = (pkg["live-studio"]?.sound ?? ["sound.py", "src/timing.ts", "assets/public/agent/sfx2", "assets/public/agent/sfx_try"]).map((f) => join(PROJECT, f));
  const has = (script) => existsSync(join(PROJECT, script)); // voice_edit.py, voice_map.py and make_lite.py are optional
  mkdirSync(WORK, { recursive: true });

  const notes = createNotes(PROJECT);
  const textOf = (f) => (existsSync(f) ? readFileSync(f, "utf8") : undefined);
  const readChoices = () => (existsSync(CHOICES) ? JSON.parse(readFileSync(CHOICES, "utf8")) : {});

  // ---------- The film contract (contract.mjs): said once when it changes, in this terminal and to the pages
  let fileProblems = null, pageProblems = null; // null: the first check says "ok" too
  const sayContract = (what, list) => console.log(list.length ? `\nfilm contract, ${what} (see ${DOC}):\n${list.join("\n\n")}\n` : `film contract, ${what}: ok`);
  const checkContract = () => {
    const now = checkFiles({ "src/edit.json": [Edit, textOf(EDIT)], "renders/live/trials.json (from sound.py)": [Trials, textOf(TRIALS)], [CHOICES.slice(PROJECT.length + 1)]: [Choices, textOf(CHOICES)] });
    if (JSON.stringify(now) === JSON.stringify(fileProblems)) return;
    fileProblems = now;
    sayContract("files", now);
    send("contract");
  };
  const pageSays = (list) => {
    const now = list.map((x) => x.slice(0, 4000)).slice(0, 50);
    if (JSON.stringify(now) !== JSON.stringify(pageProblems)) { pageProblems = now; sayContract("code, found by the page", now); }
  };

  const choose = ({ group, set, gain }) => {
    const next = { ...readChoices(), [group]: { set, gain } };
    if (problems(Choices, next, "choice").length) return false;
    writeFileSync(CHOICES, JSON.stringify(next, null, 1) + "\n");
    checkContract();
    return true;
  };
  const trials = () => {
    if (!existsSync(TRIALS)) return null;
    const all = JSON.parse(readFileSync(TRIALS, "utf8")), chosen = readChoices();
    for (const g in all) all[g].chosen = chosen[g] ?? null;
    return all;
  };
  const shotComments = () => {
    const s = readFileSync(join(SRC, "scene.ts"), "utf8").replace(/\r/g, "");
    return s.slice(s.indexOf("export const SHOTS = ["), s.indexOf("];\nexport let DURATION")).split("\n").slice(1).filter((l) => l.trim()).map((l) => l.match(/\/\/ (.*)$/)?.[1] ?? "");
  };
  // Which version of the film a note was said about, when the film is in git
  const stamp = () => new Promise((done) => execFile("git", ["describe", "--tags", "--always", "--dirty"], { cwd: PROJECT, encoding: "utf8" }, (e, out) => done({ version: e ? undefined : out.trim() })));

  // ---------- Files that are swapped in whole while a page may be reading them
  // Windows won't replace a file someone is still reading. A mix swaps in by cutting its readers off: the page fetches the new one right after
  const readers = new Set();
  const openRead = (file, range) => {
    const s = createReadStream(file, range), me = { file, stop: () => s.destroy() };
    readers.add(me);
    s.on("close", () => readers.delete(me));
    return s;
  };
  const swapIn = async (fresh, target) => {
    for (let i = 0; i < 50; i++) {
      for (const r of readers) if (r.file === target) r.stop();
      try { renameSync(fresh, target); return true; } catch { await new Promise((done) => setTimeout(done, 100)); }
    }
    console.log("could not replace", target);
    return false;
  };
  let smallMixing = null;
  const smallMix = () => {
    if (existsSync(MIX_SMALL) && statSync(MIX_SMALL).mtimeMs >= statSync(MIX).mtimeMs) return Promise.resolve();
    // Made beside it and swapped in whole: a phone may be halfway through downloading the old one
    const fresh = MIX_SMALL + ".new.webm";
    return (smallMixing ??= new Promise((done) => spawn("ffmpeg", ["-v", "error", "-y", "-i", MIX, "-ac", "1", "-c:a", "libopus", "-b:a", "48k", fresh], { stdio: "inherit" })
      .on("error", (e) => console.log("ffmpeg is needed for the small mix:", e.message))
      .on("close", async (code) => { if (!code) await swapIn(fresh, MIX_SMALL); smallMixing = null; done(); })));
  };

  // ---------- The sound mix: written beside the old one and swapped in whole, so a page playing it never reads a half-written file
  let mixing = false, again = false;
  const remix = () => {
    if (mixing) { again = true; return; }
    mixing = true;
    send("sound-start");
    const t0 = Date.now(), fresh = MIX + ".new.wav";
    spawn(PYTHON, ["sound.py", fresh, "--dry"], { cwd: PROJECT, stdio: "inherit" }).on("close", async (code) => {
      if (!code) await swapIn(fresh, MIX);
      mixing = false;
      console.log(code ? "sound mix failed" : `sound mixed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
      if (!code) { send("sound"); checkContract(); }
      if (again) { again = false; remix(); }
    });
  };
  // A paced voice moves everything after it: work out where the words land, tell the film, then mix
  let voicing = false, voiceAgain = false;
  const editVoice = () => {
    if (!has("voice_edit.py")) { remix(); return; }
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
  let mapping = false;
  const mapVoice = () => {
    if (mapping) return;
    mapping = true;
    const p = spawn(PYTHON, ["voice_map.py", VOICE_MAP], { cwd: PROJECT, stdio: ["ignore", "pipe", "inherit"] });
    p.stdout.on("data", () => send("voice"));
    p.on("close", (code) => { mapping = false; if (code) console.log("voice map failed"); else if (!Object.keys(JSON.parse(readFileSync(EDIT, "utf8")).voice.edits).length) editVoice(); });
  };

  // ---------- Watching the film's files. Code is Vite's to watch (src/vite_film.mjs); these are the files code doesn't import
  const watchers = [];
  const watch = (...a) => watchers.push(fsWatch(...a));
  const start = () => {
    // Windows can report a file as changed just because something read it, and every remix restarts the sound on every open page:
    // what counts is whether anything's size or time really moved. A file deleted is a change too, never a crash
    const stampOf = (p) => { try { const s = statSync(p); return s.isDirectory() ? readdirSync(p).map((n) => n + stampOf(join(p, n))).join() : `:${s.size}:${s.mtimeMs}`; } catch { return ":gone"; } };
    const soundFiles = [...new Set([join(PROJECT, "sound.py"), ...SOUND_INPUTS])].filter((f) => existsSync(f));
    const stamps = () => soundFiles.map(stampOf).join();
    let soundsSeen = stamps();
    const soundsChanged = debounce(() => { const now = stamps(); if (now !== soundsSeen) { soundsSeen = now; remix(); } }, 300);
    for (const f of soundFiles) watch(f, { recursive: statSync(f).isDirectory() }, soundsChanged);
    if (!existsSync(MIX) || !existsSync(TRIALS)) remix();
    // Only a new take is worth a Whisper run
    if (existsSync(VOICE) && has("voice_map.py")) {
      let voiceSeen = statSync(VOICE).mtimeMs;
      watch(VOICE, debounce(() => { const now = statSync(VOICE).mtimeMs; if (now !== voiceSeen) { voiceSeen = now; remix(); mapVoice(); } }, 500));
      if (!existsSync(VOICE_MAP) || statSync(VOICE_MAP).mtimeMs < statSync(VOICE).mtimeMs) mapVoice();
    }
    if (!existsSync(LITE) && has("make_lite.py")) spawn(PYTHON, ["make_lite.py"], { cwd: PROJECT, stdio: "inherit" });
    watch(notes.file, debounce(() => send("notes"), 100)); // the agent ticking a note off shows up here too
    // Voice edits are made in the file: the voice and the mix follow it
    const voiceEdits = () => { try { return JSON.stringify(JSON.parse(readFileSync(EDIT, "utf8")).voice.edits); } catch { return null; } };
    let editsSeen = voiceEdits();
    watch(EDIT, debounce(() => { checkContract(); const now = voiceEdits(); if (now !== null && now !== editsSeen) { editsSeen = now; editVoice(); } }, 100));
    checkContract();
  };

  return {
    PROJECT, SRC, PUBLIC, WORK, MIX, MIX_SMALL, LITE, EDIT, VOICE_MAP, hosts, threeFrom,
    notes, readChoices, choose, trials, shotComments, stamp,
    contract: () => ({ files: fileProblems }), pageSays,
    openRead, smallMix, start, stop: () => watchers.splice(0).forEach((w) => w.close()),
  };
};
