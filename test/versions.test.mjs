import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request } from "node:http";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { cueRanges, describeEdit, envelopeOf, pickBefore, soundRanges, stampAssets, trimVersions } from "../src/versions.mjs";

const RATE = 8000;
// Speech-like: bursts of noise with pauses, the same every run
const speech = (seconds) => {
  let seed = 7;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const out = new Float32Array(seconds * RATE);
  for (let at = 0, loud = 0; at < out.length; at += RATE * (0.08 + random() * 0.3)) {
    loud = random() < 0.25 ? 0 : 0.05 + random() * 0.3;
    for (let i = Math.floor(at); i < Math.min(out.length, at + RATE * 0.4); i++) out[i] = loud * (random() * 2 - 1);
  }
  return out;
};
const envelope = (samples) => {
  const dir = mkdtempSync(join(tmpdir(), "studio-test-")), file = join(dir, "mix.wav");
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((v, i) => data.writeInt16LE(Math.round(v * 32767), i * 2));
  const head = Buffer.alloc(44);
  head.write("RIFF", 0); head.writeUInt32LE(36 + data.length, 4); head.write("WAVEfmt ", 8); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22);
  head.writeUInt32LE(RATE, 24); head.writeUInt32LE(RATE * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34); head.write("data", 36); head.writeUInt32LE(data.length, 40);
  writeFileSync(file, Buffer.concat([head, data]));
  try { return envelopeOf(file); } finally { rmSync(dir, { recursive: true, force: true }); }
};
const withGap = (samples, at, gap) => {
  const n = Math.round(gap * RATE), out = new Float32Array(samples.length + n), cut = at * RATE;
  out.set(samples.subarray(0, cut));
  out.set(samples.subarray(cut), cut + n);
  return out;
};

test("a sound inside a beat is reported at the beat's time plus its offset, not at its offset", () => {
  const was = { beats: { sit: { at: 69.83, sounds: [[0.3, "chair", 1]] } } };
  const now = { beats: { sit: { at: 69.83, sounds: [[0.5, "chair", 1]] } } };
  const [item] = describeEdit(was, now);
  assert.ok(Math.abs(item.source - 70.33) < 1e-6, `reported at ${item.source}`);
});

test("inserting one camera key reads as one key added", () => {
  const key = (at) => ({ at, fov: 30 });
  const items = describeEdit({ camera: [key(1), key(2), key(3)] }, { camera: [key(1), key(1.5), key(2), key(3)] });
  assert.equal(items.length, 1);
  assert.equal(items[0].source, 1.5);
});

test("re-pacing the voice marks only the inserted pause as changed sound", () => {
  const before = speech(60), gap = 0.237;
  const ranges = soundRanges(envelope(before), envelope(withGap(before, 10, gap)), [], [[10, 10], [10, 10 + gap]]);
  assert.ok(ranges.length <= 2, `marked ${JSON.stringify(ranges)}`);
  assert.ok(ranges.every((r) => r.from >= 9.8 && r.to <= 10.6), `marked ${JSON.stringify(ranges)}`);
});

test("a sound really added to a re-paced mix is still found", () => {
  const before = speech(60), gap = 0.237, after = withGap(before, 10, gap);
  for (let i = 0; i < 0.3 * RATE; i++) after[40 * RATE + i] += 0.4 * Math.sin(i * 0.3);
  const ranges = soundRanges(envelope(before), envelope(after), [], [[10, 10], [10, 10 + gap]]);
  assert.ok(ranges.some((r) => r.from <= 40.3 && r.to >= 40), `marked ${JSON.stringify(ranges)}`);
});

test("with the voice unchanged, a small change in one spot marks only that spot", () => {
  const before = speech(20), after = before.slice();
  for (let i = 0; i < 0.2 * RATE; i++) after[5 * RATE + i] *= 1.5;
  const ranges = soundRanges(envelope(before), envelope(after), [], []);
  assert.equal(ranges.length, 1);
  assert.ok(ranges[0].from >= 4.9 && ranges[0].to <= 5.3, `marked ${JSON.stringify(ranges)}`);
});

test("before is the version last watched, and stays so once the current one has been watched", () => {
  const versions = [{ id: "a" }, { id: "b" }, { id: "c" }];
  assert.equal(pickBefore({ versions, seen: "a", base: null }), "a");
  assert.equal(pickBefore({ versions, seen: "c", base: "a" }), "a");
  assert.equal(pickBefore({ versions, seen: "c", base: null }), "b");
  assert.equal(pickBefore({ versions: [{ id: "a" }], seen: "a", base: null }), null);
});

test("sound cut from the end of the mix is marked", () => {
  const before = speech(20);
  const ranges = soundRanges(envelope(before), envelope(before.subarray(0, 10 * RATE)), [], []);
  assert.ok(ranges.some((r) => r.to >= 9.9), `marked ${JSON.stringify(ranges)}`);
});

