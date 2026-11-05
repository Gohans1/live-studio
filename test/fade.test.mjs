// A note's pin and words on the picture (app/engine/fade.ts): shown from its frame, then fading over 3 s of watching, so a
// note passed while playing can be read and is not one frame long
import assert from "node:assert/strict";
import { test } from "node:test";
import { NOTE_FADE, pinFade } from "../app/engine/fade.ts";

test("full on the note's frame, gone before it", () => {
  assert.equal(pinFade(10, 10), 1);
  assert.equal(pinFade(10, 9), 0);
});

test("fades out over 3 s after it", () => {
  assert.equal(NOTE_FADE, 3);
  assert.ok(Math.abs(pinFade(10, 11.5) - 0.5) < 1e-9);
  assert.equal(pinFade(10, 13.01), 0);
});

test("the fade is in the creator's seconds: at 2x it lasts 6 film seconds", () => {
  assert.ok(Math.abs(pinFade(10, 13, 2) - 0.5) < 1e-9);
  assert.equal(pinFade(10, 16.01, 2), 0);
});
