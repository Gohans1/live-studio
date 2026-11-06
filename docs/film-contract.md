# The film contract

Everything the studio reads from a film, in one place. A film that keeps to it gets the whole studio: notes, the timeline, the clock, the list of what is going on at each frame (top left), options to switch between as the film plays (right), and what changed since the last watch. The schemas in [`src/contract.mjs`](../src/contract.mjs) are the source of truth. This page explains them.

The studio checks a film against them on every start and every change: the film's JSON files on the server, its code in the page once built. Anything wrong is printed in the studio's terminal and shown on the picture as **PHIM SAI QUY ƯỚC**, with the file and the field to fix.

## Who owns what

There is one studio, this repo, linked into every film. A film never holds a copy of studio code. Studio features shared by every film live here: the clock, the review list, the option chips, the timeline and the notes. A film decides only what goes into them, through the hooks below.

When a film needs something the studio can't show yet, add it to the studio as a new optional hook and document it here. Then every film can use it. Don't patch around it inside one film.

Everything not named here belongs to the film: its camera keys, its audio section in `edit.json`, props, lighting, render scripts. The schemas pass unknown fields through untouched.

## Files

| File | What it is |
| --- | --- |
| `src/scene.ts` | The film. Exports below |
| `src/edit.ts` | `export * from "live-studio/edit"` after `setEdit(data)` from `edit.json` (written by `init.mjs`) |
| `src/edit.json` | Every time in the film, in the voice's original seconds (big parts may live in other files that `src/edit.ts` merges in) |
| `src/live.mjs` | Opens this film in the studio (written by `init.mjs`) |
| `sound.py OUT.wav` | The studio's mix, plus `trials.json` beside it when the film has sound options |
| `voice_map.py`, `voice_edit.py`, `make_lite.py` | Word times, voice edits, phone copies (stubs are fine) |
| `assets/public/` | Served as `/` |

`node live-studio/init.mjs FILM` writes the pointer files, and copies any part a film lacks from `demo/`.

## `src/scene.ts`

```ts
export const SHOTS: { t: number }[];      // shots in source seconds, at least one
export const SHOTS_OUT: { t: number }[];  // the same shots in heard seconds, one per shot, in order
export let DURATION: number;              // heard seconds, > 0
export function applyEdit(): void;        // recomputes SHOTS_OUT and DURATION after edit.json changes
export async function buildScene(canvas, W, H, draft): Promise<Draw>;
```

`Draw` is `draw(t)`, a function that draws any heard second straight away, with these attached:

### `draw.tools` (required)

| Field | Type | Used for |
| --- | --- | --- |
| `scene` | `THREE.Scene` | what a tap on the picture hit |
| `camera` | `THREE.Camera` | the same, and the free camera |
| `look` | `THREE.Vector3` | where the camera looks |
| `free` | `{ on, p, l, fov }` | the studio's free camera; `draw` must use it when `on` |
| `objects` | `[Object3D, name][]`, optional | names what a tap hit |
| `materials` | `[Material, name][]`, optional | the same, by material |
| `rig`, `bones` | optional | names body parts of a tapped character |
| `zoomOf`, `smoother`, `head`, `CELL` | optional, old | only for a camera that lives in `SHOTS`; without them **Chép** copies the camera in world terms |

### `draw.describe(t)` (optional): the list top left

The page starts with it off; the viewer switches it on with `I` or in the settings, and the page remembers that.

Returns what is going on at heard second `t`, read right after `draw(t)`:

```ts
[{ head: "CAMERA", lines: [{ text: "move: pan left", fresh: true }] }]
```

`fresh` marks something that just started; it shows as NEW. Draft renders draw the same list. Name every technique and its source file, so the creator can point at it.

### `draw.variants` (optional): looks to switch between

```ts
[{
  id: "computer", title: "computer",
  options: [{ id: "computer", title: "gray office CRT" }, { id: "computer_beige", title: "beige 90s CRT" }],  // the first is the film's own
  set(id) {},      // shows that look on the next draw, instantly
  pick: { id, title },  // the look shown now
  ranges: [[from, to]],  // heard seconds when it is on screen; a getter that recomputes when the camera changes is fine
}]
```

