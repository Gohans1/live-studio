// The note being written. Every keystroke is kept on the device (engine/notes.ts setDraft), so a reload never loses it.
// On an upright phone it sits right under the picture, so the keyboard can't cover it and a tap still lands on the picture
import { TriangleAlert } from "lucide-react";
import { useEffect, useLayoutEffect, useRef } from "react";
import { flushSync } from "react-dom";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { PHONE, stamp } from "../engine/env";
import { cancelNote, saveNote, setDraft } from "../engine/notes";
import { ui, useStudio } from "../engine/store";

export function Compose() {
  const compose = useStudio((s) => s.compose), draft = useStudio((s) => s.draft);
  const text = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    ui.focusNote = () => { flushSync(() => {}); text.current?.focus({ preventScroll: true }); };
    ui.blurNote = () => text.current?.blur();
  }, []);
  const open = !!compose;
  // A phone keyboard doesn't report which key it pressed: its Enter only shows up as a line break arriving. Listened to on the
  // element itself: React's onBeforeInput is its own event, built from keypress and textInput, and never says insertLineBreak
  useEffect(() => {
    const box = text.current;
    if (!open || !box || !PHONE) return;
    const enter = (e: InputEvent) => { if (e.inputType === "insertLineBreak") { e.preventDefault(); saveNote(); } };
    box.addEventListener("beforeinput", enter);
    return () => box.removeEventListener("beforeinput", enter);
  }, [open]);
  if (!compose) return null;
  const where = compose.editing
    ? `Sửa ghi chú ${compose.time} | shot ${compose.shot}`
    : `${stamp(compose.t)} | shot ${compose.shot} (${compose.shotName})${compose.pin ? ` | ${compose.pin.what}` : ""}`;
  return (
    <div className="flex-none bg-card p-3 upright:fixed upright:inset-x-0 upright:top-[min(56.25vw,62vh)] upright:z-5 upright:shadow-[0_8px_20px_rgb(0_0_0/0.6)] sideways:px-3 sideways:py-2">
      <div className="mb-2 text-[13px] wrap-anywhere text-primary sideways:mb-1">{where}</div>
      {compose.editing && (
        <div className="mb-2 flex items-center gap-2 rounded-lg bg-warn-bg px-2.5 py-1.5 text-[13px] text-warn">
          <TriangleAlert className="size-4 flex-none" aria-hidden />
          <span>Đang sửa ghi chú cũ: bấm Xong là chữ mới ghi đè chữ cũ</span>
        </div>
      )}
      <Textarea
        ref={text}
        name="note"
        aria-label="Nội dung ghi chú"
        placeholder="Gõ hoặc nói…"
        enterKeyHint="done"
        autoComplete="off"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); saveNote(); }
          else if (e.key === "Escape") { e.preventDefault(); cancelNote(); }
        }}
        className="h-28 resize-y border-primary bg-background px-2.5 py-2 text-[15px] leading-normal focus-visible:ring-1 focus-visible:ring-primary pointer-coarse:text-base upright:h-19 sideways:h-16 sideways:px-2 sideways:py-1.5"
      />
      <div className="mt-2 flex gap-2 sideways:mt-1.5">
        <Button className="h-11 flex-1 text-sm font-semibold" onClick={saveNote}>Xong</Button>
        <Button variant="secondary" className="h-11 px-5 text-sm font-semibold" onClick={cancelNote}>Hủy</Button>
      </div>
      <small className="mt-2 block text-xs text-muted-foreground pointer-coarse:hidden">
        Tự giữ từng chữ, tải lại trang không mất | Enter xong rồi xem tiếp | Shift+Enter xuống dòng | Esc hủy
      </small>
    </div>
  );
}
