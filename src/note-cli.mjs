// A note fixed, from the AI's side (note.mjs done): filed through the running studio, which owns notes.jsonl while it runs (two
// writers would lose a note), or straight into the file when no studio is running
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createNotes } from "./notes.mjs";

const version = (project) => {
  try { return execFileSync("git", ["describe", "--tags", "--always", "--dirty"], { cwd: project, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return "no git"; }
};

const studioPort = (project) => {
  try { return JSON.parse(readFileSync(join(project, "renders/live/studio.json"), "utf8")).port; } catch { return null; }
};

export const markDone = async (project, id, what) => {
  const notes = createNotes(project);
  if (!notes.read().some((n) => n.id === id)) throw new Error(`no such note: ${id}`);
  const fix = { what, checkpoint: version(project) };
  const port = studioPort(project);
  if (port) {
    let r = null;
    try {
      r = await fetch(`http://127.0.0.1:${port}/api/notes/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ fix }), signal: AbortSignal.timeout(3000) });
    } catch {} // stopped since it wrote studio.json: nobody else is writing the file
    if (r && !r.ok) throw new Error(`the studio refused it: ${r.status} ${await r.text()}`);
    if (r) return "studio";
  }
  notes.change(id, { fix });
  return "file";
};
