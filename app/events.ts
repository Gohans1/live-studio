// What the studio's server says as it happens (GET /api/events, see send in src/live.mjs). The browser reconnects by itself
// when the line drops, and the page stays as it is
const listeners: [string, (e: Event) => void][] = [];
let source: EventSource;
const open = () => {
  source = new EventSource("/api/events");
  for (const [event, listener] of listeners) source.addEventListener(event, listener);
  // An answer other than the stream (Tailscale's 502 while the studio restarts) ends it for good: the browser only retries a
  // stream that dropped. Ask again, as it would
  source.addEventListener("error", () => { if (source.readyState === EventSource.CLOSED) setTimeout(open, 3000); });
};
open();
export const onEvent = (event: string, run: (data: string) => void) => {
  const listener = (e: Event) => run((e as MessageEvent<string>).data);
  listeners.push([event, listener]);
  source.addEventListener(event, listener);
};

// The build this page came from (src/api.mjs writes it into the page): a "hello" naming another one means the code changed
// while the line was down, or the studio restarted on new code. Every connection starts with one; any after the first is a
// reconnect, and whatever was sent meanwhile is lost. The player listens only once the app has downloaded, usually after the
// first hello, so the one this page already got is passed to a late listener too
const built = document.querySelector<HTMLMetaElement>('meta[name="live-build"]')?.content;
let hellos = 0, lastBuild = "";
onEvent("hello", (build) => { hellos++; lastBuild = build; }); // first, so it has counted before any listener below runs
export const onHello = (run: (current: boolean, reconnect: boolean) => void) => {
  if (hellos) run(lastBuild === built, false);
  onEvent("hello", (build) => run(build === built, hellos > 1));
};
