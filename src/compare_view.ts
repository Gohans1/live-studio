// @ts-nocheck
// One version of the film, alone in a frame, for the studio to draw beside the current one. Its edit.json is the version's own (see versions.mjs).
import { buildScene, DURATION, SHOTS_OUT } from "film/scene";
import { fromSource, toSource } from "film/edit";

(async () => {
  try { if (parent.__assets) window.__assets = parent.__assets; } catch {}
  const q = new URLSearchParams(location.search), W = Number(q.get("w")) || 960, H = Number(q.get("h")) || 540;
  const canvas = document.getElementById("gl");
  canvas.width = W; canvas.height = H;
  const render = await buildScene(canvas, W, H, true);
  let last = 0;
  window.__film = { canvas, duration: DURATION, toSource, fromSource, draw: (t) => { last = t; render(t); } };
  // Shaders compile on first use: touch each shot while idle, and put the frame being shown back in the same task
  const warm = SHOTS_OUT.map((s) => s.t + 0.1);
  if (!q.has("job")) {
    const step = () => { if (!warm.length) return; render(warm.shift()); render(last); setTimeout(step, 60); };
    step();
  }
  parent.postMessage({ filmReady: true }, "*");
})().catch((e) => parent.postMessage({ filmError: e?.message ?? `không tải được ${e?.target?.src ?? "file"}` }, "*"));
