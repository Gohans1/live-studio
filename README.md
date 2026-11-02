# Live Studio

Watch a Three.js film live in the browser and leave feedback on it, from a PC or a phone. An AI agent reads the feedback and makes the changes.

The creator only watches, taps and talks. Nothing in the studio can edit the film, so a stray thumb can't break the pacing.

<img src="docs/studio.png" width="320" alt="The studio on a phone: the picture with a pin on the tapped ball, big play and note buttons, the timeline with words and actions, and the notes below.">

## Run the demo

Needs Node 20+ and Python 3 (for the small helper scripts). ffmpeg is needed for audio on anything but the machine running it.

```bash
npm install
node src/live.mjs 4321
```

Open http://localhost:4321. The interface text is in Vietnamese for now: **Phát** is play, **Ghi chú** is note.

The server listens on this machine only and has no password. To use a phone, put it behind something private such as `tailscale serve`, never on the open internet.

## Taking notes

- Press the note button, or tap the picture to pin the exact thing you mean. Type or dictate.
- Tap an old note to edit it in the same box, with a warning before it overwrites. Tap its time to jump there.
- The list follows the film, keeping the note nearest the playhead in view.
- Fixed notes move to the History tab with what was done. One press sends them back.

Words aren't lost: every keystroke is kept on the device, unsent notes wait and retry when the signal drops, the file is written atomically, × moves a note to `notes/deleted.jsonl` with an undo, and copies pile up in `renders/notes_backup`.

## Before and after

Every change to the film is kept as a version in `renders/versions`, 30 at most. Press **So sánh** (B) to draw an older version beside the current one, frame for frame.

- "Before" is the version you last watched: using the page counts as watching, opening it doesn't. The list next to the bar picks any other.
- Pink marks on the timeline are where the picture changed, yellow where the sound did. Z and X jump between them, and boxes show the place in the frame. A change over more than half the frame gets no box, since it's the camera or the light.
- **Bật qua lại** (V) flips between the two. On a small screen only one fits, so it's before or after.
- The tab **Thay đổi** lists each change in words, from `edit.json`.

Both versions are drawn at the same second of the voice, so re-pacing the voice marks only what really moved against it, not everything after it. The picture check runs in a headless Chrome (`tools/chrome-headless-shell`, `LIVE_CHROME`, or the system's), saves as it goes, and carries on after a restart.

An old version shows today's asset files, so changed models or textures are listed with a warning rather than compared.

## What the agent gets

Each note in `notes/notes.jsonl` carries the time and frame, the tap position and the object under it, the 3D point, the camera, the shot and how far into it, the words and actions around the moment, whether the film was playing when the note was pressed, the device, and the version of the film. Three pictures go with it: the frame with the pin, the area under the tap, and a strip of the seconds around the moment.

An agent shouldn't read that file raw:

```bash
python notes_report.py             # index by shot, one line per note
python notes_report.py ID ID       # everything about those notes, and the pictures to open
python notes_report.py --shot 3    # everything about one shot's notes
```

## Use it on your own film

Each project keeps its own copy of the studio inside its `src/`, so a clone of the project runs by itself and can change anything it likes:

```bash
node apply.mjs ../my-film --init   # a new project: the studio plus the demo's parts to replace
node apply.mjs ../my-film          # later: bring the newest studio in
node apply.mjs ../my-film --dry    # only say what would happen
```

`.live-studio.json` in the project records the commit it last took. Updating is a three-way merge against that commit: files the project never touched are replaced, its own changes are kept, and if the same lines changed on both sides the file is left alone and named. Improvements meant for every project are made here, then applied. `--init` never writes over a file that already exists.

Replace `src/scene.ts`. It exports `SHOTS`, `SHOTS_OUT`, `DURATION`, `applyEdit` and `buildScene(canvas, W, H, draft)`, which returns `draw(t)` with `draw.tools` attached. The demo scene shows the whole contract in about 80 lines, and `draw(t)` must be able to draw any moment straight away.

All timing lives in `src/edit.json`, in the voice's original seconds, so that actions follow the words when the voice is re-paced. Replace these with your own:

| File | Job |
| --- | --- |
| `assets/public/agent/full_voice.wav` | The voice |
| `voice_map.py` | Word times and waveform for the timeline |
| `sound.py` | The sound mix |
| `voice_edit.py` | Applying voice edits from `edit.json` (a stub here) |
| `make_lite.py` | Small asset copies for phones (empty here) |

## License

MIT. The demo uses [three.js](https://threejs.org) and [esbuild](https://esbuild.github.io), both MIT.
