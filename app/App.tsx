import { useEffect, useRef } from "react";
import { Toaster } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { start } from "./engine/player";
import type { Elements } from "./engine/state";
import { set, showError } from "./engine/store";
import { Side } from "./ui/Side";
import { Stage } from "./ui/Stage";
import { Timeline } from "./ui/Timeline";
import { Transport } from "./ui/Transport";
import { useStudioHotkeys } from "./ui/useStudioHotkeys";

export type Bind = <K extends keyof Elements>(key: K) => (node: Elements[K] | null) => void;

let started = false;

// A button keeps focus after a mouse click, and Space would then press it instead of playing. From the keyboard focus stays,
// so Space presses the control as usual. Popup triggers keep focus: their popup needs it to open and to return it
const dropClickFocus = (e: MouseEvent) => {
  if (!e.detail) return;
  const hit = (e.target as Element).closest?.("button:not([aria-haspopup]), summary, [role=tab]");
  if (hit instanceof HTMLElement) hit.blur();
};

export function App() {
  const el = useRef({} as Elements);
  const bind: Bind = (key) => (node) => { if (node) el.current[key] = node; };
  useStudioHotkeys();
  useEffect(() => {
    if (started) return;
    started = true;
    start(el.current).catch((e: Error) => { showError(e); set({ loading: "" }); });
    addEventListener("click", dropClickFocus);
    // A slider keeps focus after a drag too, and its arrows would then move it instead of stepping the film
    addEventListener("pointerup", () => { const at = document.activeElement; if (at instanceof HTMLInputElement && at.type === "range") at.blur(); });
    // Chrome reports a ResizeObserver that skipped a frame as an error; it isn't one
    addEventListener("error", (e) => { if (!e.message.startsWith("ResizeObserver loop")) showError(e.error ?? e.message); });
    addEventListener("unhandledrejection", (e) => showError(e.reason));
  }, []);
  return (
    <Toaster limit={3}>
      <TooltipProvider>
        <div className="grid h-dvh grid-cols-[minmax(0,1fr)_360px] grid-rows-[minmax(0,1fr)_auto_auto] text-sm upright:flex upright:flex-col sideways:grid-cols-[minmax(0,1fr)_min(36%,320px)]">
          <Stage bind={bind} />
          <Transport />
          <Timeline bind={bind} />
          <Side />
        </div>
        <audio ref={bind("audio")} preload="auto" />
      </TooltipProvider>
    </Toaster>
  );
}
