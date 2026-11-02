// @ts-nocheck
// Demo scene. This file is the one to replace with your film: the studio needs these exports, and draw.tools at the end.
// Everything is a function of t, so any moment can be drawn straight away. All times come from edit.json.
import * as THREE from "three";
import { EDIT, fromSource } from "./edit";

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const END = 16;
export const SHOTS = [
  { t: 0.0, zoom: 0.1, p: [V(0, 1.5, 5), V(0, 1.5, 5)], l: [V(0, 0.8, 0), V(0, 0.8, 0)], fov: 45 }, // the whole room
  { t: 4.0, zoom: 0.12, p: [V(2.2, 1.2, 2.2), V(2.2, 1.2, 2.2)], l: [V(-0.8, 0.6, 0), V(-0.8, 0.6, 0)], fov: 35 }, // close on the cube
  { t: 8.0, zoom: 0.1, p: [V(-2.4, 1.0, 2.4), V(-2.4, 1.0, 2.4)], l: [V(1, 1, 0), V(1, 1, 0)], fov: 35 }, // close on the ball
  { t: 12.0, zoom: -0.1, p: [V(0, 3.2, 4.2), V(0, 3.2, 4.2)], l: [V(0, 0.5, 0), V(0, 0.5, 0)], fov: 50 }, // from above
];
export let DURATION = 0;
// The same shots in the seconds you hear, after any voice edit and moved cuts
export const SHOTS_OUT = [];
export const applyEdit = () => {
  SHOTS.forEach((s, i) => {
    s.t0 ??= s.t;
    s.t = EDIT.cuts?.[s.t0] ?? s.t0;
    SHOTS_OUT[i] = { ...s, t: fromSource(s.t) };
  });
  DURATION = fromSource(END);
};
applyEdit();
const smoother = (x) => { const u = Math.min(1, Math.max(0, x)); return u * u * u * (u * (u * 6 - 15) + 10); };
export const zoomOf = (i) => SHOTS[i].zoom ?? 0;

export async function buildScene(canvas, W, H, draft = false) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(W, H, false);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0c0f10);
  const camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 100);
  scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x202020, 1.2));
  const key = new THREE.DirectionalLight(0xfff0d8, 2.5);
  key.position.set(3, 5, 2);
  scene.add(key);
  const mesh = (geo, color) => { const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color })); scene.add(m); return m; };
  const floor = mesh(new THREE.BoxGeometry(8, 0.1, 8), 0x3a4144);
  floor.position.y = -0.05;
  const wall = mesh(new THREE.BoxGeometry(8, 4, 0.1), 0x2c3336);
  wall.position.set(0, 2, -3);
  const cube = mesh(new THREE.BoxGeometry(1, 1, 1), 0xd8703a);
  cube.position.set(-1, 0.5, 0);
  const ball = mesh(new THREE.SphereGeometry(0.55, 32, 24), 0x4aa3c8);
  ball.position.set(1.1, 0.55, 0);
  const free = { on: false, p: V(0, 0, 0), l: V(0, 0, 0), fov: 40 }; // the studio's free camera
  const look = V(0, 0, 0), head = V(0, 0, 0);

  const draw = (t) => {
    const at = (id) => (t - fromSource(EDIT.beats[id].at)) / EDIT.beats[id].dur;
    cube.rotation.y = smoother(at("spin")) * Math.PI;
    ball.position.y = 0.55 + smoother(at("lift")) * 1.1;
    let i = 0;
    SHOTS_OUT.forEach((s, n) => { if (t >= s.t) i = n; });
    const shot = SHOTS_OUT[i], next = SHOTS_OUT[i + 1]?.t ?? DURATION;
    const k = zoomOf(i) * (smoother((t - shot.t) / (next - shot.t)) - 0.5);
    look.copy(shot.l[0]);
    camera.position.copy(shot.p[0]).lerp(shot.l[0], k);
    camera.fov = shot.fov;
    if (free.on) { camera.fov = free.fov; camera.position.copy(free.p); look.copy(free.l); }
    camera.updateProjectionMatrix();
    camera.lookAt(look);
    renderer.render(scene, camera);
  };
  // What the studio needs to say where a click landed and to give a free camera back in a shot's own terms
  draw.tools = {
    scene, camera, free, head, look, rig: null, bones: {}, CELL: 0, smoother, zoomOf,
    objects: [[cube, "cube"], [ball, "ball"]],
    materials: [[floor.material, "floor"], [wall.material, "wall"]],
  };
  return draw;
}
