// Playback speed: beside "Ghi chú" under the picture, and in Settings for a phone held upright, which has no room down there
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { setRate } from "../engine/player";
import { useStudio } from "../engine/store";

export function Speed({ className = "", item = "" }: { className?: string; item?: string }) {
  const rate = useStudio((s) => s.rate);
  return (
    <ToggleGroup value={[String(rate)]} onValueChange={(v: string[]) => { if (v[0]) setRate(Number(v[0])); }} aria-label="Tốc độ" spacing={0.5} className={`rounded-[10px] p-0.5 ${className}`}>
      {["0.5", "1", "1.5", "2"].map((v) => (
        <ToggleGroupItem key={v} value={v} className={`px-2.5 text-sm text-muted-foreground tabular-nums aria-pressed:bg-raised-3 aria-pressed:font-semibold aria-pressed:text-foreground ${item}`}>{v}×</ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
