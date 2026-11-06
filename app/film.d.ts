// What the studio imports from a film (docs/film-contract.md). Vite resolves film/* to the film's src/ (src/vite_film.mjs);
// src/contract.mjs checks the same shapes at run time, since a film is plain code the studio did not write.
declare module "film/scene" {
  import type * as THREE from "three";

  export interface Shot { t: number; [key: string]: unknown }
  export interface FreeCam { on: boolean; p: THREE.Vector3; l: THREE.Vector3; fov: number }
  export interface Tools {
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    look: THREE.Vector3;
    free: FreeCam;
    objects?: [THREE.Object3D, string][];
    materials?: [THREE.Material, string][];
    rig?: THREE.Object3D;
    bones?: Record<string, THREE.Object3D>;
    zoomOf?: (shot: number) => number;
    smoother?: (u: number) => number;
    head?: THREE.Vector3;
    CELL?: number;
  }
  export interface ReviewSection { head: string; lines: { text: string; fresh?: boolean }[] }
  export interface Variant {
    id: string;
    title: string;
    options: { id: string; title: string }[];
    set(id: string): void;
    pick: { id: string; title: string };
    ranges: [number, number][];
  }
  export interface Draw {
    (t: number): void;
    tools: Tools;
    describe?: (t: number) => ReviewSection[];
    checks?: Record<string, (...args: number[]) => string | string[]>; // CHECK=name:args in a draft render (render.mjs)
    variants?: Variant[];
  }
  export const SHOTS: Shot[];
  export const SHOTS_OUT: Shot[];
  export let DURATION: number;
  export function applyEdit(): void;
  export function buildScene(canvas: HTMLCanvasElement, w: number, h: number, draft: boolean): Promise<Draw>;
}

declare module "film/edit" {
  export interface Beat { title: string; at: number; dur: number; kind: "motion" | "sound"; sounds: [number, string, number][]; curve?: string }
  export interface Edit {
    voice: { edits: Record<string, { speed?: number } | undefined>; warp: [number, number][] };
    beats: Record<string, Beat>;
    zoomRate?: number;
    [key: string]: unknown;
  }
  export const EDIT: Edit;
  export function setEdit(data: unknown): void;
  export function toSource(out: number): number;
  export function fromSource(src: number): number;
}

interface Window {
  __assets?: string;
  __live?: { t: number; shot: number; drawMs: number };
  __editor?: unknown;
  __hits?: { n: number; set: string; at: number; late: number };
  __stems?: Record<string, { set: string; offset: number }>;
  __sounds?: number;
  __readyAt?: number;
  __loopFrom?: number;
}
