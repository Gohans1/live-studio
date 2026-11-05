// What the studio's server says as it happens (GET /api/events, see send in src/live.mjs). The browser reconnects by itself
// when the line drops, and the page stays as it is
const source = new EventSource("/api/events");
export const onEvent = (event: string, run: (data: string) => void) => source.addEventListener(event, (e) => run((e as MessageEvent<string>).data));

// The build this page came from (src/api.mjs writes it into the page): a "hello" naming another one means the code changed
// while the line was down, or the studio restarted on new code
const built = document.querySelector<HTMLMetaElement>('meta[name="live-build"]')?.content;
export const onHello = (run: (current: boolean) => void) => onEvent("hello", (build) => run(build === built));
