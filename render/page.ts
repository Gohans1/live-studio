// @ts-nocheck
// The page render.mjs opens in a headless Chrome: draws frames with the film's own draw(t), the same code the studio shows,
// and encodes clips in the browser (mediabunny on WebCodecs, GPU H.264). Same t, same picture.
import { buildScene, DURATION, SHOTS_OUT as SHOTS } from "film/scene";
import { BufferTarget, Mp4OutputFormat, Output, VideoSample, VideoSampleSource } from "mediabunny";
import { canvas as glCanvas, config, done, log, post, still } from "./lab";

const FPS = 30;
const shotAt = (t) => SHOTS.filter((s) => t >= s.t).length;

(async () => {
  const cfg = await config();
  const canvas = glCanvas();
  canvas.width = cfg.W; canvas.height = cfg.H;
  const out = document.createElement("canvas");
  out.width = cfg.W; out.height = cfg.H;
  const ctx = out.getContext("2d");
  const t0 = performance.now();
  const render = await buildScene(canvas, cfg.W, cfg.H, cfg.draft, log);
  log(`scene built in ${((performance.now() - t0) / 1000).toFixed(1)}s`);
  for (const v of render.variants ?? []) if (cfg.choices?.[v.id]?.set) v.set(cfg.choices[v.id].set); // what was picked in the studio
  // CHECK=name:args;name:args runs the film's draw.checks[name](...args) and prints the lines it returns
  for (const [name, args] of cfg.checks ?? []) {
    const fn = render.checks?.[name];
    if (!fn) { log(`ERROR no draw.checks.${name} (the film has: ${Object.keys(render.checks ?? {}).join(", ") || "none"})`); return; }
    const t1 = performance.now();
    for (const line of [fn(...args)].flat()) log(line);
    log(`${name} done in ${((performance.now() - t1) / 1000).toFixed(1)}s`);
  }
  if (cfg.inspect) { const [px, py, pz, lx, ly, lz, fov] = cfg.inspect; Object.assign(render.tools.free, { on: true, fov }); render.tools.free.p.set(px, py, pz); render.tools.free.l.set(lx, ly, lz); }

  // The list the studio shows top left (draw.describe), drawn into every draft frame below the timestamp row: one backed box
  // per section, wrapped into a new column when it would run off the bottom. Colours are the studio's
  const S = Math.max(10, Math.round(cfg.H * 0.019)), LH = Math.round(S * 1.35), PAD = Math.round(S * 0.6), GAP = 3, TOP = 52;
  const MONO = `${S}px Consolas, monospace`, HEAD = `bold ${Math.round(S * 0.9)}px "Segoe UI", sans-serif`, TAG = `bold ${Math.round(S * 0.8)}px "Segoe UI", sans-serif`;
  const wrap = (text, width) => {
    const rows = [];
    let cur = "";
    for (const w of text.split(" ")) {
      const next = cur ? `${cur} ${w}` : w;
      if (cur && ctx.measureText(next).width > width) { rows.push(cur); cur = w; } else cur = next;
    }
    return [...rows, cur];
  };
  const drawList = (sections) => {
    ctx.save();
    ctx.globalAlpha = 1; ctx.textAlign = "left"; ctx.textBaseline = "middle";
    ctx.font = MONO;
    const inner = ctx.measureText("0".repeat(36)).width, colW = inner + PAD * 2;
    ctx.font = TAG;
    const tagW = ctx.measureText("NEW").width + 6;
    let x = 12, y = TOP;
    for (const { head, lines } of sections) {
      ctx.font = MONO;
      const rows = lines.flatMap(({ text, fresh }) => wrap(text, fresh ? inner - tagW - 5 : inner).map((r, i) => ({ r, fresh, first: i === 0 })));
      const h = (rows.length + 1) * LH + PAD;
      if (y + h > cfg.H - 12 && y > TOP) { x += colW + GAP; y = TOP; }
      ctx.fillStyle = "rgba(0,0,0,.62)"; ctx.beginPath(); ctx.roundRect(x, y, colW, h, 6); ctx.fill();
      let ry = y + PAD / 2 + LH / 2;
      ctx.font = HEAD; ctx.fillStyle = "#3AA99F"; ctx.fillText(head, x + PAD, ry);
      for (const { r, fresh, first } of rows) {
        ry += LH;
        let tx = x + PAD;
        if (fresh) {
          if (first) { ctx.font = TAG; ctx.fillStyle = "#D0A215"; ctx.beginPath(); ctx.roundRect(tx, ry - LH * 0.38, tagW, LH * 0.76, 3); ctx.fill(); ctx.fillStyle = "#100F0F"; ctx.fillText("NEW", tx + 3, ry); }
          tx += tagW + 5;
        }
        ctx.font = MONO; ctx.fillStyle = fresh ? "#FFFCF0" : "#CECDC3"; ctx.fillText(r, tx, ry);
      }
      y += h + GAP;
    }
    ctx.restore();
  };

  const draw = (frame, samples) => {
    const t = frame / FPS;
    ctx.globalAlpha = 1;
    if (samples === 1) { render(t); ctx.drawImage(canvas, 0, 0); }
    else for (let i = 0; i < samples; i++) {
      const ts = (frame + (i / samples) * 0.5) / FPS;
      render(shotAt(ts) === shotAt(t) ? ts : t); // never blur across a cut
      ctx.globalAlpha = 1 / (i + 1);
      ctx.drawImage(canvas, 0, 0);
    }
    if (!cfg.draft) return out;
    // The creator gives feedback by timestamp: mm:ss.sss in the top right of every draft
    const ms = Math.round(t * 1000);
    const label = `${String(Math.floor(ms / 60000)).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}`;
    ctx.globalAlpha = 1;
    ctx.font = "bold 26px Consolas, monospace"; ctx.textAlign = "right";
    ctx.fillStyle = "rgba(0,0,0,.65)"; ctx.fillRect(cfg.W - 162, 10, 152, 36);
    ctx.fillStyle = "#fff"; ctx.fillText(label, cfg.W - 18, 37);
    if (render.describe && cfg.list) drawList(render.describe(t));
    return out;
  };

  for (const s of cfg.stills ?? []) await still(s.name, draw(s.frame, 1), cfg.quality);

  // The film in chunks of cfg.clip.chunk seconds, each its own mp4 starting on a keyframe, so render.mjs joins them by stream copy
  const chunks = Math.ceil(DURATION / (cfg.clip?.chunk ?? 30));
  if (cfg.clip) for (const index of cfg.clip.only ?? Array.from({ length: chunks }, (_, i) => i)) {
    if (index >= chunks) { log(`no chunk ${index}: the film has ${chunks}`); continue; }
    const started = performance.now(), first = index * cfg.clip.chunk * FPS, last = Math.floor(Math.min(DURATION, (index + 1) * cfg.clip.chunk) * FPS - 1);
    const output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target: new BufferTarget() });
    const source = new VideoSampleSource({ codec: "avc", bitrate: cfg.clip.bitrate, hardwareAcceleration: "prefer-hardware", keyFrameInterval: 2 });
    output.addVideoTrack(source, { frameRate: FPS });
    await output.start();
    for (let f = first; f <= last; f++) {
      const sample = new VideoSample(draw(f, cfg.clip.samples), { timestamp: (f - first) / FPS, duration: 1 / FPS });
      await source.add(sample);
      sample.close();
    }
    await output.finalize();
    await post(`/chunk/${index}`, output.target.buffer);
    log(`chunk ${index}: ${last - first + 1} frames x${cfg.clip.samples} in ${((performance.now() - started) / 1000).toFixed(1)}s`);
  }
  await done(cfg.clip ? chunks : undefined);
})();
