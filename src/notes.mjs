// Notes spoken in the studio: one JSON object per line in notes/notes.jsonl, so an AI agent can read them. Pictures sit beside
// them in notes/img. Notes are an hour of someone's work: one bad line can't hide the rest, a crash mid-write can't cut the file,
// × only moves a note to notes/deleted.jsonl, and copies pile up in renders/notes_backup.
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const BACKUP_EVERY = 5 * 60e3;

export const createNotes = (project) => {
  const file = join(project, "notes/notes.jsonl");
  const img = join(project, "notes/img");
  const deleted = join(project, "notes/deleted.jsonl");
  const backups = join(project, "renders/notes_backup");
  for (const d of [dirname(file), img, backups]) mkdirSync(d, { recursive: true });
  if (!existsSync(file)) writeFileSync(file, "");

  const parse = (f) => (existsSync(f) ? readFileSync(f, "utf8") : "").split("\n").filter((l) => l.trim()).flatMap((l) => {
    try { return [JSON.parse(l)]; } catch { console.error("bad note line kept in backups:", l); return []; }
  });
  const read = () => parse(file);

  let backedUp = 0;
  const backup = () => {
    if (Date.now() - backedUp < BACKUP_EVERY || !existsSync(file) || !statSync(file).size) return; // gone is no reason to refuse the next note
    backedUp = Date.now();
    copyFileSync(file, join(backups, `notes-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`));
  };
  const write = (all) => {
    backup();
    const fresh = `${file}.new`;
    writeFileSync(fresh, all.map((n) => JSON.stringify(n) + "\n").join(""), { flush: true });
    for (let i = 0; ; i++) {
      try { renameSync(fresh, file); return; } // Windows refuses while something is reading it
      catch (e) { if (i >= 20) throw e; Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50); }
    }
  };
  const savePicture = (name, dataUrl) => writeFileSync(join(img, `${name}.jpg`), Buffer.from(dataUrl.split(",")[1], "base64"));

  // A new note, with up to three pictures (data URLs). What has been done to a note is the server's to say
  const add = ({ note, img: picture, crop, strip }, stamp) => {
    for (const k of ["crop", "strip", "fixes", "edits", "done"]) delete note[k];
    note.img = picture ? `notes/img/${note.id}.jpg` : undefined;
    if (picture) savePicture(note.id, picture);
    for (const [kind, pic] of [["crop", crop], ["strip", strip]]) {
      if (!pic) continue;
      note[kind] = `notes/img/${note.id}_${kind}.jpg`;
      savePicture(`${note.id}_${kind}`, pic);
    }
    Object.assign(note, stamp);
    const all = read();
    if (!all.some((n) => n.id === note.id)) write([...all, note]); // a retry after a lost answer isn't a second note
  };

  const change = (id, c) => {
    const all = read();
    let n = all.find((x) => x.id === id);
    if (n && c.remove) {
      appendFileSync(deleted, JSON.stringify(n) + "\n", { flush: true });
      write(all.filter((x) => x !== n));
    } else if (c.restore) {
      const gone = parse(deleted);
      if (!n) { n = gone.findLast((x) => x.id === id); if (n) all.push(n); }
      if (n && typeof c.text === "string") n.text = c.text;
      write(all);
      writeFileSync(deleted, gone.filter((x) => x.id !== id).map((x) => JSON.stringify(x) + "\n").join(""));
    } else if (n && c.fix) { // answered: stays as history with what was done
      n.done = true;
      n.fixes = [...(n.fixes ?? []), { ...c.fix, at: new Date().toISOString() }];
      write(all);
    } else if (n && typeof c.text === "string") { // changed words are open again, and what they said stays on record
      if (c.text !== n.text) n.edits = [...(n.edits ?? []), { at: new Date().toISOString(), was: n.text }];
      n.text = c.text;
      n.done = false;
      write(all);
    } else if (n) { n.done = !!c.done; write(all); }
  };

  const picture = (name) => { const p = join(img, `${name}.jpg`); return existsSync(p) ? readFileSync(p) : null; };

  return { file, read, add, change, picture };
};
