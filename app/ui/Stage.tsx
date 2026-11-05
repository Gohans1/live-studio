// The picture and what sits on it. The engine draws the frame, the clock, the caption, the pins and the review list straight
// into these elements every frame; React only draws what changes rarely (badges, option chips, loading, errors)
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import type { Bind } from "../App";
import { reloadNow } from "../engine/player";
import { set, useStudio } from "../engine/store";
import { OptionChips } from "./OptionChips";

function Badges() {
  const free = useStudio((s) => s.free), final = useStudio((s) => s.final), loop = useStudio((s) => s.loop);
  const contract = useStudio((s) => s.contract.length), status = useStudio((s) => s.status), newBuild = useStudio((s) => s.newBuild);
  const badge = "rounded-md bg-alarm px-2 py-0.5 text-xs font-semibold text-picture";
  return (
    <div className="mr-45 flex min-h-8.5 flex-wrap items-start gap-1.5 self-stretch upright:mr-25 upright:min-h-5.5 sideways:mr-25 sideways:min-h-5.5">
      {free && <b className={badge}>CAMERA TỰ DO</b>}
      {final && <b className={badge}>CHẤT LƯỢNG FINAL</b>}
      {loop && <b className={badge}>LẶP SHOT</b>}
      {contract > 0 && <b className={badge}>PHIM SAI QUY ƯỚC ({contract})</b>}
      {newBuild && <Button size="sm" className="pointer-events-auto h-7 rounded-md px-2.5 text-xs font-semibold" title="Code phim vừa đổi. Tải lại ở đúng giây này; chữ đang gõ dở vẫn còn" onClick={reloadNow}>Có bản mới · Tải lại</Button>}
      <span role="status" className="max-w-full truncate rounded-md bg-black/72 px-2 py-px text-xs empty:hidden">{status}</span>
    </div>
  );
}

export function Stage({ bind }: { bind: Bind }) {
  const free = useStudio((s) => s.free), loading = useStudio((s) => s.loading), error = useStudio((s) => s.error);
  return (
    <div ref={bind("view")} className="relative col-start-1 row-start-1 flex min-h-0 min-w-0 items-center justify-center bg-black upright:aspect-video upright:max-h-[62vh] upright:w-full upright:flex-none">
      <div ref={bind("stage")} className="relative overflow-hidden bg-black [container-type:size]">
        <canvas ref={bind("canvas")} width={960} height={540} className={cn("absolute inset-0 block size-full touch-none", free ? "cursor-grab" : "cursor-crosshair")} />
        <canvas ref={bind("final")} width={1920} height={1080} hidden className="pointer-events-none absolute inset-0 block size-full" />
        {/* Above the review list and chips: a passed note shows for 3 s only, and it lets taps through to them */}
        <div ref={bind("pins")} className="pointer-events-none absolute inset-0 z-4 overflow-hidden" />
        <div ref={bind("clock")} className="stage-clock">00:00.000</div>
        {/* Top left: the badges, then the film's own list of what is going on at this frame. The badge row is as tall as the
            clock, so the list starts below it and can't run under the clock */}
        <div className="pointer-events-none absolute inset-x-2.5 top-2.5 bottom-11 z-2 flex flex-col items-start gap-1.5 upright:inset-x-1.5 upright:top-1.5 upright:bottom-7.5 upright:gap-1 sideways:inset-x-1.5 sideways:top-1.5 sideways:bottom-7.5 sideways:gap-1">
          <Badges />
          <div ref={bind("review")} className="stage-review" />
        </div>
        <OptionChips ref={bind("chips")} />
        <div className="stage-caption"><span ref={bind("caption")} className="stage-caption-text" /></div>
        {loading && <div role="status" className="absolute top-12.5 left-3 z-2 rounded-md bg-black/60 px-2 py-0.5">{loading}</div>}
      </div>
      {error && (
        <div role="alert" className="absolute inset-3 z-5 flex flex-col gap-2 rounded-lg bg-alarm-bg p-3">
          <pre className="min-h-0 flex-1 overflow-auto font-mono text-xs whitespace-pre-wrap">{error}</pre>
          <Button variant="outline" size="sm" className="self-end" onClick={() => set({ error: null })}>Đóng</Button>
        </div>
      )}
    </div>
  );
}
