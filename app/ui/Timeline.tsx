// The two timeline canvases: the whole film, then the stretch around the playhead. engine/timeline.ts draws both and handles
// scrubbing, picking and zoom
import type { Bind } from "../App";

export function Timeline({ bind }: { bind: Bind }) {
  return (
    <div ref={bind("timeline")} className="col-start-1 row-start-3 min-w-0 px-3 pb-3 upright:flex-none sideways:pb-1.5">
      <canvas ref={bind("over")} title="Cả phim: bấm hoặc kéo để tua" aria-label="Cả phim: bấm hoặc kéo để tua" className="mb-1.5 block h-6 w-full cursor-ew-resize touch-none rounded-md pointer-coarse:h-7 sideways:mb-0" />
      <canvas ref={bind("detail")} title="Đoạn quanh chỗ đang xem: bấm để tua và xem khối đó, lăn chuột để phóng to" aria-label="Đoạn quanh chỗ đang xem: bấm để tua và xem khối đó, lăn chuột để phóng to" className="block h-44 w-full cursor-ew-resize touch-none rounded-md upright:h-37 sideways:hidden" />
    </div>
  );
}
