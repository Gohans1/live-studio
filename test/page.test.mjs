import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { openFilm, STUDIO } from "../src/film.mjs";
import { buildPage } from "../src/page.mjs";

// A copy of the demo film, so saves here never touch the real one
const dir = mkdtempSync(join(tmpdir(), "studio-page-"));
cpSync(join(STUDIO, "demo/src"), join(dir, "src"), { recursive: true });
const scene = join(dir, "src/scene.ts"), original = readFileSync(scene, "utf8");
const heard = [];
let page;
// Resolves once the builds a save starts are over, whatever they found: one save can fire the watcher twice
const save = (text, file = scene) => new Promise((done) => {
  let started = false, quiet;
  const wait = (e) => {
    if (e.code === "START") { started = true; clearTimeout(quiet); }
    if (started && (e.code === "END" || e.code === "ERROR")) quiet = setTimeout(() => { page.watcher.off("event", wait); done(); }, 400);
  };
  page.watcher.on("event", wait);
  writeFileSync(file, text);
});

before(async () => {
  // A library written for Node that a film may pull in (Minecraft's nbt readers do): its require of zlib is never reached
  mkdirSync(join(dir, "node_modules/nodeish"), { recursive: true });
  writeFileSync(join(dir, "node_modules/nodeish/package.json"), '{"name":"nodeish","main":"index.js"}');
  writeFileSync(join(dir, "node_modules/nodeish/index.js"), 'module.exports = { gunzip: (b) => require("zlib").gunzipSync(b) };');
  writeFileSync(scene, `import { gunzip } from "nodeish";\nexport const unzip = gunzip;\n${original}`);
  page = await buildPage(openFilm(dir, { send() {} }), { onChange: () => heard.push("change"), onError: (m) => heard.push(`error ${m}`) });
});
after(async () => { await page.close(); rmSync(dir, { recursive: true, force: true }); });

test("the film builds into the page, even with a Node library that requires a Node built-in", () => {
  assert.equal(heard.length, 0, heard.join("\n"));
  assert.match(page.html(), /src="\/_studio\/index-[\w-]+\.js"/);
  assert.ok(readdirSync(join(page.dir, "_studio")).some((f) => f.endsWith(".js")));
});

test("a saved comment builds the same page and reloads nothing", async () => {
  const before = page.html();
  await save(`${readFileSync(scene, "utf8")}\n// a thought\n`);
  assert.equal(page.html(), before);
  assert.deepEqual(heard, []);
});

test("a broken save keeps the last page and says why; fixing it reloads", async () => {
  const good = readFileSync(scene, "utf8"), before = page.html();
  await save(`${good}\nexport const broken = ;\n`);
  assert.equal(page.html(), before);
  assert.equal(heard.length, 1);
  assert.match(heard[0], /^error /);
  assert.match(heard[0], /scene\.ts/);
  assert.doesNotMatch(heard[0], /\u001b/, "the page shows this as text: no terminal colour codes");
  await save(good);
  assert.deepEqual(heard.slice(1), ["change"]);
  heard.length = 0;
});

test("a real change to the film's code reloads the page", async () => {
  const before = page.html();
  await save(`${readFileSync(scene, "utf8")}\nexport const added = "new";\n`);
  assert.notEqual(page.html(), before);
  assert.deepEqual(heard, ["change"]);
});

test("a rebuild keeps the last build's files for pages still loading it, and clears out old ones", async () => {
  const code = join(page.dir, "_studio"), last = readdirSync(code);
  const stale = join(code, "index-gone.js"), longAgo = new Date(Date.now() - 2 * 3600e3);
  writeFileSync(stale, "");
  utimesSync(stale, longAgo, longAgo);
  await save(`${readFileSync(scene, "utf8")}\nexport const again = "newer";\n`);
  assert.deepEqual(last.filter((f) => !existsSync(join(code, f))), []);
  assert.equal(existsSync(stale), false);
});

test("a changed edit.json is a new page, offered like code: the next reload has it", async () => {
  heard.length = 0;
  const edit = join(dir, "src/edit.json"), before = page.html();
  await save(JSON.stringify({ ...JSON.parse(readFileSync(edit, "utf8")), added: 1 }, null, 1), edit);
  assert.notEqual(page.html(), before);
  assert.deepEqual(heard, ["change"]);
});
