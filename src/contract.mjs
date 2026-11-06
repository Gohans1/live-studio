// The film contract: everything the studio reads from a film, as zod schemas. The server checks the film's JSON files when the
// studio starts and whenever one changes; the page checks the film's module and its draw() once built. Problems are printed in
// the studio's terminal, where the AI working on the film reads them, and shown in the page. docs/film-contract.md explains
// each part. What a schema doesn't name is the film's own (its camera keys, audio, props): loose objects let it through.
import * as z from "zod";

export const DOC = "live-studio/docs/film-contract.md";

const fn = z.custom((v) => typeof v === "function", "expected a function");
const three = (flag, what) => z.custom((v) => !!v?.[flag], `expected ${what}`);
const time = z.number().refine(Number.isFinite, "expected a finite number of seconds");
const unique = (list) => new Set(list).size === list.length;

// ---------- src/scene.ts
const Shot = z.looseObject({ t: time });
export const SceneModule = z.looseObject({
  buildScene: fn,
  SHOTS: z.array(Shot).min(1),
  SHOTS_OUT: z.array(Shot).min(1),
  DURATION: z.number().positive(),
  applyEdit: fn,
})
  .refine((m) => m.SHOTS_OUT.length === m.SHOTS.length, { error: "SHOTS_OUT must hold one entry per shot in SHOTS", path: ["SHOTS_OUT"] })
  .refine((m) => m.SHOTS_OUT.every((s, i, a) => i === 0 || s.t >= a[i - 1].t), { error: "shots must start in order of time", path: ["SHOTS_OUT"] });

// ---------- What buildScene() resolves to: draw(t), with these attached
export const Tools = z.looseObject({
  scene: three("isObject3D", "the THREE.Scene drawn"),
  camera: three("isCamera", "the THREE camera the film draws with"),
  look: three("isVector3", "a THREE.Vector3: the point the camera looks at"),
  free: z.looseObject({ on: z.boolean(), p: three("isVector3", "a THREE.Vector3"), l: three("isVector3", "a THREE.Vector3"), fov: z.number() }),
  objects: z.array(z.tuple([three("isObject3D", "a THREE.Object3D"), z.string()])).optional(),
  materials: z.array(z.tuple([three("isMaterial", "a THREE.Material"), z.string()])).optional(),
});
export const Sections = z.array(z.object({ head: z.string(), lines: z.array(z.looseObject({ text: z.string(), fresh: z.boolean().optional() })) }));
const Look = z.looseObject({ id: z.string().min(1), title: z.string() });
export const Variant = z.looseObject({
  id: z.string().min(1),
  title: z.string(),
  options: z.array(Look).min(2).refine((o) => unique(o.map((x) => x.id)), "option ids must differ"),
  set: fn,
  pick: Look,
  ranges: z.array(z.tuple([time, time])),
});
export const Draw = z.looseObject({
  tools: Tools,
  describe: fn.optional(),
  checks: z.record(z.string(), fn).optional(),
  variants: z.array(Variant).refine((v) => unique(v.map((x) => x.id)), "variant ids must differ").optional(),
});

// ---------- src/edit.json: the studio reads the voice, the beats and their sounds. Everything else in it is the film's
const Beat = z.looseObject({ title: z.string(), at: time, dur: z.number().nonnegative(), kind: z.enum(["motion", "sound"]), sounds: z.array(z.tuple([time, z.string(), z.number()])) });
export const Edit = z.looseObject({
  voice: z.looseObject({ edits: z.record(z.string(), z.unknown()), warp: z.array(z.tuple([time, time])) }),
  beats: z.record(z.string(), Beat),
});

// ---------- renders/live/trials.json (written by the film's sound.py) and choices.json (written by the studio)
const Option = z.looseObject({ id: z.string().min(1), title: z.string(), files: z.array(z.string()).min(1) });
const options = z.array(Option).min(2).refine((o) => unique(o.map((x) => x.id)), "option ids must differ");
const StemGroup = z.looseObject({ title: z.string(), kind: z.literal("stem"), from: time, to: time, options }).refine((g) => g.to > g.from, "to must come after from");
const CueGroup = z.looseObject({ title: z.string(), options, cues: z.array(z.looseObject({ at: time, pick: z.int().nonnegative(), rate: z.number(), gain: z.number() })) });
export const Trials = z.record(z.string(), z.union([StemGroup, CueGroup]));
export const Choices = z.record(z.string(), z.looseObject({ set: z.string(), gain: z.number().positive().optional() }));

// One block of text per part that's wrong, naming the file to fix
export const problems = (schema, value, where) => {
  const r = schema.safeParse(value);
  return r.success ? [] : [`${where}\n${z.prettifyError(r.error)}`];
};

// files: { name: [schema, text or undefined] }, a missing file is no problem
export const checkFiles = (files) => Object.entries(files).flatMap(([name, [schema, text]]) => {
  if (text === undefined) return [];
  let value;
  try { value = JSON.parse(text); } catch (e) { return [`${name}\n✖ not valid JSON: ${e.message}`]; }
  return problems(schema, value, name);
});

export const checkFilm = (scene, draw) => [
  ...problems(SceneModule, scene, "src/scene.ts exports"),
  ...(typeof draw === "function" ? problems(Draw, { tools: draw.tools, describe: draw.describe, checks: draw.checks, variants: draw.variants }, "what buildScene() resolves to (draw)") : ["buildScene()\n✖ must resolve to draw(t), a function"]),
];
