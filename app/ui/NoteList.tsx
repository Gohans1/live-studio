// The side list: notes still to fix with the fixed ones folded away under them. The list
// keeps the item at the playhead in view, unless a finger or wheel moved it in the last few seconds or a note is being edited
import { cn } from "cn";
import { X } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { stamp } from "../engine/env";
import { editOldNote, goToNote, historyNotes, noteAt, openNotes, removeNote, reopenNote } from "../engine/notes";
import { type Fix, type Note, useStudio } from "../engine/store";

const HOLD_LIST = 4000;
const card = "flex-none rounded-[10px] border border-transparent bg-card px-2.5 pt-1.5 pb-2.5";
const timeButton = "min-h-7.5 bg-tint px-2 font-mono text-sm font-semibold text-primary tabular-nums hover:bg-tint-hover pointer-coarse:px-2.5";

const FixLine = ({ fix }: { fix: Fix }) => (
  <div className="mt-1.5 text-[13px] text-ok">Đã sửa: {fix.what} ({fix.checkpoint}, {new Date(fix.at).toLocaleDateString("vi-VN")})</div>
);
const Empty = ({ children }: { children: ReactNode }) => <div className="px-0.5 py-2 text-muted-foreground">{children}</div>;

function NoteCard({ note: n, near, editing }: { note: Note; near: boolean; editing: boolean }) {
  const where = `shot ${n.shot}${n.pin ? ` | ${n.pin.what}` : ""}`;
  return (
    <article
      data-note={n.id}
      className={cn(card, "cursor-pointer hover:bg-raised-2", near && "border-primary bg-tint", editing && "border-warn")}
      onClick={() => editOldNote(n)}
    >
      <div className="flex min-h-9 items-center gap-2 pointer-coarse:min-h-11">
        <Button className={timeButton} title="Nhảy tới đây" onClick={(e) => { e.stopPropagation(); goToNote(n); }}>{stamp(noteAt(n))}</Button>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={where}>{where}</span>
        <Button variant="ghost" size="icon" className="-me-1.5 size-8 text-muted-foreground pointer-coarse:size-11" title="Xóa" aria-label={`Xóa ghi chú ${stamp(noteAt(n))}`} onClick={(e) => { e.stopPropagation(); removeNote(n); }}>
          <X />
        </Button>
      </div>
      {/* The words are the way to edit from the keyboard; a click anywhere else on the card does the same */}
      <button type="button" className="mt-0.5 block w-full rounded-sm text-left whitespace-pre-wrap wrap-anywhere" aria-label={`Sửa ghi chú ${stamp(noteAt(n))}: ${n.text}`}>
        {n.text}
      </button>
      {n.fixes?.length ? <FixLine fix={n.fixes.at(-1)!} /> : null}
    </article>
  );
}

// A fixed note keeps what was asked, what the frame looked like and what was done. It's a record: the way back is "Chưa ưng"
function DoneCard({ note: n }: { note: Note }) {
  return (
    <article className={card}>
      <div className="flex min-h-9 items-center gap-2 pointer-coarse:min-h-11">
        <Button className={timeButton} title="Nhảy tới đây" onClick={() => goToNote(n)}>{stamp(noteAt(n))}</Button>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">shot {n.shot}</span>
        <Button variant="secondary" size="lg" className="text-[13px]" onClick={() => reopenNote(n)}>Chưa ưng</Button>
      </div>
      {/* Sized up front, or the list would jump as pictures arrive */}
      {n.img && <img src={`/api/note-img/${n.id}.jpg`} loading="lazy" width={960} height={540} alt="" className="mt-1.5 mb-1 block h-auto w-full rounded-md outline-1 -outline-offset-1 outline-white/10" />}
      <div className="mt-0.5 whitespace-pre-wrap wrap-anywhere">{n.text}</div>
      {n.fixes?.map((f) => <FixLine key={f.at} fix={f} />)}
    </article>
  );
}

export function NoteList() {
  const notes = useStudio((s) => s.notes), saved = useStudio((s) => s.saved), nearNote = useStudio((s) => s.nearNote);
  const editing = useStudio((s) => s.compose?.editing);
  const list = useRef<HTMLDivElement>(null), touched = useRef(-1e9);
  const open = openNotes(), old = historyNotes();

  useEffect(() => {
    const box = list.current;
    if (!box || editing || performance.now() - touched.current < HOLD_LIST) return;
    const near = box.querySelector<HTMLElement>(`[data-note="${nearNote}"]`);
    if (!near) return;
    const top = near.offsetTop - box.offsetTop - (box.clientHeight - near.offsetHeight) / 2;
    box.scrollTo({ top, behavior: Math.abs(top - box.scrollTop) > 500 ? "auto" : "smooth" }); // a long way is a jump, not a slide past everything
  }, [nearNote, editing]);

  const savedText = saved === "fail" ? "Chưa gửi được, vẫn giữ trên máy này, đang thử lại" : saved === "busy" ? "Đang lưu…" : notes.length ? "Đã lưu hết" : "";
  return (
    <section aria-label="Ghi chú" className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-none flex-wrap items-center gap-x-1 px-3 pt-2.5 pb-2 upright:py-1.5 sideways:py-1">
        <h2 className="flex h-8 items-center px-0.5 text-[13px] font-semibold pointer-coarse:h-10 sideways:h-9">Cần sửa ({open.length})</h2>
        <span role="status" className={cn("flex-1 text-end text-xs whitespace-nowrap text-ok", saved === "busy" && "text-muted-foreground", saved === "fail" && "font-semibold whitespace-normal text-warn")}>{savedText}</span>
      </div>
      <div
        ref={list}
        data-arrow-scroll
        className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-auto overscroll-contain px-3 pb-3"
        onPointerDown={() => { touched.current = performance.now(); }}
        onWheel={() => { touched.current = performance.now(); }}
        onTouchMove={() => { touched.current = performance.now(); }}
      >
        {open.length ? open.map((n) => <NoteCard key={n.id} note={n} near={n.id === nearNote} editing={n.id === editing} />) : <Empty>{old.length ? "Hết việc cần sửa" : "Chưa có ghi chú"}</Empty>}
        {/* Folded by default: they are answered, and the list is for what still needs doing. Shown at 0 too, so the creator knows where fixed notes will go */}
        {notes.length > 0 && (
          <details className="group mt-2 flex-none">
            <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 rounded-[10px] px-2.5 text-[13px] font-semibold text-muted-foreground hover:bg-card hover:text-foreground [&::-webkit-details-marker]:hidden">
              <span aria-hidden className="mx-0.5 size-1.5 -rotate-45 border-r-[1.5px] border-b-[1.5px] border-current group-open:rotate-45" />
              Đã xong ({old.length})
            </summary>
            <div className="mt-1.5 flex flex-col gap-1.5">{old.length ? old.map((n) => <DoneCard key={n.id} note={n} />) : <p className="px-2.5 text-[13px] text-muted-foreground">Chưa có ghi chú nào xong. AI sửa xong ghi chú nào thì ghi chú đó chuyển xuống đây.</p>}</div>
          </details>
        )}
      </div>
    </section>
  );
}
