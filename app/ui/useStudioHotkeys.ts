// The studio's keys (listed in Settings, "Phím tắt"). Letters match the key's place, not its letter, so they work on any
// keyboard layout; typing in the note box never reaches them
import { useHotkeys, type UseHotkeyDefinition } from "@tanstack/react-hotkeys";
import { AWAY, FPS } from "../engine/env";
import { nextChange } from "../engine/changes";
import { openNote } from "../engine/notes";
import { chooseInGroup } from "../engine/options";
import { copyCam, jumpShot, moveCam, nudgeVolume, seek, setFinal, setFov, setFree, setLoop, setReview, togglePlay, toggleMute } from "../engine/player";
import { S } from "../engine/state";
import { get, set, useStudio } from "../engine/store";

const walk = (key: string, fast: boolean) => {
  const s = fast ? 0.15 : 0.04;
  moveCam(key === "W" ? s : key === "S" ? -s : 0, key === "D" ? s : key === "A" ? -s : 0, key === "E" ? s : key === "Q" ? -s : 0);
};

export function useStudioHotkeys() {
  const free = useStudio((s) => s.free), settingsOpen = useStudio((s) => s.settingsOpen);
  const hasDiff = useStudio((s) => !!s.before || s.changes.length > 0), hasChanges = useStudio((s) => s.changes.length > 0);
  const reviewAvailable = useStudio((s) => s.reviewAvailable);
  const keys: UseHotkeyDefinition[] = [
    { hotkey: "Space", callback: togglePlay },
    { hotkey: "ArrowLeft", callback: () => seek(S.t - 1 / FPS) },
    { hotkey: "ArrowRight", callback: () => seek(S.t + 1 / FPS) },
    { hotkey: "Shift+ArrowLeft", callback: () => seek(S.t - 5) },
    { hotkey: "Shift+ArrowRight", callback: () => seek(S.t + 5) },
    { hotkey: "ArrowUp", callback: () => nudgeVolume(true) },
    { hotkey: "ArrowDown", callback: () => nudgeVolume(false) },
    { hotkey: "[", callback: () => jumpShot(-1) },
    { hotkey: "]", callback: () => jumpShot(1) },
    { hotkey: "N", callback: () => openNote(null) },
    { hotkey: "C", callback: () => openNote(null) },
    { hotkey: "F", callback: () => setFree(!get().free) },
    { hotkey: "K", callback: copyCam },
    { hotkey: "G", callback: () => setFinal(!get().final), options: { enabled: !AWAY } },
    { hotkey: "L", callback: () => setLoop(!get().loop) },
    { hotkey: "I", callback: () => setReview(!get().review), options: { enabled: reviewAvailable } },
    { hotkey: "M", callback: toggleMute },
    { hotkey: "B", callback: () => set({ tab: get().tab === "diff" ? "open" : "diff", settingsOpen: false }), options: { enabled: hasDiff } },
    { hotkey: "Z", callback: () => nextChange(-1), options: { enabled: hasChanges } },
    { hotkey: "X", callback: () => nextChange(1), options: { enabled: hasChanges } },
    { hotkey: "-", callback: () => setFov(2) },
    { hotkey: "=", callback: () => setFov(-2) },
    // A popup open on top (a "?" or a menu) takes Esc for itself first
    { hotkey: "Escape", callback: () => set({ settingsOpen: false }), options: { enabled: settingsOpen } },
    ...Array.from({ length: 10 }, (_, i) => ({ hotkey: String(i), callback: () => chooseInGroup(i) }) as UseHotkeyDefinition),
    ...["W", "A", "S", "D", "Q", "E"].flatMap((k) => [
      { hotkey: k, callback: () => walk(k, false), options: { enabled: free } },
      { hotkey: `Shift+${k}`, callback: () => walk(k, true), options: { enabled: free } },
    ] as UseHotkeyDefinition[]),
  ];
  useHotkeys(keys, { preventDefault: true });
}
