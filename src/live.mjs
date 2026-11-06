// The studio for one film: bun run studio inside the film (node node_modules/live-studio/src/live.mjs [port] [--lan]; the
// film is the folder it runs in, or LIVE_PROJECT), then open http://localhost:4321 or the Tailscale link it prints. Saving the film's code offers "Có bản mới" on the page, never reloading it unasked; saving sound.py
// or anything the film's package.json lists under "live-studio".sound remixes.
import { execFile } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
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
// One studio per film: it owns notes.jsonl, and note.mjs done finds it through renders/live/studio.json, which a second one
// would take over
try {
  const { port } = JSON.parse(readFileSync(join(film.WORK, "studio.json"), "utf8"));
  if (port !== PORT && (await fetch(`http://127.0.0.1:${port}/api/notes`, { signal: AbortSignal.timeout(1500) })).ok) {
    console.error(`this film's studio already runs at http://localhost:${port}: use that one, or stop it first`);
    process.exit(1);
  }
} catch { /* none recorded, or it no longer answers */ }

const page = await buildPage(film, {
  onChange: () => send("code"),
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
film.start();

// This machine only, unless asked: --lan opens it to the network for a phone, and nothing here asks for a password
http.listen(PORT, LAN ? "0.0.0.0" : "127.0.0.1", () => {
  console.log(`live at http://localhost:${PORT}`);
  writeFileSync(join(film.WORK, "studio.json"), JSON.stringify({ port: PORT })); // where note.mjs done finds the studio that owns the notes
  tailscaleLink();
  if (LAN) for (const nets of Object.values(networkInterfaces())) for (const n of nets) if (n.family === "IPv4" && !n.internal) console.log(`no password: anyone on this network can open http://${n.address}:${PORT} and change the notes. tailscale serve is the safe way to a phone`);
});

// The link the creator opens: the Tailscale https names that serve this port. Said every start, because after a reboot
// Tailscale is often not running yet, and a name missing from .live_hosts answers every request with 403
function tailscaleLink() {
  execFile("tailscale", ["serve", "status", "--json"], { timeout: 5000, windowsHide: true }, (e, out) => {
    let web = null;
    try { web = JSON.parse(out).Web ?? {}; } catch {}
    if (e || !web) { console.log("Tailscale is not answering: start the Tailscale app (often not running after a reboot); its links come back with it"); return; }
    const mine = Object.entries(web).filter(([, w]) => Object.values(w.Handlers ?? {}).some((h) => /^https?:\/\/(127\.0\.0\.1|localhost):(\d+)\/?$/.exec(h.Proxy ?? "")?.[2] === String(PORT))).map(([host]) => host);
    if (!mine.length) { console.log(`no Tailscale link to port ${PORT}: tailscale serve --bg --https=<a free port> http://127.0.0.1:${PORT}`); return; }
    for (const host of mine) {
      const name = host.replace(/:\d+$/, "").toLowerCase();
      console.log(film.hosts.includes(name) ? `creator's link: https://${host}` : `https://${host} serves this studio but answers 403: add ${name} to .live_hosts in the film`);
    }
  });
}