test("24-bit audio is measured at its real loudness", () => {
  const dir = mkdtempSync(join(tmpdir(), "studio-test-")), file = join(dir, "mix.wav");
  const data = Buffer.alloc(RATE * 3);
  for (let i = 0; i < RATE; i++) data.writeIntLE(Math.round(Math.sin(i * 0.1) * 0.01 * 8388607), i * 3, 3);
  const head = Buffer.alloc(44);
  head.write("RIFF", 0); head.writeUInt32LE(36 + data.length, 4); head.write("WAVEfmt ", 8); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22);
  head.writeUInt32LE(RATE, 24); head.writeUInt32LE(RATE * 3, 28); head.writeUInt16LE(3, 32); head.writeUInt16LE(24, 34); head.write("data", 36); head.writeUInt32LE(data.length, 40);
  writeFileSync(file, Buffer.concat([head, data]));
  const e = envelopeOf(file);
  rmSync(dir, { recursive: true, force: true });
  assert.ok(Math.abs(e[5] - 0.00707) < 0.001, `measured ${e[5]}`);
});

test("a moved action sound is marked where the voice now puts it, and a bad entry is ignored", () => {
  const was = { beats: { a: { at: 20, sounds: [[0, "hit", 1], ["bad"]] } } }, now = { beats: { a: { at: 21, sounds: [[0, "hit", 1], "bad"] } } };
  const froms = cueRanges(was, now, [[10, 10], [10, 12]]).map((r) => r.from).sort((p, q) => p - q);
  assert.deepEqual(froms, [22, 23]);
});

test("trimming to 30 versions keeps what before points at and the current one", () => {
  const versions = Array.from({ length: 35 }, (_, i) => ({ id: `v${i}` }));
  const kept = trimVersions(versions, new Set(["v0", "v2"])).map((v) => v.id);
  assert.equal(kept.length, 30);
  for (const id of ["v0", "v2", "v34"]) assert.ok(kept.includes(id), id);
});

