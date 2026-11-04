import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import * as esbuild from "esbuild";
import { nodeBuiltinsEmpty } from "../src/bundle.mjs";

const film = (files) => {
  const dir = mkdtempSync(join(tmpdir(), "studio-bundle-"));
  for (const [name, text] of Object.entries(files)) { mkdirSync(join(dir, name, ".."), { recursive: true }); writeFileSync(join(dir, name), text); }
  return dir;
};
const bundle = (dir) => esbuild.build({ absWorkingDir: dir, entryPoints: ["main.js"], bundle: true, format: "esm", platform: "browser", write: false, logLevel: "silent", plugins: [nodeBuiltinsEmpty] });

test("a library that requires a Node built-in the page never reaches still bundles, with an empty module in its place", async () => {
  const dir = film({ "main.js": 'import nbt from "nbtlib"; export default nbt;', "node_modules/nbtlib/package.json": '{"name":"nbtlib","main":"index.js"}', "node_modules/nbtlib/index.js": 'const zlib = require("zlib"); const assert = require("node:assert"); module.exports = { gz: typeof zlib.gzip, ok: typeof assert };' });
  const out = await bundle(dir);
  const mod = await import("data:text/javascript," + encodeURIComponent(out.outputFiles[0].text));
  assert.deepEqual(mod.default, { gz: "undefined", ok: "object" });
});

test("a browser package installed under a built-in's name is used, not emptied", async () => {
  const dir = film({ "main.js": 'import { Buffer } from "buffer"; export default Buffer.tag;', "node_modules/buffer/package.json": '{"name":"buffer","main":"index.js"}', "node_modules/buffer/index.js": 'exports.Buffer = { tag: "npm buffer" };' });
  const out = await bundle(dir);
  const mod = await import("data:text/javascript," + encodeURIComponent(out.outputFiles[0].text));
  assert.equal(mod.default, "npm buffer");
});

test("a built-in a package's own browser field turns off (crypto-js: crypto false) bundles as that package asks", async () => {
  const dir = film({ "main.js": 'import c from "cjs"; export default c;', "node_modules/cjs/package.json": '{"name":"cjs","main":"index.js","browser":{"crypto":false}}', "node_modules/cjs/index.js": 'let c; try { c = require("crypto"); } catch {} module.exports = typeof c;' });
  const out = await bundle(dir);
  const mod = await import("data:text/javascript," + encodeURIComponent(out.outputFiles[0].text));
  assert.equal(mod.default, "object");
});
