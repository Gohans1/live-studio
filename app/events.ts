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
// while the line was down, or the studio restarted on new code
const built = document.querySelector<HTMLMetaElement>('meta[name="live-build"]')?.content;
export const onHello = (run: (current: boolean) => void) => onEvent("hello", (build) => run(build === built));
