// The studio for one film: node src/live.mjs [port] [--lan] inside the film (its src/live.mjs sets LIVE_PROJECT), then open
// http://localhost:4321. Saving the film's code reloads the picture at the same second once nobody is mid-note; saving sound.py
// or an audio file remixes.
import { createServer } from "node:http";
import { networkInterfaces } from "node:os";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getRequestListener } from "@hono/node-server";
import { createServer as createVite } from "vite";
import { createApi } from "./api.mjs";
import { openFilm, STUDIO } from "./film.mjs";
import { filmPlugin } from "./vite_film.mjs";

const PORT = Number(process.argv[2]) || 4321;
const LAN = process.argv.includes("--lan");

let vite;
const send = (event, data = "") => vite?.ws.send(`live:${event}`, data);
let film;
try { film = openFilm(process.env.LIVE_PROJECT ?? process.cwd(), { send }); } catch (e) { console.error(e.message); process.exit(1); }

// No password here, so nothing but this machine and names the film lists may even ask. A website can point its own name at
// this machine (DNS rebinding) or post to it from the visitor's browser
const knownHost = (host) => { const n = (host ?? "").replace(/:\d+$/, "").toLowerCase(); return n === "localhost" || n === "[::1]" || /^\d+\.\d+\.\d+\.\d+$/.test(n) || film.hosts.includes(n); };
const fromElsewhere = (req) => { try { return !!req.headers.origin && new URL(req.headers.origin).host !== req.headers.host; } catch { return true; } };

const http = createServer();
vite = await createVite({
  configFile: join(STUDIO, "vite.config.ts"),
  // custom: the film's files live at any path, so an unknown path is a 404 from them, never the page (Vite's spa fallback)
  appType: "custom",
  server: { middlewareMode: true, ws: { server: http }, allowedHosts: film.hosts },
  plugins: [filmPlugin(film, { onCode: (file) => { send("code", file); film.versions.changed(); } })],
});
const api = getRequestListener(createApi(film).fetch);
const page = async (req, res) => {
  try {
    const html = await vite.transformIndexHtml(req.url, await readFile(join(STUDIO, "app/index.html"), "utf8"));
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.setHeader("cache-control", "no-cache");
    res.setHeader("content-security-policy", "frame-ancestors 'self'");
    res.end(html);
  } catch (e) { vite.ssrFixStacktrace(e); res.statusCode = 500; res.end(e.message); }
};
http.on("request", (req, res) => {
  if (!knownHost(req.headers.host) || (req.method !== "GET" && req.method !== "HEAD" && fromElsewhere(req))) { res.statusCode = 403; res.end(); return; }
  try { decodeURI(req.url); } catch { res.statusCode = 400; res.end(); return; } // a path no file can have, before Vite or Hono trip on it
  if (req.url.startsWith("/api/")) { api(req, res); return; }
  if (req.url === "/" || req.url.startsWith("/?")) { page(req, res); return; }
  vite.middlewares(req, res, () => api(req, res));
});
// Asset files can change where no watcher sees them: looked at while someone is watching, so a page knows soon enough
setInterval(() => { if (vite.ws.clients.size) film.versions.changed(); }, 30e3);
film.start();

// This machine only, unless asked: --lan opens it to the network for a phone, and nothing here asks for a password
http.listen(PORT, LAN ? "0.0.0.0" : "127.0.0.1", () => {
  console.log(`live at http://localhost:${PORT}`);
  if (LAN) for (const nets of Object.values(networkInterfaces())) for (const n of nets) if (n.family === "IPv4" && !n.internal) console.log(`no password: anyone on this network can open http://${n.address}:${PORT} and change the notes. tailscale serve is the safe way to a phone`);
});
