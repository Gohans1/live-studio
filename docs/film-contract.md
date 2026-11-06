# The film contract

What the studio reads from a film: the schemas in [`src/contract.mjs`](../src/contract.mjs) are the truth, [`demo/`](../demo) is a working film, and the studio checks every film on start and save (terminal + **PHIM SAI QUY ƯỚC** on the picture).

## Rules

- One studio linked into every film (`node live-studio/init.mjs FILM`): a feature a film needs becomes an optional hook here plus one line on this page, never a patch inside one film.
- `draw(t)` draws any heard second straight away, remembering nothing from earlier frames.
- Whatever the schemas don't name (camera keys, props, audio, lighting) is the film's own and passes through untouched.

## Film files

- `src/scene.ts`: `SHOTS`, `SHOTS_OUT`, `DURATION`, `applyEdit`, `buildScene(canvas, W, H, draft)` → `draw(t)` with `draw.tools` (scene, camera, look, `free` camera it must obey when `on`; optional `objects`/`materials`/`rig`/`bones` name what a tap hit).
- `src/edit.ts`: `setEdit(data)` then `export * from "live-studio/edit"`; the place to merge the film's own timeline files.
- `src/edit.json`: `voice {edits, warp}` + `beats`, all times in the voice's source seconds; the studio never writes it, and saving it (like any code) rebuilds the page, which shows **Có bản mới** instead of reloading.
- `package.json`: scripts `studio PORT`/`notes`/`note`/`render` (from `init.mjs`), `"live-studio": { "sound": [the mix's inputs, never its outputs], "chrome": headless Chrome path }`.
- `sound.py OUT.wav` (the studio mix), `voice_map.py` (word times once there is a voice), optional `voice_edit.py`/`make_lite.py`, `assets/public/` served as `/`, `.live_hosts` (host names allowed in, e.g. Tailscale's).

## Optional hooks

- `draw.describe(t)`: the list top left (key `I`, and in draft renders); name every technique and its source file, `fresh` shows NEW.
- `draw.checks`: `{ name(...numbers) → lines }`, printed by `CHECK=name:args bun run render`, for what a picture cannot show (feet sliding).
- `draw.variants`: looks to switch (build all once, `set(id)` toggles, chip near `ranges`); **Chốt** writes `choices.json`, which the film's own renders and final mix must apply.
- `renders/live/trials.json` (from `sound.py`): sound options per group, each one stem at film level, the film's own first; picked into `choices.json` the same way.

## Draft renders

`bun run render stills|clip` inside the film; its options (AT, NOLIST, CHUNKS, INSPECT, CHECK, ENTRY + LAB_*) are in the header of [`render.mjs`](../render.mjs), and lab pages import `live-studio/lab`.

## Notes

`bun run notes` then `bun run notes ID`, read in written order (#1 first, later ones may take back earlier ones), fix and verify, then `bun run note done ID "what changed, plain Vietnamese"`; one you can't fix stays open with the reason in your reply, and nobody edits `notes.jsonl` by hand.

## Load weight

Over 10 MB on a phone's first load the terminal names the biggest files: load only the part of an archive the page reads, give phones `make_lite.py` copies (`/lite/` via `window.__assets`), then pixel-compare frames against the old build.

## New film

`init.mjs FILM` → replace `src/scene.ts` and `src/edit.json` → `bun run studio` prints both `film contract ... ok` lines → point the film's `AGENTS.md` here.
