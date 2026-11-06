// The studio page for one film: Vite builds it (the studio's app/ with the film's src/ inside) and builds it again on every save
// of either. A page only hears about a build that came out different, so a saved comment or a save of the same text reloads
// nothing. Built, not served by Vite's dev server: that server reloads every open page whenever its connection drops, and a
// phone's connection drops each time its screen locks.
import { readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { constants } from "node:zlib";
import { build } from "vite";
import { compression, defineAlgorithm } from "vite-plugin-compression2";
import { STUDIO } from "./film.mjs";
import { filmPlugin } from "./vite_film.mjs";

export const ASSETS = "_studio"; // the page's own files, under a name no film folder in assets/public uses
// How long a build's files outlive it. A page that loaded the last build's index.html still fetches its code (and App later, on
// its own), and a page left open asks for its source maps when it throws
const KEEP = 3600e3;

export const buildPage = (film, { onChange = () => {}, onError = () => {} } = {}) => new Promise((ready, fail) => {
  // One per film, since several films run this studio at once
  const dir = join(film.PROJECT, "node_modules/.vite/live-studio-page");
  let html = null, error = null, started = false;
  const warned = new Set();
  // Every build writes all its files again, unchanged ones too, so a file's age on disk is the time since a build last used it
  const clearOld = () => {
    const code = join(dir, ASSETS), now = Date.now();
    for (const f of readdirSync(code)) {
      try { if (now - statSync(join(code, f)).mtimeMs > KEEP) rmSync(join(code, f), { force: true }); }
      catch (e) { console.log(`not cleared: ${f}: ${e.message}`); } // a file Windows holds open goes next time
    }
  };
  const page = { dir, html: () => html, error: () => error, watcher: null, close: () => page.watcher?.close() };
  const start = () => { if (!started) { started = true; ready(page); } };
  build({
    configFile: join(STUDIO, "vite.config.ts"),
    logLevel: "warn",
    // Squeezed once per build, beside each file, so a phone over Tailscale downloads about a quarter. Brotli at 9, not 11:
    // nearly as small, and a save is ready to reload in a fraction of a second instead of six
    plugins: [filmPlugin(film), compression({ algorithms: [defineAlgorithm("brotliCompress", { params: { [constants.BROTLI_PARAM_QUALITY]: 9 } }), "gzip"] })],
    build: {
      outDir: dir,
      emptyOutDir: false, // see clearOld
      assetsDir: ASSETS,
      sourcemap: true,
      // Names kept: a film that throws shows its stack in the page and in this terminal, where no source map reaches
      rolldownOptions: {
        output: { minify: { mangle: false } },
        // Each warning once per run: a film's Node libraries would otherwise repeat theirs on every save
        onLog: (level, log, show) => { if (level !== "warn" || !warned.has(log.message)) { if (level === "warn") warned.add(log.message); show(level, log); } },
      },
      reportCompressedSize: false,
      chunkSizeWarningLimit: Infinity,
      watch: {},
    },
  }).then((watcher) => {
    page.watcher = watcher;
    watcher.on("event", (e) => {
      e.result?.close?.();
      if (e.code === "ERROR") {
        error = stripVTControlCharacters(e.error.message); // the page shows it as text, and Rolldown colours it for a terminal
        onError(error);
        start(); // the page answers with the error until a save fixes it
      }
      if (e.code === "BUNDLE_END") {
        const next = readFileSync(join(dir, "index.html"), "utf8");
        // File names carry a hash of their contents and of what they import, so the same index.html is the same page. A page
        // that saw an error needs the fixed build even when it came out the same as before
        const changed = next !== html || error !== null;
        html = next;
        error = null;
        clearOld();
        if (started && changed) onChange();
        start();
      }
    });
  }, fail);
});
