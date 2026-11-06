export const FPS = 30;
export const PHONE = matchMedia("(pointer: coarse)").matches && Math.min(innerWidth, innerHeight) < 600;
// Anything but this machine itself is on a line that costs: small copies of everything, whatever the screen
export const AWAY = PHONE || !["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
if (AWAY) window.__assets = "/lite/";
export const MIX_URL = AWAY ? "/api/mix_small.webm" : "/api/mix.wav";

export const pad = (n: number, w = 2) => String(n).padStart(w, "0");
export const stamp = (x: number) => { const ms = Math.round(x * 1000); return `${pad(Math.floor(ms / 60000))}:${pad(Math.floor(ms / 1000) % 60)}.${pad(ms % 1000, 3)}`; };
export const clockText = (x: number) => `${Math.floor(x / 60)}:${(x % 60).toFixed(1).padStart(4, "0")}`;
export const rangeText = ([a, b]: [number, number]) => (b - a < 0.05 ? clockText(a) : `${clockText(a)}–${clockText(b)}`);
export const letter = (i: number) => String.fromCharCode(65 + i);
export const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

// A phone line drops for seconds at a time: a file the page can't do without is asked for again until it comes
export const getFile = async (url: string) => {
  for (;;) {
    try { const r = await fetch(url); if (r.ok || r.status === 404) return r; } catch {}
    await wait(2000);
  }
};
export const postJson = (url: string, body: unknown) => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

// Storage can be missing (a private window) or full: a setting then just lasts for this page
export const stored = {
  get: (key: string, area: Storage = localStorage) => { try { return area.getItem(key); } catch { return null; } },
  set: (key: string, value: string, area: Storage = localStorage) => { try { area.setItem(key, value); return true; } catch { return false; } },
  remove: (key: string, area: Storage = localStorage) => { try { area.removeItem(key); } catch {} },
};
export const storedFlag = (key: string, fallback = true) => { const v = stored.get(key); return v === null ? fallback : v !== "off"; };
