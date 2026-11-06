import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { openFilm, STUDIO } from "../src/film.mjs";

// A film whose mix reads a file of its own, declared in package.json, and has none of the optional scripts
const dir = mkdtempSync(join(tmpdir(), "studio-film-"));
cpSync(join(STUDIO, "demo/src"), join(dir, "src"), { recursive: true });
mkdirSync(join(dir, "src/timeline"));
const audio = join(dir, "src/timeline/audio.json");
writeFileSync(audio, '{"gain": 1}\n');
writeFileSync(join(dir, "package.json"), JSON.stringify({ "live-studio": { sound: ["sound.py", "src/timeline/audio.json"] } }));
writeFileSync(join(dir, "sound.py"), 'import sys, pathlib\nout = pathlib.Path(sys.argv[1])\nout.write_bytes(b"")\nout.with_name("trials.json").write_text("{}")\n');

const heard = [];
let film;
const soundAfter = (n) => new Promise((done, fail) => {
  const t0 = Date.now(), h = setInterval(() => {
    if (heard.filter((e) => e === "sound").length >= n) { clearInterval(h); done(); }
    else if (Date.now() - t0 > 20e3) { clearInterval(h); fail(new Error(`heard ${heard.join(", ")}`)); }
  }, 50);
});
after(() => { film?.stop(); rmSync(dir, { recursive: true, force: true }); });

test("a change to a file package.json lists under live-studio.sound remixes, with no optional script in the film", async () => {
  film = openFilm(dir, { send: (e) => heard.push(e) });
  film.start();
  await soundAfter(1); // the first mix: there was none
  await new Promise((r) => setTimeout(r, 400));
  writeFileSync(audio, '{"gain": 2}\n');
  await soundAfter(2);
  assert.equal(heard.filter((e) => e === "sound").length, 2);
});

test("a listed file deleted remixes too, and the studio keeps running", async () => {
  await new Promise((r) => setTimeout(r, 400));
  rmSync(audio);
  await soundAfter(3);
});
