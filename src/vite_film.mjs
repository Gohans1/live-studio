// The film inside the studio's Vite: the names the page imports it by, one copy of three, and what a saved film file does.
import { join, relative, isAbsolute } from "node:path";
import { normalizePath } from "vite";
import { STUDIO } from "./film.mjs";

const under = (root, file) => { const r = relative(root, file); return !!r && !r.startsWith("..") && !isAbsolute(r); };

export const filmPlugin = (film, { onCode }) => ({
  name: "live-studio-film",
  enforce: "pre",
  config: () => ({
    resolve: {
      alias: [
        { find: /^film\/(.*)$/, replacement: join(film.SRC, "$1") },
        { find: /^live-studio\/edit$/, replacement: join(STUDIO, "src/edit.ts") },
      ],
    },
    // The film is the page's own code, outside the studio's folder, and may import from anywhere in its project (a pack of
    // models beside src/). Its notes, renders and private host names are not code: /@fs/ never serves them. Setting deny
    // replaces Vite's own list, so that list comes first
    server: {
      fs: {
        allow: [STUDIO, film.PROJECT],
        deny: [".env", ".env.*", "*.{crt,pem}", "**/.git/**", ...["notes/**", "renders/**", ".live_hosts"].map((p) => `${normalizePath(film.PROJECT)}/${p}`)],
      },
    },
    optimizeDeps: { entries: [join(STUDIO, "app/index.html"), join(film.SRC, "scene.ts")] },
    // One cache per film, since several films run this studio at once
    cacheDir: join(film.PROJECT, "node_modules/.vite/live-studio"),
  }),
  // Asked for by name from the folder that has it, not aliased to a path: an alias skips three's exports map, and
  // three/addons, three/webgpu and three/tsl stop resolving
  async resolveId(source, importer, options) {
    if (!/^three(\/|$)/.test(source) || options?.custom?.oneThree) return null;
    return this.resolve(source, join(film.threeFrom, "package.json"), { ...options, skipSelf: true, custom: { ...options?.custom, oneThree: true } });
  },
  // A saved film file must not reload a page while someone is speaking a note or watching: the page reloads itself when idle.
  // edit.json is read fresh by the page, never reloaded at all. The film is asked about first: the demo film sits inside the
  // studio's folder. The engine starts timers, listeners and a draw loop when it loads, so a second copy can't be swapped in:
  // the page reloads (at the same second, kept in sessionStorage). The studio's controls keep React's hot updates
  hotUpdate({ file, modules }) {
    if (this.environment.name !== "client") return;
    if (under(film.PROJECT, file)) {
      if (file !== film.EDIT && modules.length) onCode(file);
      return [];
    }
    if (under(join(STUDIO, "app/engine"), file)) {
      this.environment.hot.send({ type: "full-reload" });
      return [];
    }
  },
});
