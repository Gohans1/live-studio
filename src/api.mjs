// What the studio page asks the server for, as one Hono app: the built page (src/page.mjs) at / and /_studio/, its data and
// live events under /api/, and everything else from the film's own files (assets/public as /, small phone copies as /lite/).
import { existsSync, readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { extname, isAbsolute, join, relative } from "node:path";
import { Readable } from "node:stream";
import { promisify } from "node:util";
import { brotliCompress, constants as zlibConsts, gzip } from "node:zlib";
import { zValidator } from "@hono/zod-validator";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { html } from "hono/html";
import { HTTPException } from "hono/http-exception";
import { streamSSE } from "hono/streaming";
import * as z from "zod";
import { weighFirstVisit } from "./weight.mjs";

const MIME = { ".gltf": "application/json", ".glb": "model/gltf-binary", ".jpg": "image/jpeg", ".png": "image/png", ".bin": "application/octet-stream", ".js": "text/javascript", ".json": "application/json", ".wav": "audio/wav", ".webm": "audio/webm", ".jar": "application/java-archive" };
// The page sends null for a picture it could not make (no pin, no crop): the words still count
const jpeg = z.string().startsWith("data:image/jpeg;base64,/9j/").nullish();
const NoteIn = z.object({
  note: z.looseObject({ id: z.string().regex(/^[a-z0-9]+$/), t: z.number().refine(Number.isFinite), text: z.string() }),
  img: jpeg, crop: jpeg, strip: jpeg,
});
const NoteChange = z.object({ text: z.string().optional(), remove: z.boolean().optional(), restore: z.boolean().optional(), done: z.boolean().optional(), fix: z.looseObject({}).optional() });
const Choose = z.object({ group: z.string().min(1), set: z.string(), gain: z.number().optional() });
const PageProblems = z.object({ problems: z.array(z.string()) });
const PageWeight = z.object({ files: z.array(z.object({ path: z.string().max(1000), bytes: z.number().nonnegative() })).max(5000) });

// Formats that are compressed inside already: trying them again only costs time on a first visit
const PACKED = /\.(png|jpe?g|webp|avif|gif|webm|mp3|mp4|m4a|ogg|opus|flac|woff2|ktx2)$/i;
const PACK_MAX = 16 * 1024 * 1024; // bigger is held in memory per version: slim it in the film instead
const inside = (root, file) => { const r = relative(root, file); return r && !r.startsWith("..") && !isAbsolute(r); };

export const createApi = (film, { page, events }) => {
  // Text and geometry shrink a lot and pictures don't. Squeezed once per version, so the next visit costs nothing here either;
  // what barely shrinks (a zip of pictures) is remembered as not worth it and goes out as it is
  // Off the main thread (a few MB takes a second), and kept as the promise so a second visit meanwhile waits for the same work
  const packed = new Map(), toBr = promisify(brotliCompress), toGzip = promisify(gzip);
  const squeeze = async (c, buf, tag) => {
    const accepts = c.req.header("accept-encoding") ?? "", how = /\bbr\b/.test(accepts) ? "br" : /gzip/.test(accepts) ? "gzip" : "";
    c.header("vary", "accept-encoding");
    if (!how) return buf;
    const key = how + tag;
    if (!packed.has(key)) {
      if (packed.size > 400) packed.clear();
      const work = how === "br" ? toBr(buf, { params: { [zlibConsts.BROTLI_PARAM_QUALITY]: 9 } }) : toGzip(buf);
      packed.set(key, work.then((small) => (small.length < buf.length * 0.9 ? small : null)));
    }
    const small = await packed.get(key);
    if (!small) return buf;
    c.header("content-encoding", how);
    return small;
  };
  // Unchanged means no download, and asking costs a few bytes
  const text = async (c, buf, type = "application/json") => {
    const tag = `"${createHash("md5").update(buf).digest("base64url")}"`;
    c.header("etag", tag);
    c.header("cache-control", "no-cache");
    if (c.req.header("if-none-match") === tag) return c.body(null, 304);
    c.header("content-type", type);
    return c.body(await squeeze(c, buf, tag));
  };
  const fresh = (c, data) => { c.header("cache-control", "no-store"); return c.json(data); };
  const fileOrMissing = (c, file) => (existsSync(file) ? text(c, readFileSync(file)) : c.body(null, 404));

  // A film file, with byte ranges (seeking in the sound needs them) and an etag so a reload on a phone fetches nothing again
  const sendFile = async (c, file, { store = false, pack = false } = {}) => {
    const { size, mtimeMs } = statSync(file);
    c.header("content-type", MIME[extname(file)] ?? "application/octet-stream");
    c.header("accept-ranges", "bytes");
    const range = c.req.header("range");
    if (store) c.header("cache-control", "no-store");
    else {
      const tag = `"${size}-${Math.round(mtimeMs)}"`;
      c.header("etag", tag);
      c.header("cache-control", "no-cache"); // a re-made copy shows up at once
      if (c.req.header("if-none-match") === tag && !range) return c.body(null, 304);
      if (pack && !range && size <= PACK_MAX) return c.body(await squeeze(c, readFileSync(file), tag));
    }
    const m = /bytes=(\d*)-(\d*)/.exec(range ?? "");
    if (m) {
      const a = m[1] ? +m[1] : 0, b = m[2] ? Math.min(+m[2], size - 1) : size - 1;
      if (a > b) { c.header("content-range", `bytes */${size}`); return c.body(null, 416); } // a page still reading past the end of a mix that got shorter
      c.header("content-range", `bytes ${a}-${b}/${size}`);
      c.header("content-length", String(b - a + 1));
      return c.body(Readable.toWeb(film.openRead(file, { start: a, end: b })), 206);
    }
    c.header("content-length", String(size));
    return c.body(Readable.toWeb(film.openRead(file)));
  };

  const app = new Hono();

  // The page names the build it came from, so after the studio restarts it can tell whether it is still the current one
  const build = () => createHash("md5").update(page.html() ?? "").digest("base64url");
  app.get("/", (c) => {
    c.header("cache-control", "no-cache");
    const built = page.html();
    // No page yet: the first build failed. Shown until a save fixes it
    if (!built) return c.html(html`<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="3"><title>Studio</title><pre style="white-space:pre-wrap">Code lỗi, chưa dựng được trang. Sửa xong là trang tự tải lại.<br><br>${page.error() ?? ""}</pre>`, 503);
    return c.html(built.replace("</head>", `<meta name="live-build" content="${build()}"></head>`));
  });
  app.get("/_studio/*", serveStatic({ root: page.dir, precompressed: true, onFound: (_, c) => c.header("cache-control", "public, max-age=31536000, immutable") }));

  // Saves and jobs, as they happen (see send in live.mjs). A browser reconnects to this by itself, without reloading the page
  app.get("/api/events", (c) => streamSSE(c, async (stream) => {
    // Hono tells only the listeners it already has when a page leaves, so listen before the first write can wait on it
    const gone = new Promise((done) => { stream.onAbort(done); if (stream.aborted) done(); });
    events.add(stream);
    await stream.writeSSE({ event: "hello", data: build() });
    const alive = setInterval(() => stream.write(": alive\n\n"), 25e3); // a proxy drops a line that stays quiet
    await gone;
    clearInterval(alive);
    events.delete(stream);
  }));
  // The films' own scripts still call two paths from before /api/: checkpoint.py marks notes done at /notes/:id, and
  // publish_pages.py reads /edit.json
  app.on("POST", ["/api/*", "/notes/*"], bodyLimit({ maxSize: 20 * 1024 * 1024 }));

  app.get("/api/notes", (c) => fresh(c, film.notes.read()));
  app.post("/api/notes", zValidator("json", NoteIn), async (c) => {
    film.notes.add(c.req.valid("json"), await film.stamp());
    return c.text("ok");
  });
  app.on("POST", ["/api/notes/:id{[a-z0-9]+}", "/notes/:id{[a-z0-9]+}"], zValidator("json", NoteChange), (c) => {
    film.notes.change(c.req.param("id"), c.req.valid("json"));
    return c.text("ok");
  });
  app.get("/api/note-img/:name{[a-z0-9]+(_crop|_strip)?\\.jpg}", (c) => {
    const pic = film.notes.picture(c.req.param("name").slice(0, -4));
    if (!pic) return c.body(null, 404);
    c.header("content-type", "image/jpeg");
    c.header("cache-control", "max-age=31536000, immutable");
    return c.body(pic);
  });

  app.on("GET", ["/api/edit.json", "/edit.json"], (c) => text(c, readFileSync(film.EDIT)));
  app.get("/api/voice_map.json", (c) => fileOrMissing(c, film.VOICE_MAP));
  app.get("/api/shots.json", (c) => text(c, Buffer.from(JSON.stringify(film.shotComments()))));
  app.get("/api/trials.json", (c) => { const t = film.trials(); return t ? text(c, Buffer.from(JSON.stringify(t))) : c.body(null, 404); });
  app.get("/api/choices.json", (c) => text(c, Buffer.from(JSON.stringify(film.readChoices()))));
  app.post("/api/choose", zValidator("json", Choose), (c) => (film.choose(c.req.valid("json")) ? c.text("ok") : c.body(null, 400)));
  app.get("/api/contract.json", (c) => fresh(c, film.contract()));
  app.post("/api/contract", zValidator("json", PageProblems), (c) => { film.pageSays(c.req.valid("json").problems); return c.text("ok"); });

  let weighed = null; // the heavy files last named, so each reload doesn't say it again
  app.post("/api/weight", zValidator("json", PageWeight), (c) => {
    const heavy = weighFirstVisit(c.req.valid("json").files);
    if ((heavy?.names ?? null) !== weighed) {
      console.log(heavy ? heavy.text : "a first visit from a phone or over Tailscale is back under budget");
      weighed = heavy?.names ?? null;
    }
    return c.text("ok");
  });

  app.get("/api/mix.wav", (c) => (existsSync(film.MIX) ? sendFile(c, film.MIX, { store: true }) : c.body(null, 404)));
  app.get("/api/mix_small.webm", async (c) => { if (!existsSync(film.MIX)) return c.body(null, 404); await film.smallMix(); return existsSync(film.MIX_SMALL) ? sendFile(c, film.MIX_SMALL) : c.body(null, 404); }); // no ffmpeg, no small copy: the page plays the full mix

  // The film's own files, last
  app.get("*", (c) => {
    const url = decodeURIComponent(c.req.path);
    const lite = url.startsWith("/lite/");
    const root = lite ? film.LITE : film.PUBLIC;
    const file = join(root, lite ? url.slice(5) : url);
    if (!inside(root, file) || !existsSync(file) || statSync(file).isDirectory()) return c.body(null, 404);
    return sendFile(c, file, { pack: !PACKED.test(file) });
  });
  app.onError((e, c) => { console.log(`${c.req.method} ${c.req.path}: ${e.message}`); return e instanceof HTTPException ? e.getResponse() : c.body(null, 500); }); // one bad request must not take the studio down, and a page keeps a note it could not save and tries again
  return app;
};
