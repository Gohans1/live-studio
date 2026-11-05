import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { STUDIO } from "../src/film.mjs";
import { filmPlugin } from "../src/vite_film.mjs";

// What a saved file does to an open page, asked of the plugin the way Vite asks it
const save = (film, file) => {
  const code = [], sent = [];
  const plugin = filmPlugin(film, { onCode: (f) => code.push(f) });
  const result = plugin.hotUpdate.call({ environment: { name: "client", hot: { send: (m) => sent.push(m) } } }, { file, modules: [{}] });
  return { result, code, sent };
};
const demo = { PROJECT: join(STUDIO, "demo"), SRC: join(STUDIO, "demo/src"), EDIT: join(STUDIO, "demo/src/edit.json") };

test("a film's code waits for the page to be idle, even the demo film inside the studio's own folder", () => {
  const { result, code } = save(demo, join(demo.SRC, "scene.ts"));
  assert.deepEqual(result, []);
  assert.deepEqual(code, [join(demo.SRC, "scene.ts")]);
});

test("a film's edit.json is read by the page itself and reloads nothing", () => {
  const { result, code, sent } = save(demo, demo.EDIT);
  assert.deepEqual(result, []);
  assert.deepEqual(code, []);
  assert.deepEqual(sent, []);
});

test("the studio's engine reloads the page instead of running twice", () => {
  const { result, sent } = save(demo, join(STUDIO, "app/engine/player.ts"));
  assert.deepEqual(result, []);
  assert.deepEqual(sent, [{ type: "full-reload" }]);
});

test("the studio's controls keep React's own hot update", () => {
  const { result, sent } = save(demo, join(STUDIO, "app/ui/Transport.tsx"));
  assert.equal(result, undefined);
  assert.deepEqual(sent, []);
});
