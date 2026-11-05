// What changed since the version last watched, in words with times (src/versions.mjs keeps the versions). The tab "Thay đổi"
// lists it, the timeline marks it, Z and X jump between the changes.
import { postJson, stored } from "./env";
import { seek, setPlaying } from "./player";
import { S } from "./state";
import { type Change, get, say, set } from "./store";

interface Compared { edits: { at: number | null; text: string }[]; sound: { from: number; to: number }[]; code: boolean; assets: string[] }
let picked: string | null = (() => { try { return JSON.parse(stored.get("compare", sessionStorage) ?? "null")?.picked ?? null; } catch { return null; } })();
let result: Compared | null = null;

const buildChanges = (): Change[] => {
  if (!result) return [];
  const list: Change[] = result.edits.map((e) => ({ from: e.at, to: e.at, kind: "edit", title: "Sửa trong edit.json", lines: [e.text] }));
  for (const s of result.sound) list.push({ from: s.from, to: s.to, kind: "sound", title: "Tiếng đổi", lines: [] });
  if (result.code) list.push({ from: null, to: null, kind: "edit", title: "Code phim đổi", lines: ["Không nói được chỗ nào: hỏi AI vừa sửa, hoặc xem git log của phim"] });
  if (result.assets.length) list.push({ from: null, to: null, kind: "edit", title: "File đổi (ảnh, model)", lines: [`${result.assets.slice(0, 5).join(", ")}${result.assets.length > 5 ? ` và ${result.assets.length - 5} file nữa` : ""}`] });
  return list.sort((a, b) => (a.from ?? -1) - (b.from ?? -1));
};
const statusOf = (changes: Change[]) => {
  const { before } = get(), seekable = changes.filter((c) => c.from !== null).length;
  return !before ? "Chưa có bản cũ" : !result ? "đang so…" : seekable ? `${seekable} chỗ đổi` : changes.length ? "đổi code hoặc file, không có chỗ cụ thể" : "không thấy gì đổi";
};
export const emptyWords = () => { const { before, current } = get(); return !before ? "Chưa có bản cũ để so: phim đổi lần tới thì có" : before === current ? "Đây là cùng một bản" : !result ? "Đang so…" : "Không thấy gì đổi"; };
const publish = () => { const changes = buildChanges(); set({ changes, compareStatus: statusOf(changes), compareReady: !!result }); S.dirty = true; };

let asked = 0;
const loadCompare = async () => {
  const mine = ++asked, { before, current } = get();
  if (!before || !current || before === current) { result = null; publish(); return; }
  const r = await fetch(`/api/compare/${before}/${current}`).catch(() => null);
  if (mine !== asked) return;
  if (!r?.ok) { result = null; publish(); set({ compareStatus: "không so được hai bản này" }); return; }
  const fresh = await r.json();
  if (mine !== asked) return;
  result = fresh;
  publish();
};
export const loadVersions = async () => {
  const r = await fetch("/api/versions.json").catch(() => null);
  if (!r?.ok) return;
  const v = await r.json();
  if (picked && (picked === v.current || !v.versions.some((x: { id: string }) => x.id === picked))) picked = null;
  set({ current: v.current, seen: v.seen, versions: v.versions, autoBefore: v.before, before: picked ?? v.before });
  await loadCompare();
};
export const compareWith = (id: string) => {
  picked = id === get().autoBefore ? null : id;
  stored.set("compare", JSON.stringify({ picked }), sessionStorage);
  set({ before: id });
  loadCompare();
};
export const nextChange = (d: number) => {
  const stops = get().changes.filter((c) => c.from !== null).map((c) => c.from!);
  const to = d > 0 ? stops.find((s) => s > S.t + 0.05) : stops.findLast((s) => s < S.t - 0.05);
  if (to === undefined) { say(d > 0 ? "hết chỗ đổi" : "đây là chỗ đổi đầu tiên"); return; }
  if (S.playing) setPlaying(false);
  seek(to);
};
// The change the playhead is in, for the list to show
export const followChanges = () => {
  if (get().tab !== "diff") return;
  const i = get().changes.findIndex((c) => c.from !== null && c.to !== null && S.t >= c.from - 0.02 && S.t <= c.to + 0.2);
  const near = i < 0 ? null : i;
  if (near !== get().nearChange) set({ nearChange: near });
};
// Using the page is what makes this version one that was watched. Opening it isn't, or a page left open would swallow every change an AI makes
let seenSent: string | null = null;
const markSeen = () => {
  const { current } = get();
  if (!current || seenSent === current) return;
  seenSent = current;
  postJson("/api/seen", { id: current }).catch(() => { seenSent = null; });
};
for (const ev of ["pointerdown", "keydown"]) addEventListener(ev, markSeen, { passive: true });
