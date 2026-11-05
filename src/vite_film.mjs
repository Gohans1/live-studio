// The film inside the studio's Vite build: the names the page imports it by, and one copy of three.
import { join } from "node:path";
import { STUDIO } from "./film.mjs";

export const filmPlugin = (film) => ({
  name: "live-studio-film",
  enforce: "pre",
  config: () => ({
    resolve: {
      alias: [
        { find: /^film\/(.*)$/, replacement: join(film.SRC, "$1") },
        { find: /^live-studio\/edit$/, replacement: join(STUDIO, "src/edit.ts") },
      ],
    },
  }),
  // Asked for by name from the folder that has it, not aliased to a path: an alias skips three's exports map, and
  // three/addons, three/webgpu and three/tsl stop resolving
  async resolveId(source, importer, options) {
    if (!/^three(\/|$)/.test(source) || options?.custom?.oneThree) return null;
    return this.resolve(source, join(film.threeFrom, "package.json"), { ...options, skipSelf: true, custom: { ...options?.custom, oneThree: true } });
  },
});
