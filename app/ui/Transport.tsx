// The two buttons that matter, the speed and the free camera, then the sound and the settings
import { Ellipsis, Move3d, Pause, Pencil, Play, Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { openNote } from "../engine/notes";
import { setFree, setVolume, togglePlay, toggleMute } from "../engine/player";
import { set, useStudio } from "../engine/store";
import { Speed } from "./Speed";

const big = "h-12 gap-2 rounded-[10px] text-base font-semibold [&_svg:not([class*='size-'])]:size-5 upright:h-11 sideways:h-11";
const square = `${big} w-12 px-0 text-muted-foreground hover:text-foreground upright:w-11 sideways:w-11`;

export function Transport() {
  const playing = useStudio((s) => s.playing), muted = useStudio((s) => s.muted), volume = useStudio((s) => s.volume);
  const settingsOpen = useStudio((s) => s.settingsOpen), free = useStudio((s) => s.free);
  return (
    // A container: what fits depends on the picture's column, which the notes beside it narrow, not on the window
    <div className="@container col-start-1 row-start-2 flex min-w-0 items-center gap-2 px-3 py-2.5 upright:flex-none upright:py-2 sideways:py-1.5">
      <Button variant="secondary" className={`${big} min-w-32 bg-raised-3 hover:bg-raised-4 max-[1100px]:min-w-0 max-[1100px]:px-3.5`} onClick={togglePlay}>
        {playing ? <Pause data-icon="inline-start" /> : <Play data-icon="inline-start" />}
        {playing ? "Dừng" : "Phát"}
      </Button>
      <Button className={`${big} min-w-0 flex-[0_1_220px] max-[1100px]:flex-auto upright:flex-1 sideways:flex-1`} onClick={() => openNote(null)}>
        <Pencil data-icon="inline-start" />
        Ghi chú
      </Button>
      <Speed className="bg-card upright:hidden @max-[640px]:hidden" item="h-11 sideways:h-10" />
      {/* Walking the camera needs a mouse and keys, as in Settings */}
      <Button
        variant="ghost"
        className={`${big} px-3 text-muted-foreground hover:text-foreground aria-pressed:bg-tint aria-pressed:text-primary pointer-coarse:hidden`}
        title="Camera tự do (F): kéo để nhìn, giữ W A S D Q E để đi, thêm Shift đi nhanh"
        aria-label="Camera tự do"
        aria-pressed={free}
        onClick={() => setFree(!free)}
      >
        <Move3d data-icon="inline-start" />
        <span className="@max-[860px]:hidden">Camera tự do</span>
      </Button>
      <div className="ml-auto flex items-center gap-1 upright:ml-0 sideways:ml-0">
        <Button variant="ghost" className={square} title="Tắt tiếng (M)" aria-label="Tắt tiếng" aria-pressed={muted} onClick={toggleMute}>
          {muted ? <VolumeX /> : <Volume2 />}
        </Button>
        {/* Phones leave the level to their own buttons (iOS ignores a page setting it), so there the speaker only mutes */}
        <div className="flex h-10 w-26 items-center max-[1100px]:w-20 max-[900px]:w-14 pointer-coarse:hidden upright:hidden sideways:hidden" title="Âm lượng (phím ↑ ↓)">
          <Slider
            min={0}
            max={1}
            step={0.05}
            value={muted ? 0 : volume}
            onValueChange={(v: number | readonly number[]) => setVolume(typeof v === "number" ? v : v[0])}
            aria-label="Âm lượng"
            format={{ style: "percent" }}
          />
        </div>
      </div>
      <Button
        variant="ghost"
        className={`${square} aria-expanded:bg-tint aria-expanded:text-primary`}
        title="Cài đặt"
        aria-label="Cài đặt"
        aria-expanded={settingsOpen}
        aria-controls="settings"
        onClick={() => set({ settingsOpen: !settingsOpen })}
      >
        <Ellipsis />
      </Button>
    </div>
  );
}
