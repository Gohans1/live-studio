import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const app = fileURLToPath(new URL("./app", import.meta.url));

// The studio's own page. src/live.mjs adds the film (its code, its three, its edit.json) when it starts this for one film
export default defineConfig({
  root: app,
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": app } },
});
