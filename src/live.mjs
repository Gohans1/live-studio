// The studio for one film: node src/live.mjs [port] [--lan] inside the film (its src/live.mjs sets LIVE_PROJECT), then open
// http://localhost:4321. Saving the film's code reloads the picture at the same second once nobody is mid-note; saving sound.py
// or an audio file remixes.
import { createServer } from "node:http";
import { networkInterfaces } from "node:os";
import { getRequestListener } from "@hono/node-server";
import { createApi } from "./api.mjs";
import { openFilm } from "./film.mjs";
import { buildPage } from "./page.mjs";

const PORT = Number(process.argv[2]) || 4321;
const LAN = process.argv.includes("--lan");

const events = new Set(); // open pages, see /api/events
const send = (event, data = "") => { for (const page of events) page.writeSSE({ event, data: String(data) }); }; // a page that left is dropped by /api/events itself
let film;
try { film = openFilm(process.env.LIVE_PROJECT ?? process.cwd(), { send }); } catch (e) { console.error(e.message); process.exit(1); }

const page = await buildPage(film, {
  onChange: () => { send("code"); film.versions.changed(); },
  onError: (message) => send("build-error", message), // Vite prints it in this terminal itself
});

// No password here, so nothing but this machine and names the film lists may even ask. A website can point its own name at
// this machine (DNS rebinding), or make the visitor's browser ask it for something. Browsers say where a request comes from
// (Fetch Metadata): another site may link to the studio, nothing more. Origin covers the browsers that don't say
const knownHost = (host) => { const n = (host ?? "").replace(/:\d+$/, "").toLowerCase(); return n === "localhost" || n === "[::1]" || /^\d+\.\d+\.\d+\.\d+$/.test(n) || film.hosts.includes(n); };
const fromElsewhere = (req) => {
  const site = req.headers["sec-fetch-site"];
  if (site) return site !== "same-origin" && site !== "none" && !(req.method === "GET" && req.headers["sec-fetch-mode"] === "navigate" && req.headers["sec-fetch-dest"] === "document");
  if (req.method === "GET" || req.method === "HEAD") return false;
  try { return !!req.headers.origin && new URL(req.headers.origin).host !== req.headers.host; } catch { return true; }
};

const api = getRequestListener(createApi(film, { page, events }).fetch);
const http = createServer((req, res) => {
  if (!knownHost(req.headers.host) || fromElsewhere(req)) { res.statusCode = 403; res.end(); return; }
  try { decodeURI(req.url); } catch { res.statusCode = 400; res.end(); return; } // a path no file can have, before Hono trips on it
  // Another site can't load the film as a script, or show the studio in a frame to steal clicks
  res.setHeader("cross-origin-resource-policy", "same-origin");
  res.setHeader("content-security-policy", "frame-ancestors 'self'");
  res.setHeader("x-content-type-options", "nosniff");
  api(req, res);
});
// Asset files can change where no watcher sees them: looked at while someone is watching, so a page knows soon enough
setInterval(() => { if (events.size) film.versions.changed(); }, 30e3);
film.start();

// This machine only, unless asked: --lan opens it to the network for a phone, and nothing here asks for a password
http.listen(PORT, LAN ? "0.0.0.0" : "127.0.0.1", () => {
  console.log(`live at http://localhost:${PORT}`);
  if (LAN) for (const nets of Object.values(networkInterfaces())) for (const n of nets) if (n.family === "IPv4" && !n.internal) console.log(`no password: anyone on this network can open http://${n.address}:${PORT} and change the notes. tailscale serve is the safe way to a phone`);
});
