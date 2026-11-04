// esbuild plugins shared by the studio's page builds.
import { builtinModules } from "node:module";

const BUILTIN = new RegExp(`^(node:)?(${builtinModules.map((m) => m.replace(/[/]/g, "\/")).join("|")})$`);

// The page runs in a browser, which has no Node built-ins, yet some game-data libraries require one on code paths a film
// never reaches (MineRender's prismarine-nbt: zlib, assert). Like Vite, give those an empty module instead of failing the
// whole page. A real browser package installed under the same name (npm "buffer") still wins.
export const nodeBuiltinsEmpty = {
  name: "node-builtins-empty",
  setup(b) {
    b.onResolve({ filter: BUILTIN }, async (args) => {
      if (args.pluginData?.builtin) return undefined;
      const found = await b.resolve(args.path, { kind: args.kind, resolveDir: args.resolveDir, importer: args.importer, pluginData: { builtin: true } });
      return found.errors.length ? { path: args.path, namespace: "node-builtin-empty" } : undefined;
    });
    b.onLoad({ filter: /.*/, namespace: "node-builtin-empty" }, () => ({ contents: "module.exports = {};", loader: "js" }));
  },
};
