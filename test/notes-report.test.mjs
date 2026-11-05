// notes_report.py, what the AI reads before acting: notes come in the order the creator wrote them, since a later note
// often builds on or takes back an earlier one, and film order would hide that
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const REPORT = join(dirname(fileURLToPath(import.meta.url)), "../notes_report.py");
const note = (id, t, at, extra = {}) => ({ id, t, at, time: `00:${String(t).padStart(2, "0")}.000`, shot: 1, text: `note at ${t}`, ...extra });
const film = (notes) => {
  const dir = mkdtempSync(join(tmpdir(), "film-"));
  mkdirSync(join(dir, "notes"));
  writeFileSync(join(dir, "notes/notes.jsonl"), notes.map((n) => JSON.stringify(n) + "\n").join(""));
  return dir;
};
const report = (dir, ...args) => execFileSync("python", [REPORT, ...args], { cwd: dir, encoding: "utf8" });
const written = [note("a", 5, "2026-11-06T10:00:00Z"), note("b", 10, "2026-11-06T10:01:00Z"), note("c", 8, "2026-11-06T10:02:00Z")];

test("the index lists notes in the order they were written, numbered", () => {
  const lines = report(film(written)).split("\n").filter((l) => l.startsWith("#"));
  assert.deepEqual(lines.map((l) => l.split(" ").slice(0, 2).join(" ")), ["#1 a", "#2 b", "#3 c"]);
});

test("a note keeps its number once the notes before it are done", () => {
  const dir = film([{ ...written[0], done: true }, written[1], written[2]]);
  const lines = report(dir).split("\n").filter((l) => l.startsWith("#"));
  assert.deepEqual(lines.map((l) => l.split(" ")[0]), ["#2", "#3"]);
});

test("details come in the order written too, with the number", () => {
  const heads = report(film(written), "c", "a", "b").split("\n").filter((l) => l.startsWith("## "));
  assert.deepEqual(heads.map((l) => l.split(" ").slice(1, 3).join(" ")), ["#1 a", "#2 b", "#3 c"]);
});
