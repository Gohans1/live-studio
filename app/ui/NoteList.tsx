// The side list: notes still to fix, the history of fixed ones, and what changed since the last watched version. The list
// keeps the item at the playhead in view, unless a finger or wheel moved it in the last few seconds or a note is being edited
import { cn } from "cn";
import X from "lucide-react/icons/x";
import { type ReactNode, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { stamp, timeOfDay } from "../engine/env";
import { compareWith, emptyWords, loadVersions, nextChange } from "../engine/changes";
import { editOldNote, goToNote, historyNotes, noteAt, openNotes, removeNote, reopenNote } from "../engine/notes";
import { seek } from "../engine/player";
import { type Change, type Fix, type Note, set, type Tab, useStudio } from "../engine/store";
import { HelpTip } from "./HelpTip";

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

// History keeps what was asked, what the frame looked like and what was done. It's a record: the way back is "Chưa ưng"
function HistoryCard({ note: n }: { note: Note }) {
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

function ChangeCard({ change: c, near }: { change: Change; near: boolean }) {
  const seekable = c.from !== null;
  const body = (
    <>
      <div className="flex min-h-9 items-center gap-2">
        {seekable && <span className={cn(timeButton, "inline-flex items-center rounded-md")}>{stamp(c.from!)}</span>}
        <span className={cn("text-xs font-semibold", c.kind === "sound" ? "text-warn" : "text-primary")}>{c.title}</span>
      </div>
      {seekable && c.to! > c.from! + 0.01 && <small className="block text-xs text-muted-foreground">đến {stamp(c.to!)}</small>}
      {c.lines.map((l) => <small key={l} className="block text-xs wrap-anywhere text-muted-foreground">{l}</small>)}
    </>
  );
  return seekable
    ? <button type="button" data-change={near ? "near" : undefined} className={cn(card, "w-full text-left hover:bg-raised-2", near && "border-primary bg-tint")} onClick={() => seek(c.from!)}>{body}</button>
    : <div className={card}>{body}</div>;
}

function CompareBar() {
  const versions = useStudio((s) => s.versions), current = useStudio((s) => s.current), before = useStudio((s) => s.before);
  const autoBefore = useStudio((s) => s.autoBefore), seen = useStudio((s) => s.seen), status = useStudio((s) => s.compareStatus);
  const older = versions.filter((v) => v.id !== current).reverse();
  const items = older.map((v) => ({ value: v.id, label: `${timeOfDay(v.at)}${v.id === autoBefore && seen ? ", xem lần cuối" : ""}` }));
  return (
    <div className="flex flex-none flex-wrap items-center gap-1.5 px-3 pb-2">
      <Select items={items} value={before} onValueChange={(v) => { if (v) compareWith(v as string); }}>
        <SelectTrigger className="h-10 w-full" aria-label="So với bản nào" title="So với bản nào"><SelectValue placeholder="Chưa có bản cũ" /></SelectTrigger>
        <SelectContent>
          {items.map((i) => <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>)}
        </SelectContent>
      </Select>
      <Button variant="secondary" className="h-10" title="Z" onClick={() => nextChange(-1)}>‹ Chỗ đổi</Button>
      <Button variant="secondary" className="h-10" title="X" onClick={() => nextChange(1)}>Chỗ đổi ›</Button>
      <span className="text-xs whitespace-nowrap text-muted-foreground">
        <i className="mx-1 inline-block size-2.5 rounded-xs bg-chart-5 align-[-1px]" />sửa
        <i className="mr-1 ml-2 inline-block size-2.5 rounded-xs bg-warn align-[-1px]" />tiếng
      </span>
      <HelpTip label="Thay đổi">Những gì đã đổi so với bản bạn xem lần trước: thời gian, tiếng, ảnh, code. Chọn bản khác ở ô trên để so. Bấm một dòng, hoặc ‹ › (phím Z X), để nhảy tới chỗ đó.</HelpTip>
      <span role="status" className="basis-full text-xs text-muted-foreground tabular-nums">{status}</span>
    </div>
  );
}

export function NoteList() {
  const tab = useStudio((s) => s.tab), notes = useStudio((s) => s.notes), saved = useStudio((s) => s.saved);
  const nearNote = useStudio((s) => s.nearNote), nearChange = useStudio((s) => s.nearChange), changes = useStudio((s) => s.changes);
  const editing = useStudio((s) => s.compose?.editing), before = useStudio((s) => s.before);
  const list = useRef<HTMLDivElement>(null), touched = useRef(-1e9);
  const open = openNotes(), old = historyNotes();
  const showDiff = !!before || changes.length > 0;

  useEffect(() => {
    const box = list.current;
    if (!box || editing || performance.now() - touched.current < HOLD_LIST) return;
    const near = box.querySelector<HTMLElement>(tab === "open" ? `[data-note="${nearNote}"]` : `[data-change="near"]`);
    if (!near) return;
    if (tab !== "open") { near.scrollIntoView({ block: "nearest" }); return; }
    const top = near.offsetTop - box.offsetTop - (box.clientHeight - near.offsetHeight) / 2;
    box.scrollTo({ top, behavior: Math.abs(top - box.scrollTop) > 500 ? "auto" : "smooth" }); // a long way is a jump, not a slide past everything
  }, [tab, nearNote, nearChange, editing]);

  const savedText = saved === "fail" ? "Chưa gửi được, vẫn giữ trên máy này, đang thử lại" : saved === "busy" ? "Đang lưu…" : notes.length ? "Đã lưu hết" : "";
  const trigger = "h-full flex-none px-2.5 text-[13px] pointer-coarse:px-3 sideways:px-2";
  return (
    <Tabs value={tab} onValueChange={(v) => { set({ tab: v as Tab }); if (v === "diff") loadVersions(); }} className="min-h-0 flex-1 gap-0">
      <div className="flex flex-none flex-wrap items-center gap-x-1 px-3 pt-2.5 pb-2 upright:py-1.5 sideways:py-1">
        {/* A narrow column wraps the save status under the tabs, then lets the tabs scroll rather than push past the screen */}
        <TabsList variant="line" className="h-8 max-w-full min-w-0 overflow-x-auto overscroll-x-contain pointer-coarse:h-10 sideways:h-9">
          <TabsTrigger value="open" className={trigger}>Cần sửa ({open.length})</TabsTrigger>
          <TabsTrigger value="history" className={trigger}>Lịch sử ({old.length})</TabsTrigger>
          {showDiff && <TabsTrigger value="diff" className={trigger}>Thay đổi ({changes.length})</TabsTrigger>}
        </TabsList>
        <span role="status" className={cn("min-w-0 flex-1 truncate text-end text-xs text-ok", saved === "busy" && "text-muted-foreground", saved === "fail" && "font-semibold whitespace-normal text-warn")}>{savedText}</span>
      </div>
      {tab === "diff" && <CompareBar />}
      <div
        ref={list}
        className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-auto overscroll-contain px-3 pb-3"
        onPointerDown={() => { touched.current = performance.now(); }}
        onWheel={() => { touched.current = performance.now(); }}
        onTouchMove={() => { touched.current = performance.now(); }}
      >
        {tab === "open" && (open.length ? open.map((n) => <NoteCard key={n.id} note={n} near={n.id === nearNote} editing={n.id === editing} />) : <Empty>Chưa có ghi chú</Empty>)}
        {tab === "history" && (old.length ? old.map((n) => <HistoryCard key={n.id} note={n} />) : <Empty>Ghi chú sửa xong sẽ nằm ở đây, kèm việc đã làm</Empty>)}
        {tab === "diff" && (changes.length ? changes.map((c, i) => <ChangeCard key={`${c.title}${c.from}${i}`} change={c} near={i === nearChange} />) : <Empty>{emptyWords()}</Empty>)}
      </div>
    </Tabs>
  );
}
