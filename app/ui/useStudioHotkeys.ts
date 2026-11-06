// The studio's keys (listed in Settings, "Phím tắt"). Letters match the key's place, not its letter, so they work on any
// keyboard layout; typing in the note box never reaches them
import { useHotkeys, type UseHotkeyDefinition } from "@tanstack/react-hotkeys";
import { AWAY, FPS } from "../engine/env";
import { openNote } from "../engine/notes";
import { chooseInGroup } from "../engine/options";
import { copyCam, jumpShot, nudgeVolume, seek, setFinal, setFov, setFree, setLoop, setReview, togglePlay, toggleMute } from "../engine/player";
import { S } from "../engine/state";
import { get, set, useStudio } from "../engine/store";

// The keyboard walking a list (the ones marked data-arrow-scroll: notes, settings) scrolls it with Up and Down; everywhere else they set the volume
const walkingList = (e: KeyboardEvent) => e.target instanceof Element && e.target.matches(":focus-visible") && !!e.target.closest("[data-arrow-scroll]");
const volumeKey = (up: boolean): UseHotkeyDefinition => ({
  hotkey: up ? "ArrowUp" : "ArrowDown",
  callback: (e) => { if (walkingList(e)) return; e.preventDefault(); nudgeVolume(up); },
  options: { preventDefault: false },
});

export function useStudioHotkeys() {
  const settingsOpen = useStudio((s) => s.settingsOpen);
  const reviewAvailable = useStudio((s) => s.reviewAvailable);
  const keys: UseHotkeyDefinition[] = [
    { hotkey: "Space", callback: togglePlay },
    { hotkey: "ArrowLeft", callback: () => seek(S.t - 1 / FPS) },
    { hotkey: "ArrowRight", callback: () => seek(S.t + 1 / FPS) },
    { hotkey: "Shift+ArrowLeft", callback: () => seek(S.t - 5) },
    { hotkey: "Shift+ArrowRight", callback: () => seek(S.t + 5) },
    volumeKey(true),
    volumeKey(false),
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
    { hotkey: "-", callback: () => setFov(2) },
    { hotkey: "=", callback: () => setFov(-2) },
    // A popup open on top (a "?" or a menu) takes Esc for itself first
    { hotkey: "Escape", callback: () => set({ settingsOpen: false }), options: { enabled: settingsOpen } },
    ...Array.from({ length: 10 }, (_, i) => ({ hotkey: String(i), callback: () => chooseInGroup(i) }) as UseHotkeyDefinition),
    // W A S D Q E walk the free camera while held: app/engine/flight.ts, listened to in player.ts
  ];
  useHotkeys(keys, { preventDefault: true });
}
