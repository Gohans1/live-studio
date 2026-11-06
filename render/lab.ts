// @ts-nocheck
// What a page run by render.mjs talks to: the studio's own render page, or a film's lab page (ENTRY=lab/x.ts), which imports
// this as "live-studio/lab". The page runs in a headless Chrome; everything it says comes back to the terminal.
export const post = (url, body) => fetch(url, { method: "POST", body });
export const log = (m) => post("/log", String(m));
// A page that throws ends the run with the error, instead of leaving it to wait out its time limit
window.onerror = (m, s, l, c, e) => { log("ERROR " + (e?.stack ?? m)); };
window.onunhandledrejection = (e) => { log("ERROR " + (e.reason?.stack ?? e.reason)); };

// { W, H, draft, quality, stills: [{ name, frame }], clip, list, inspect, checks, choices, lab }: see render.mjs
export const config = async () => (await fetch("/config")).json();
export const canvas = () => document.getElementById("gl");
// Written as renders/NAME
export const still = async (name, from, quality = 0.92) => post(`/still/${name}`, await new Promise((res) => from.toBlob(res, "image/jpeg", quality)));
// Ends the run; chunks: how many clip chunks the film has, so render.mjs joins exactly those
export const done = (chunks) => post("/done", chunks === undefined ? "" : String(chunks));
