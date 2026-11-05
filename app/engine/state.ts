// The engine's own state, read and written every frame by its parts. Not React state: nothing here re-renders anything.
import type { Draw, Tools } from "film/scene";
import { DURATION } from "film/scene";
import { stored } from "./env";

export interface Word { w: string; s: number; e: number }
export interface Line { text: string; s: number; e: number; words: Word[]; pieces?: Word[][] }
export interface VoiceMap { step: number; peaks: number[]; lines: Line[] }

// The page's elements the engine draws into, handed over by the React components that own them
export interface Elements {
  view: HTMLElement; stage: HTMLElement; canvas: HTMLCanvasElement; final: HTMLCanvasElement; audio: HTMLAudioElement;
  clock: HTMLElement; caption: HTMLElement; review: HTMLElement; pins: HTMLElement; chips: HTMLElement;
  over: HTMLCanvasElement; detail: HTMLCanvasElement; timeline: HTMLElement;
}

export const S = {
  el: null as unknown as Elements,
  t: Math.min(Number(stored.get("t", sessionStorage)) || 0, DURATION - 0.01),
  playing: false,
  dirty: true,
  render: null as Draw | null,
  tools: null as Tools | null,
  finalRender: null as Draw | null,
  finalAt: -1,
  comments: [] as string[],
  voice: { step: 0.04, peaks: [], lines: [] } as VoiceMap,
  voiceOut: [] as Line[],
  clockStart: 0,
  dragging: null as { resume: boolean } | null,
  failedFile: "",
};

export const markDirty = () => { S.dirty = true; };
