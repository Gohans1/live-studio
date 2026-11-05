// The free camera's walking keys (app/engine/flight.ts): held keys move it every frame by time, not by the keyboard's repeat
import assert from "node:assert/strict";
import { test } from "node:test";
import { createFlight, FAST, SPEED } from "../app/engine/flight.ts";

const hold = (flight, seconds, fps) => {
  let forward = 0, right = 0, up = 0;
  for (let i = 0; i < Math.round(seconds * fps); i++) {
    const d = flight.step(1 / fps);
    if (d) { forward += d[0]; right += d[1]; up += d[2]; }
  }
  return [forward, right, up];
};

test("holding W walks forward at SPEED per second, from the first frame", () => {
  const f = createFlight();
  f.press("KeyW");
  const [forward, right, up] = hold(f, 1, 60);
  assert.ok(forward > SPEED * 0.85 && forward < SPEED, `${forward}`);
  assert.equal(right, 0);
  assert.equal(up, 0);
});

test("Shift walks FAST times faster", () => {
  const slow = createFlight(), fast = createFlight();
  slow.press("KeyD");
  fast.press("KeyD"); fast.press("ShiftLeft");
  const ratio = hold(fast, 2, 60)[1] / hold(slow, 2, 60)[1];
  assert.ok(Math.abs(ratio - FAST) < 0.05, `${ratio}`);
});

test("the same distance at any frame rate", () => {
  const a = createFlight(), b = createFlight();
  a.press("KeyE"); b.press("KeyE");
  const at30 = hold(a, 1, 30)[2], at144 = hold(b, 1, 144)[2];
  assert.ok(Math.abs(at30 - at144) / at144 < 0.03, `${at30} vs ${at144}`);
});

test("letting go glides a little, then stops asking for frames", () => {
  const f = createFlight();
  f.press("KeyS");
  hold(f, 1, 60);
  f.release("KeyS");
  const glide = hold(f, 0.5, 60)[0];
  assert.ok(glide < 0 && glide > -0.5, `${glide}`);
  assert.equal(f.step(1 / 60), null);
});

test("opposite keys cancel, and losing focus lets go of everything", () => {
  const f = createFlight();
  f.press("KeyA"); f.press("KeyD");
  assert.equal(hold(f, 0.5, 60)[1], 0);
  f.release("KeyD");
  hold(f, 0.5, 60);
  f.clear();
  hold(f, 1, 60);
  assert.equal(f.step(1 / 60), null);
});

test("only the walking keys are taken", () => {
  const f = createFlight();
  assert.equal(f.press("KeyW"), true);
  assert.equal(f.press("ShiftRight"), false);
  assert.equal(f.press("KeyF"), false);
});
