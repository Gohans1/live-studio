// The film inside the studio's Vite: the names the page imports it by, one copy of three, and what a saved film file does.
import { join, relative, isAbsolute } from "node:path";
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
    // The film is the page's own code, outside the studio's folder; its node_modules are its own
    server: { fs: { allow: [STUDIO, film.PROJECT] } },
    optimizeDeps: { entries: [join(STUDIO, "app/index.html"), join(film.SRC, "scene.ts")] },
    cacheDir: join(film.WORK, "vite"),
  }),
  // Asked for by name from the folder that has it, not aliased to a path: an alias skips three's exports map, and
  // three/addons, three/webgpu and three/tsl stop resolving
  async resolveId(source, importer, options) {
    if (!/^three(\/|$)/.test(source) || options?.custom?.oneThree) return null;
    return this.resolve(source, join(film.threeFrom, "package.json"), { ...options, skipSelf: true, custom: { ...options?.custom, oneThree: true } });
  },
  // A saved film file must not reload a page while someone is speaking a note or watching: the page reloads itself when idle.
  // edit.json is read fresh by the page, never reloaded at all. The studio's own files keep Vite's hot updates
  hotUpdate({ file, modules }) {
    if (this.environment.name !== "client" || under(STUDIO, file) || !under(film.PROJECT, file)) return;
    if (file === film.EDIT) return [];
    if (modules.length) onCode(file);
    return [];
  },
});