test("a changed file behind a junction changes the assets' stamp, and the same files always stamp the same", async () => {
  const dir = mkdtempSync(join(tmpdir(), "studio-test-")), real = join(dir, "real"), assets = join(dir, "assets");
  try {
    mkdirSync(real); mkdirSync(assets);
    for (const n of ["b.png", "a.png", "c.png"]) writeFileSync(join(real, n), "x");
    symlinkSync(real, join(assets, "linked"), "junction");
    const first = JSON.stringify(await stampAssets(assets));
    assert.deepEqual(Object.keys(JSON.parse(first)), ["linked/a.png", "linked/b.png", "linked/c.png"]);
    assert.equal(JSON.stringify(await stampAssets(assets)), first);
    writeFileSync(join(real, "b.png"), "longer");
    assert.notEqual(JSON.stringify(await stampAssets(assets)), first);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

const REPO = fileURLToPath(new URL("..", import.meta.url));

// Runs from a clone of the last commit: a mistake here would otherwise delete this checkout's own files

test("init refuses to remove a project's own changes, and refuses the studio itself", () => {
  const dir = mkdtempSync(join(tmpdir(), "studio-test-")), film = join(dir, "film"), clone = join(dir, "studio");
  try {
    spawnSync("git", ["clone", "-q", REPO, clone]);
    mkdirSync(join(film, "src"), { recursive: true });
    writeFileSync(join(film, "src/studio.html"), "my own work");
    const refused = spawnSync("node", [join(clone, "init.mjs"), film], { encoding: "utf8" });
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /studio\.html/);
    assert.equal(readFileSync(join(film, "src/studio.html"), "utf8"), "my own work");
    assert.equal(spawnSync("node", [join(clone, "init.mjs"), clone], { encoding: "utf8" }).status, 1);
    assert.ok(existsSync(join(clone, "src/versions.mjs")));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("init links the film to this studio, never a copy of it", () => {
  const film = mkdtempSync(join(tmpdir(), "studio-film-"));
  try {
    writeFileSync(join(film, "package.json"), JSON.stringify({ private: true, type: "module" }));
    const r = spawnSync("node", [join(REPO, "init.mjs"), film], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    const link = join(film, "node_modules/live-studio");
    assert.ok(lstatSync(link).isSymbolicLink(), "node_modules/live-studio is a link");
    assert.equal(realpathSync(link), realpathSync(REPO));
  } finally { rmSync(film, { recursive: true, force: true }); }
});

describe("the server", () => {
  const port = 4499;
  let server;
  before(async () => {
    server = spawn("node", ["src/live.mjs", String(port)], { cwd: REPO, env: { ...process.env, LIVE_PROJECT: join(REPO, "demo") } });
    await new Promise((ok, no) => { server.stdout.on("data", (d) => { if (String(d).includes("live at")) ok(); }); server.on("close", () => no(new Error("the studio did not start"))); setTimeout(() => no(new Error("the studio did not start in time")), 60e3); });
  });
  after(() => server.kill());
  // fetch normalizes paths and won't send a Host header: these have to go out as written
  const ask = (path, { method = "GET", headers = {}, body } = {}) => new Promise((ok, no) => {
    const r = request({ port, path, method, headers: { host: `localhost:${port}`, ...headers } }, (res) => { res.resume(); ok(res); });
    r.on("error", no);
    r.end(body);
  });
  const status = async (...a) => (await ask(...a)).statusCode;

  test("reads nothing outside the film", async () => {
    for (const path of ["/../package.json", "/..%2f..%2f..%2fpackage.json", "/..%5c..%5c..%5cpackage.json", "/lite/..%2f..%2f..%2f..%2fpackage.json"]) assert.equal(await status(path), 404, path);
  });
  const page = async () => {
    const res = await new Promise((ok, no) => request({ port, path: "/", headers: { host: `localhost:${port}` } }, ok).on("error", no).end());
    let html = "";
    for await (const part of res) html += part;
    return { html, script: /src="(\/_studio\/[^"]+\.js)"/.exec(html)?.[1], build: /name="live-build" content="([^"]+)"/.exec(html)?.[1] };
  };

  test("serves the built page and the film's public files, never the film's code or a dev server's tools", async () => {
    const { script, build } = await page();
    assert.ok(script && build, "the page names its script and its build");
    assert.equal(await status(script), 200);
    assert.equal(await status("/agent/full_voice.wav"), 200);
    const film = join(REPO, "demo").replaceAll("\\", "/");
    for (const path of ["/src/scene.ts", `/@fs/${film}/src/scene.ts`, "/__open-in-editor?file=package.json"]) assert.equal(await status(path), 404, path);
  });
  test("refuses other sites", async () => {
    assert.equal(await status("/api/notes", { headers: { host: "evil.example.com" } }), 403);
    assert.equal(await status("/api/seen", { method: "POST", headers: { origin: "https://evil.example.com" }, body: "{}" }), 403);
    // What a browser says when another site's page loads something from here, and when it follows a link here
    assert.equal(await status("/api/notes", { headers: { "sec-fetch-site": "cross-site", "sec-fetch-mode": "no-cors", "sec-fetch-dest": "image" } }), 403);
    assert.equal(await status("/", { headers: { "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate", "sec-fetch-dest": "iframe" } }), 403);
    assert.equal(await status("/", { headers: { "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" } }), 200);
    const res = await ask("/api/notes", { headers: { "sec-fetch-site": "same-origin", "sec-fetch-mode": "cors", "sec-fetch-dest": "empty" } });
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers["cross-origin-resource-policy"], "same-origin");
    assert.match(res.headers["content-security-policy"], /frame-ancestors 'self'/);
  });
  test("sends the page's code compressed and kept for good, with the same guard headers as the notes", async () => {
    const res = await ask((await page()).script, { headers: { "accept-encoding": "gzip, br" } });
    assert.equal(res.statusCode, 200);
    assert.ok(["br", "gzip"].includes(res.headers["content-encoding"]), `sent as ${res.headers["content-encoding"]}`);
    assert.match(res.headers["cache-control"], /immutable/);
    assert.equal(res.headers["x-content-type-options"], "nosniff");
  });
  test("live events start by naming the build the page came from", async () => {
    const { build } = await page();
    const hello = await new Promise((ok, no) => {
      const r = request({ port, path: "/api/events", headers: { host: `localhost:${port}` } }, (res) => {
        let text = "";
        res.on("data", (d) => { text += d; const m = /event: hello\ndata: (.*)\n/.exec(text); if (m) { r.destroy(); ok(m[1]); } });
      });
      r.on("error", no).end();
    });
    assert.equal(hello, build);
  });
  test("answers bad requests and stays up", async () => {
    assert.equal(await status("/%"), 400);
    assert.equal(await status("/api/choose", { method: "POST", body: "not json" }), 400);
    assert.equal(await status("/api/mix.wav", { headers: { range: "bytes=999999999999-" } }), 416);
    assert.equal(await status("/api/notes"), 200);
  });
  test("still answers the old paths the films' own scripts call (checkpoint.py, publish_pages.py)", async () => {
    // A missing note changes nothing, so this writes nothing into the demo
    assert.equal(await status("/notes/testnone", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ done: true }) }), 200);
    const res = await ask("/edit.json");
    assert.equal(res.statusCode, 200);
    assert.match(res.headers["content-type"], /json/);
  });
  test("refuses a note that isn't whole, or a picture that isn't one", async () => {
    const send = (note, img) => status("/api/notes", { method: "POST", body: JSON.stringify({ note, img }) });
    assert.equal(await send({ id: "testbad" }), 400);
    assert.equal(await send({ id: ["testbad"], t: 1, text: "x" }), 400);
    assert.equal(await send({ id: "testbad", t: 1, text: "x" }, "data:text/html;base64,PGh0bWw+"), 400);
  });
});
