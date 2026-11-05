// The page's live events (app/events.ts) against a stand-in EventSource: Node runs the TypeScript as it is
import assert from "node:assert/strict";
import { test } from "node:test";

const streams = [];
globalThis.EventSource = class extends EventTarget {
  static CLOSED = 2;
  readyState = 1;
  constructor(url) { super(); this.url = url; streams.push(this); }
  say(event, data) { this.dispatchEvent(new MessageEvent(event, { data })); }
};
globalThis.document = { querySelector: () => ({ content: "build-1" }) };
const { onHello } = await import("../app/events.ts");
const stream = () => streams.at(-1);

test("a part of the page that listens late still tells the stream's first hello from a reconnect", () => {
  // The stream opens with the page; the player only listens once the app has downloaded, after the first hello came
  stream().say("hello", "build-1");
  const heard = [];
  onHello((current, reconnect) => heard.push({ current, reconnect }));
  assert.deepEqual(heard, [{ current: true, reconnect: false }]);
  stream().say("hello", "build-1"); // the line dropped and came back on the same code
  stream().say("hello", "build-2"); // ... or on new code
  assert.deepEqual(heard.slice(1), [{ current: true, reconnect: true }, { current: false, reconnect: true }]);
});

test("a stream the browser gave up on (a proxy's 502) is opened again, with its listeners", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const heard = [];
  onHello((current, reconnect) => heard.push(reconnect));
  heard.length = 0;
  const old = stream();
  old.readyState = EventSource.CLOSED;
  old.dispatchEvent(new Event("error"));
  t.mock.timers.tick(3000);
  assert.notEqual(stream(), old);
  stream().say("hello", "build-1");
  assert.deepEqual(heard, [true]);
});