Build every look once and toggle visibility in `set`. A chip appears on the picture when one of `ranges` is near the playhead. **Chốt** writes the pick to `choices.json`. The film's own renders must read that file and call `set` before drawing.

## `src/edit.json`

The studio reads these keys. Everything else is the film's.

```jsonc
{
  "voice": { "edits": {}, "warp": [[src, out], ...] },  // warp maps source seconds to heard seconds; [] for none
  "beats": { "id": { "title": "", "at": 0, "dur": 1, "kind": "motion" | "sound", "sounds": [[offset, "name", gain]] } }
}
```

The studio only reads `edit.json`. It never writes it. Changes come from notes, made by the agent. Saving it rebuilds the page like any code change: the page shows **Có bản mới**, and a reload has it. The film may keep its own keys in other files and merge them into the data it passes to `setEdit` in `src/edit.ts`.

## Sound options: `renders/live/trials.json`

Written by the film's `sound.py` next to the studio mix. The studio plays each group itself, and leaves it out of the mix. One group per sound with options:

```jsonc
{
  "room_hum": {
    "title": "room hum (bed)", "kind": "stem", "from": 0, "to": 27,   // film seconds the stem covers
    "options": [{ "id": "room_hum", "title": "…", "files": ["/agent/stems/room_hum/room_hum.webm"] }, …]
  }
}
```

Give each option one recording of that stretch, at the level it would have in the film, with the film's own sound first. The older kind, with `cues` instead of `kind`, plays one hit per cue. **Chốt** writes `{ group: { set, gain } }` to `choices.json`, and the film's final mix must read it.

## `choices.json`

Written by the studio only, at the film's root (`sound_choices.json` in films that started with that name). It holds the picks for both looks and sounds, keyed by variant id or sound group: `{ "computer": { "set": "computer_beige", "gain": 1 } }`.

## Notes: closing them

The creator's notes land in `notes/notes.jsonl` while the studio runs.

1. Read before acting: `python notes_report.py` for the index, `python notes_report.py ID` for one note with its pictures. Notes come in the order the creator wrote them (#1 first), not film order: a later note often builds on or takes back an earlier one, so read them all in that order before fixing any.
2. Fix it and check it the way that note asks (look at the frame, listen, run the tests).
3. Close it: `node node_modules/live-studio/note.mjs done ID "what you changed"`, in Vietnamese and plain words, because the creator reads them under the note. The note folds away under **Đã xong** at the bottom of **Cần sửa**. A note you could not fix stays open: say why in your reply instead.

`done` goes through the running studio, which owns `notes.jsonl` while it runs (it records its port in `renders/live/studio.json`), and writes the file itself only when no studio runs. Never edit `notes.jsonl` by hand. **Chưa ưng** on a fixed note opens it again.

## Load weight

A page opened from a phone or over Tailscale tells the studio, once it is ready, what it downloaded (`POST /api/weight`), at each file's size on the wire. Over 10 MB, about 4 s on a phone, the terminal names the biggest files. This PC loads the full files and is not judged. The studio already compresses whatever shrinks; the rest is the film's to slim:

- Load the part of an archive the page reads, not the archive. The Minecraft film's `slim_jar.py` keeps client.jar's `assets/` and `data/` and drops the Java code: 7 MB on the wire instead of 41.
- Give phones small copies of big pictures and models with `make_lite.py` (served under `/lite/`); the film loads them by prefixing its paths with `window.__assets`, which is `/lite/` away from this PC.
- After slimming, compare the same frames pixel by pixel against the old build before keeping it.

## Checklist for a new film or a new hook

1. `node live-studio/init.mjs FILM`, then replace `src/scene.ts` and `src/edit.json` with the film.
2. Start the studio. The terminal says `film contract, files: ok` and `film contract, code, found by the page: ok`, no red badge shows, and no first visit is over budget.
3. Put the film's facts in `draw.describe`, and every choice still open in `draw.variants` or `trials.json`.
4. Point the film's `AGENTS.md` at this page.
