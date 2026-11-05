# Live Studio

Watch a Three.js film live in the browser and leave feedback on it, from a PC or a phone. An AI agent reads the feedback and makes the changes.

The creator only watches, taps and talks. Nothing in the studio can edit the film, so a stray thumb can't break the pacing.

<img src="docs/studio.png" width="320" alt="The studio on a phone: the picture with a pin on the tapped ball, big play and note buttons, the timeline with words and actions, and the notes below.">

## Run the demo

Needs Node 22+, [Bun](https://bun.sh) and Python 3 (for the small helper scripts). ffmpeg is needed for audio on anything but the machine running it.

```bash
bun install
bun run demo -- 4321
```

Open http://localhost:4321. The interface text is in Vietnamese for now: **Phát** is play, **Ghi chú** is note.

The server listens on this machine only and has no password. To use a phone, put it behind something private such as `tailscale serve`, never on the open internet. It answers only to `localhost` and IP addresses, so list the name you reach it by, such as your Tailscale machine's, in a `.live_hosts` file in the film, one per line, and keep that file out of a public repo. A page reached by any other name gets a 403.

## Taking notes

- Press the note button, or tap the picture to pin the exact thing you mean. Type or dictate.
- Tap an old note to edit it in the same box, with a warning before it overwrites. Tap its time to jump there.
- The list follows the film, keeping the note nearest the playhead in view.
- Fixed notes move to the History tab with what was done. One press sends them back.

Words aren't lost: every keystroke is kept on the device, unsent notes wait and retry when the signal drops, the file is written atomically, × moves a note to `notes/deleted.jsonl` with an undo, and copies pile up in `renders/notes_backup`.

## What changed

Every change to the film is kept as a version in `renders/versions`, 30 at most, and cheaply: `edit.json`, how loud the mix was over time, and fingerprints of the film's code and assets. The tab **Thay đổi** (B) lists what changed since the version you last watched, in words with times: edits from `edit.json`, where the sound changed, and whether code or asset files changed. Using the page counts as watching, opening it doesn't; the list over the timeline picks any other version. Marks on the timeline show each change, and Z and X jump between them.

No old version is drawn. To weigh looks or sounds against each other, a film offers them as options (see below), which shows the difference at once and costs nothing.

## What the agent gets

Each note in `notes/notes.jsonl` carries the time and frame, the tap position and the object under it, the 3D point, the camera, the shot and how far into it, the words and actions around the moment, whether the film was playing when the note was pressed, the device, and the version of the film. Three pictures go with it: the frame with the pin, the area under the tap, and a strip of the seconds around the moment.

An agent shouldn't read that file raw:

```bash
python notes_report.py             # index by shot, one line per note
python notes_report.py ID ID       # everything about those notes, and the pictures to open
python notes_report.py --shot 3    # everything about one shot's notes
```

## Use it on your own film

There is one studio: this repo. A film never holds a copy, so a fix made here reaches every film the next time its studio starts.

```bash
git clone https://github.com/Gohans1/live-studio ../live-studio   # beside the film
bun install --cwd ../live-studio
node ../live-studio/init.mjs .          # connect this project, --dry to only see what it would do
node src/live.mjs 4321
```

`init.mjs` adds a `file:` dependency, so `node_modules/live-studio` is a link to this repo, and writes three small files into the film: `src/live.mjs` and `notes_report.py` open the studio on this film, and `src/edit.ts` hands `edit.json` to it. It refuses if a file about to be removed holds changes this repo never had, so they can be moved here first. Any part a project doesn't have yet is copied from the demo, to replace.

The film owns everything else: `src/scene.ts`, `src/edit.json`, `src/timing.ts`, `voice_map.py`, `voice_edit.py`, `sound.py`, `make_lite.py`, `assets/`. The `demo/` folder is the example of all of them. The studio's Vite build finds them through two names: `film/...` is the film's `src/`, `live-studio/edit` is `src/edit.ts` here.

Every film runs the same studio, so a change here affects them all. The page is a React app in `app/` (shadcn/ui on Base UI, Tailwind, Zustand) that Vite builds together with the film's code, and builds again on every save of either (src/page.mjs). An open page reloads at the same second once nobody is mid-note, and only when the build came out different: a saved comment reloads nothing. Live events reach the page over Server-Sent Events, which reconnect by themselves, so a phone whose screen locked picks up where it was. A change to the server, anything in `src/`, needs each studio restarted.

Replace `src/scene.ts`. It exports `SHOTS`, `SHOTS_OUT`, `DURATION`, `applyEdit` and `buildScene(canvas, W, H, draft)`, which returns `draw(t)` with `draw.tools` attached. The demo scene shows the whole contract in about 80 lines, and `draw(t)` must be able to draw any moment straight away.

Everything the studio reads from a film, including the optional hooks (the list of what is going on at each frame, looks to switch between, sound options), is in [docs/film-contract.md](docs/film-contract.md). Point the film's `AGENTS.md` at it. The studio checks every film against it on start and on each change, and says what is wrong in its terminal and on the picture.

All timing lives in `src/edit.json`, in the voice's original seconds, so that actions follow the words when the voice is re-paced. Replace these with your own:

| File | Job |
| --- | --- |
| `assets/public/agent/full_voice.wav` | The voice |
| `voice_map.py` | Word times and waveform for the timeline |
| `sound.py` | The sound mix |
| `voice_edit.py` | Applying voice edits from `edit.json` (a stub here) |
| `make_lite.py` | Small asset copies for phones (empty here) |

## License

MIT. Built on [three.js](https://threejs.org), [Vite](https://vite.dev), [React](https://react.dev), [shadcn/ui](https://ui.shadcn.com), [Base UI](https://base-ui.com), [Tailwind CSS](https://tailwindcss.com), [Hono](https://hono.dev), [Zustand](https://zustand.docs.pmnd.rs), [TanStack Hotkeys](https://tanstack.com/hotkeys), [Zod](https://zod.dev), [vite-plugin-compression2](https://github.com/nonzzz/vite-plugin-compression) and [Lucide](https://lucide.dev), all MIT except Lucide (ISC).
