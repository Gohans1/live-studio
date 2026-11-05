import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { STUDIO } from "../src/film.mjs";

// Vite's dev server can't tree-shake: one import from "lucide-react" sends every icon (~5 MB) to the phone. shadcn's CLI writes
// that import into each component it adds, so a new component brings it back
test("the page imports each icon on its own, never lucide's whole set", () => {
  const files = readdirSync(join(STUDIO, "app"), { recursive: true }).filter((f) => /\.tsx?$/.test(f));
  const whole = files.filter((f) => /from\s+["']lucide-react["']/.test(readFileSync(join(STUDIO, "app", f), "utf8")));
  assert.deepEqual(whole, []);
});
