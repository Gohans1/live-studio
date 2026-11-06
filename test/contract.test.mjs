import assert from "node:assert/strict";
import { test } from "node:test";
import { checkFiles, checkFilm, Edit, Trials } from "../src/contract.mjs";

const v3 = () => ({ isVector3: true });
const film = () => ({ buildScene() {}, applyEdit() {}, DURATION: 10, SHOTS: [{ t: 0 }, { t: 4 }], SHOTS_OUT: [{ t: 0 }, { t: 4 }] });
const draw = (tools) => Object.assign(() => {}, { tools: { scene: { isObject3D: true }, camera: { isCamera: true }, look: v3(), free: { on: false, p: v3(), l: v3(), fov: 40 }, ...tools } });

test("a beat without a time is reported with its file and where in it", () => {
  const edit = JSON.stringify({ voice: { edits: {}, warp: [] }, beats: { spin: { title: "spin", dur: 1, kind: "motion", sounds: [] } } });
  const [p] = checkFiles({ "src/edit.json": [Edit, edit] });
  assert.match(p, /^src\/edit\.json/);
  assert.match(p, /beats\.spin\.at/);
});

test("a sound group whose options share an id is reported, a missing file is not", () => {
  const trials = JSON.stringify({ hum: { title: "hum", kind: "stem", from: 0, to: 5, options: [{ id: "a", title: "A", files: ["/a.webm"] }, { id: "a", title: "B", files: ["/b.webm"] }] } });
  assert.match(checkFiles({ trials: [Trials, trials] })[0], /option ids must differ/);
  assert.deepEqual(checkFiles({ trials: [Trials, undefined] }), []);
});

test("a film is told what its draw lacks, and a complete one passes", () => {
  assert.deepEqual(checkFilm(film(), draw()), []);
  assert.match(checkFilm(film(), draw({ camera: undefined })).join(), /tools\.camera/);
  assert.match(checkFilm({ ...film(), SHOTS_OUT: [{ t: 4 }, { t: 0 }] }, draw()).join(), /in order of time/);
});

test("draw.checks, when a film has them, are functions by name", () => {
  const withChecks = (checks) => Object.assign(draw(), { checks });
  assert.deepEqual(checkFilm(film(), withChecks({ slide: () => [] })), []);
  assert.match(checkFilm(film(), withChecks({ slide: "0,108" })).join(), /checks\.slide/);
});
