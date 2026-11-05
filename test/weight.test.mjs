import assert from "node:assert/strict";
import { test } from "node:test";
import { weighFirstVisit } from "../src/weight.mjs";

const MB = 1e6;

test("a light first visit says nothing", () => {
  assert.equal(weighFirstVisit([{ path: "/_studio/App.js", bytes: 0.5 * MB }, { path: "/rig/player.glb", bytes: 0.3 * MB }]), null);
});

test("a heavy first visit names its total and the biggest files, biggest first", () => {
  const { text: say, names } = weighFirstVisit([
    { path: "/_studio/App.js", bytes: 0.5 * MB },
    { path: "/mc/client.jar", bytes: 41.5 * MB },
    { path: "/rig/player.glb", bytes: 1.2 * MB },
  ]);
  assert.match(say, /43\.2 MB/);
  assert.ok(say.indexOf("/mc/client.jar 41.5 MB") < say.indexOf("/rig/player.glb 1.2 MB"), say);
  assert.doesNotMatch(say, /App\.js/, "files under 1 MB are not worth naming");
  assert.equal(names, "/mc/client.jar /rig/player.glb");
});

test("a file fetched twice counts once", () => {
  assert.equal(weighFirstVisit([{ path: "/a.bin", bytes: 6 * MB }, { path: "/a.bin", bytes: 6 * MB }]), null);
});
