// What the page's controls show. The engine (player.ts and its parts) writes it; React reads it. Anything that changes every
// frame (the clock, captions, the timelines, the review list) is drawn by the engine straight into its element instead.
import { createStore, useStore } from "zustand";
import { storedFlag } from "./env";

export interface Pin { x: number; y: number; what: string; world?: number[] }
export interface Fix { what: string; checkpoint?: string; at: string }
export interface Note {
  id: string; at: string; t: number; time: string; frame: number; shot: number; shotName?: string; srcT?: number;
  text: string; done: boolean; pin?: Pin | null; freeCam?: boolean; img?: string; fixes?: Fix[]; [key: string]: unknown;
}
// The note being written: where it is about, and whether the film plays on once it's sent
export interface Compose {
  t: number; shot: number; shotName: string; pin: Pin | null; resume: boolean; wasPlaying?: boolean; spoken?: string;
  editing?: string; time?: string; original?: string;
}
export interface OptionView { id: string; title: string; source?: string }
export interface GroupView { name: string; title: string; picture: boolean; options: OptionView[]; chosen: string; pick: string; gain: number; ranges: [number, number][] }
export interface ChipView { name: string; range: [number, number] }

export interface StudioState {
  ready: boolean;
  newBuild: boolean; // the film's code changed since this page loaded
  loading: string;
  error: string | null;
  status: string;
  playing: boolean;
  rate: number;
  volume: number;
  muted: boolean;
  captions: boolean;
  review: boolean;
  reviewAvailable: boolean;
  tryOn: boolean;
  loop: boolean;
  free: boolean;
  final: boolean;
  settingsOpen: boolean;
  notes: Note[];
  saved: "busy" | "fail" | null;
  compose: Compose | null;
  draft: string;
  nearNote: string | null;
  groups: GroupView[];
  groupName: string | null;
  chips: ChipView[];
  contract: string[];
  shot: string;
  perf: string;
  selection: string[];
}

export const studio = createStore<StudioState>(() => ({
  ready: false,
  newBuild: false,
  loading: "đang dựng căn phòng…",
  error: null,
  status: "",
  playing: false,
  rate: 1,
  volume: 1,
  muted: false,
  captions: storedFlag("captions"),
  review: storedFlag("reviewList", false), // off until switched on (I): the dev watches the picture first
  reviewAvailable: false,
  tryOn: storedFlag("tryNow"),
  loop: false,
  free: false,
  final: false,
  settingsOpen: false,
  notes: [],
  saved: null,
  compose: null,
  draft: "",
  nearNote: null,
  groups: [],
  groupName: null,
  chips: [],
  contract: [],
  shot: "",
  perf: "",
  selection: [],
}));

export const useStudio = <T,>(pick: (s: StudioState) => T) => useStore(studio, pick);
export const set = studio.setState;
export const get = studio.getState;

// The box over the picture, kept until closed: what broke and where, as the old page showed it
export const showError = (e: unknown) => set({ error: e instanceof Error ? (e.stack ?? e.message) : String(e) });

let statusTimer = 0;
// A line over the picture that says what just happened, gone after a few seconds
export const say = (words: string, hold = 3000) => {
  set({ status: words });
  clearTimeout(statusTimer);
  if (hold) statusTimer = window.setTimeout(() => set({ status: "" }), hold);
};

// What the engine asks of the page's own elements. A phone only raises its keyboard for a focus made inside the tap itself,
// so the note box is focused synchronously from the engine, not from a React effect after the next render
export const ui = { focusNote: () => {}, blurNote: () => {} };
