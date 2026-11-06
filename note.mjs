// A note fixed, from the AI's side. Run inside the film (docs/film-contract.md, "Notes"):
//   bun run note done ID "what changed"   (node node_modules/live-studio/note.mjs) the note folds away under "Đã xong" in the studio, with these words
import { markDone } from "./src/note-cli.mjs";

const project = process.env.LIVE_PROJECT ?? process.cwd();
const [cmd, id, ...words] = process.argv.slice(2);
if (cmd === "done" && id && words.length) {
  try { console.log(`${id} done (${await markDone(project, id, words.join(" "))})`); }
  catch (e) { console.error(e.message); process.exit(1); }
} else {
  console.error('usage: bun run note done ID "what changed"');
  process.exit(2);
}
