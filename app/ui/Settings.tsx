// Settings take the notes' place in the side column, so the film and the timeline never move. Heavy or slow options sit in
// their own warned section; every option whose name doesn't explain itself has a "?"
import { X } from "lucide-react";
import { type ReactNode, useLayoutEffect, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Kbd } from "@/components/ui/kbd";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { AWAY, FPS, rangeText } from "../engine/env";
import { copyAll } from "../engine/notes";
import { audioCtx, choose, pinPick, setGain, whereNext } from "../engine/options";
import { copyCam, jumpShot, seek, setCaptions, setFinal, setFree, setLoop, setPlaying, setReview, setTryOn } from "../engine/player";
import { S } from "../engine/state";
import { set, useStudio } from "../engine/store";
import { zoomSpan } from "../engine/timeline";
import { HelpTip } from "./HelpTip";
import { Speed } from "./Speed";

const Keys = ({ keys }: { keys: string[] }) => (
  <span aria-hidden className="inline-flex items-center gap-0.5 pointer-coarse:hidden">{keys.map((k) => <Kbd key={k}>{k}</Kbd>)}</span>
);
// Each part's name sits above one box holding all of its controls, so a control never reads as part of the next section.
// rows: one setting per line with a rule between them; otherwise the box holds a block (a list, buttons, text)
const Section = ({ title, help, children, rows, warn, className }: { title: ReactNode; help?: [string, string]; children: ReactNode; rows?: boolean; warn?: boolean; className?: string }) => (
  <section className={`flex flex-col gap-2 ${className ?? ""}`}>
    <h3 className={`flex min-h-5 items-center gap-1.5 px-1 text-[13px] font-semibold ${warn ? "text-warn" : ""}`}>{title}{help && <HelpTip label={help[0]}>{help[1]}</HelpTip>}</h3>
    <div className={`rounded-xl ${warn ? "bg-warn-bg" : "bg-card"} ${rows ? "divide-y divide-border px-3" : "flex flex-col gap-2 p-3"}`}>{children}</div>
  </section>
);
function SwitchRow({ id, label, keys, help, checked, onChange }: { id: string; label: string; keys?: string[]; help?: string; checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <Field orientation="horizontal" className="min-h-10 justify-between gap-3">
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        <FieldLabel htmlFor={id} className="min-h-10 cursor-pointer text-sm font-normal">{label}{keys && <Keys keys={keys} />}</FieldLabel>
        {help && <HelpTip label={label}>{help}</HelpTip>}
      </span>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </Field>
  );
}
const Row = ({ children }: { children: ReactNode }) => <div className="flex min-h-10 items-center justify-between gap-3">{children}</div>;

function Options() {
  const groups = useStudio((s) => s.groups), groupName = useStudio((s) => s.groupName);
  const g = groups.find((x) => x.name === groupName);
  if (!g) return null;
  const items = groups.map((x) => ({ value: x.name, label: x.title }));
  const r = g.ranges;
  const go = () => {
    const at = whereNext(g.name);
    if (at === null) return;
    audioCtx.resume();
    seek(at);
    if (!S.playing) setPlaying(true);
  };
  return (
    <Section title={<>Lựa chọn <span aria-hidden className="inline-flex items-center gap-0.5 pointer-coarse:hidden"><Kbd>0</Kbd>–<Kbd>9</Kbd></span></>} help={["Lựa chọn", "Mỗi nhóm là một đồ vật hay một tiếng có nhiều phương án. Chọn một phương án là thấy, nghe ngay. Xem hoặc Nghe: nhảy tới chỗ có nó và phát. Chốt: phim, cả bản final, dùng phương án này (ghi vào choices.json). Chốt lại phương án khác lúc nào cũng được."]}>
      <Select items={items} value={groupName} onValueChange={(v) => { set({ groupName: v as string }); S.dirty = true; }}>
        <SelectTrigger className="h-9 w-full" aria-label="Nhóm lựa chọn"><SelectValue /></SelectTrigger>
        <SelectContent>{items.map((i) => <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>)}</SelectContent>
      </Select>
      <div className="flex flex-col gap-1">
        {g.options.map((o, i) => (
          <Button
            key={o.id}
            variant="secondary"
            aria-pressed={o.id === g.pick}
            title={o.source}
            className="h-auto min-h-9 justify-between gap-2 text-left text-sm font-normal whitespace-normal aria-pressed:bg-tint aria-pressed:text-primary"
            onClick={() => choose(g.name, i)}
          >
            <span>{i} {o.title}</span>
            {o.id === g.chosen && <span className="text-xs font-semibold whitespace-nowrap text-warn">đã chốt</span>}
          </Button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground tabular-nums">
        {r.length ? `${g.picture ? "Thấy" : "Nghe"} lúc ${r.slice(0, 4).map(rangeText).join(", ")}${r.length > 4 ? ` và ${r.length - 4} chỗ nữa` : ""}` : "Không lúc nào thấy trên hình"}
      </p>
      <div className="flex items-center gap-1.5">
        {!g.picture && <>
          <div className="flex h-9 min-w-0 flex-1 items-center" title="To nhỏ"><Slider min={0} max={2} step={0.05} value={g.gain} onValueChange={(v: number | readonly number[]) => setGain(g.name, typeof v === "number" ? v : v[0])} aria-label="To nhỏ của tiếng đang thử" format={{ style: "percent" }} /></div>
          <span className="min-w-[4ch] text-end text-muted-foreground tabular-nums">{Math.round(g.gain * 100)}%</span>
        </>}
        <Button variant="secondary" size="lg" className={g.picture ? "flex-1" : ""} title={g.picture ? "Nhảy tới chỗ thấy nó và phát" : "Nhảy tới chỗ có tiếng này và phát"} onClick={go}>{g.picture ? "Xem" : "Nghe"}</Button>
        <Button size="lg" title="Dùng lựa chọn này cho phim" onClick={() => pinPick(g.name)}>Chốt</Button>
      </div>
    </Section>
  );
}

const KEYS: [ReactNode, ReactNode][] = [
  ["Bấm vào hình", "ghim một chỗ rồi nói"],
  [<Kbd>N</Kbd>, "ghi chú"],
  [<Kbd>Space</Kbd>, "phát, dừng"],
  [<><Kbd>←</Kbd><Kbd>→</Kbd></>, "1 hình (thêm Shift: 5 giây)"],
  [<><Kbd>↑</Kbd><Kbd>↓</Kbd></>, "to nhỏ"],
  [<Kbd>M</Kbd>, "tắt tiếng"],
  [<><Kbd>[</Kbd><Kbd>]</Kbd></>, "shot trước, sau"],
  [<Kbd>L</Kbd>, "lặp shot"],
  [<Kbd>I</Kbd>, "danh sách kỹ thuật ở góc trái"],
  ["Lăn chuột", "trên timeline: phóng to"],
  [<Kbd>F</Kbd>, <>camera tự do: kéo lia, lăn tiến lùi, chuột phải dời, Shift+kéo xoay quanh, giữ <Kbd>W</Kbd><Kbd>A</Kbd><Kbd>S</Kbd><Kbd>D</Kbd><Kbd>Q</Kbd><Kbd>E</Kbd> đi (thêm Shift: nhanh gấp 3), <Kbd>-</Kbd><Kbd>=</Kbd> ống kính</>],
  [<><Kbd>K</Kbd> <Kbd>G</Kbd></>, "chép góc máy; xem final"],
  [<><Kbd>0</Kbd>–<Kbd>9</Kbd></>, "chọn phương án của nhóm đang hiện"],
  [<Kbd>Esc</Kbd>, "đóng cài đặt"],
];

// Its own part: the frame time changes twice a second, and nothing else here should redraw for it
function Footer() {
  const shot = useStudio((s) => s.shot), perf = useStudio((s) => s.perf);
  return (
    <div className="flex flex-none gap-3 border-t px-3 py-2 text-xs text-muted-foreground">
      <span className="min-w-0 flex-1 truncate">{shot}</span>
      <span className="whitespace-nowrap tabular-nums pointer-coarse:hidden">{perf}</span>
    </div>
  );
}

export function Settings() {
  const s = useStudio(useShallow((x) => ({
    contract: x.contract, captions: x.captions, tryOn: x.tryOn, review: x.review, reviewAvailable: x.reviewAvailable,
    loop: x.loop, free: x.free, final: x.final, selection: x.selection,
  })));
  // Closing from the keyboard would leave focus on nothing: it goes back to the button that opened the settings
  const region = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => () => {
    if (region.current?.contains(document.activeElement)) document.querySelector<HTMLElement>("[aria-controls=settings]")?.focus();
  }, []);
  const step = (d: number) => seek(S.t + d);
  return (
    <div ref={region} id="settings" role="region" aria-labelledby="settings-title" className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-none items-center justify-between py-2 pr-1.5 pl-3">
        <h2 id="settings-title" className="text-[15px] font-semibold">Cài đặt</h2>
        <Button variant="ghost" size="icon" className="size-10 text-muted-foreground" aria-label="Đóng cài đặt" title="Esc" onClick={() => set({ settingsOpen: false })}><X /></Button>
      </div>
      <div data-arrow-scroll className="flex min-h-0 flex-1 flex-col gap-6 overflow-auto overscroll-contain px-3 pt-1 pb-3">
        {s.contract.length > 0 && (
          <Section title="Phim sai quy ước">
            <p className="text-xs text-muted-foreground">Gửi đoạn này cho AI đang làm phim, nó cũng thấy ở terminal của studio. Quy ước: docs/film-contract.md trong live-studio.</p>
            <pre className="max-h-[40vh] overflow-auto overscroll-contain rounded-lg bg-warn-bg px-2.5 py-2 font-mono text-xs/normal whitespace-pre-wrap wrap-anywhere">{s.contract.join("\n\n")}</pre>
          </Section>
        )}
        {/* No keyboard on a phone: every key it would need has a button here */}
        <Section title="Tua" className="hidden pointer-coarse:flex">
          <div className="grid grid-cols-4 gap-1.5">
            <Button variant="secondary" className="h-11" onClick={() => step(-5)}>-5s</Button>
            <Button variant="secondary" className="h-11 whitespace-nowrap" onClick={() => step(-1 / FPS)}>-1 hình</Button>
            <Button variant="secondary" className="h-11 whitespace-nowrap" onClick={() => step(1 / FPS)}>+1 hình</Button>
            <Button variant="secondary" className="h-11" onClick={() => step(5)}>+5s</Button>
            <Button variant="secondary" className="col-span-2 h-11" onClick={() => zoomSpan(1.5)}>Timeline −</Button>
            <Button variant="secondary" className="col-span-2 h-11" onClick={() => zoomSpan(1 / 1.5)}>Timeline +</Button>
          </div>
        </Section>
        <Section title="Xem" rows>
          <Row>
            <span className="text-sm whitespace-nowrap">Tốc độ</span>
            <Speed className="bg-background" item="h-8 pointer-coarse:h-10" />
          </Row>
          <SwitchRow id="captions" label="Phụ đề" checked={s.captions} onChange={setCaptions} />
          <SwitchRow id="try-on" label="Lựa chọn hiện trên hình" checked={s.tryOn} onChange={setTryOn} help="Sắp tới chỗ có đồ vật hay tiếng có nhiều phương án, một ô nhỏ hiện ở góc phải hình. Bấm A, B, C… để đổi ngay, bấm Chốt để phim dùng phương án đó." />
          {s.reviewAvailable && <SwitchRow id="review" label="Danh sách kỹ thuật" keys={["I"]} checked={s.review} onChange={setReview} help="Góc trái hình: mọi thứ đang chạy ở đúng khung hình này (camera, ánh sáng, nhân vật, tiếng) và file nào làm ra nó. Chỉ để xem, không có trong phim." />}
          <SwitchRow id="loop" label="Lặp shot" keys={["L"]} checked={s.loop} onChange={setLoop} help="Phát đi phát lại shot đang xem (một đoạn liền, giữa hai lần cắt cảnh) để soi kỹ." />
          <Row>
            <span className="flex items-center gap-1.5 text-sm">Chuyển shot <Keys keys={["[", "]"]} /></span>
            <span className="flex gap-1.5">
              <Button variant="secondary" size="lg" aria-label="Shot trước" onClick={() => jumpShot(-1)}>‹ Trước</Button>
              <Button variant="secondary" size="lg" aria-label="Shot sau" onClick={() => jumpShot(1)}>Sau ›</Button>
            </span>
          </Row>
        </Section>
        <Options />
        <Section title="Camera" rows className="pointer-coarse:hidden">
          <SwitchRow id="free-cam" label="Camera tự do" keys={["F"]} checked={s.free} onChange={setFree} help="Tách camera khỏi phim để tự đi quanh cảnh mà xem. Phim không đổi gì. Tắt đi là về lại góc máy thật." />
          <Row>
            <span className="flex min-w-0 flex-1 items-center gap-1.5">
              <span className="flex items-center gap-2 text-sm">Góc máy đang xem <Keys keys={["K"]} /></span>
              <HelpTip label="Chép góc máy">Chép vị trí và hướng camera đang thấy thành một dòng chữ. Dán vào ghi chú khi muốn AI đặt camera đúng như vậy.</HelpTip>
            </span>
            <Button variant="secondary" size="lg" aria-label="Chép góc máy" onClick={copyCam}>Chép</Button>
          </Row>
        </Section>
        <Section title="Ghi chú" rows help={["Chép ghi chú", "Chép mọi ghi chú chưa sửa xong thành một đoạn chữ, để dán cho AI ở chỗ khác."]}>
          <Row>
            <span className="text-sm">Mọi ghi chú chưa xong</span>
            <Button variant="secondary" size="lg" aria-label="Chép mọi ghi chú chưa xong" onClick={copyAll}>Chép</Button>
          </Row>
        </Section>
        <Section title="Timeline" help={["Timeline", "Bấm một khối trên timeline (câu thoại hay hành động) để xem nó nằm ở giây nào, ngay chữ nào."]}>
          <div className="flex flex-col gap-0.5 text-[13px] text-muted-foreground first:*:text-foreground">
            {s.selection.map((line) => <div key={line}>{line}</div>)}
          </div>
        </Section>
        {!AWAY && (
          <Section title="Nặng, phải chờ" warn>
            <p className="text-xs">Tốn thêm RAM và card đồ hoạ. Đang render hay chạy việc nặng khác thì máy có thể giật.</p>
            <SwitchRow id="final" label="Xem chất lượng final" keys={["G"]} checked={s.final} onChange={setFinal} help="Dựng thêm một bản 1920×1080 đủ hiệu ứng như video thật, rồi vẽ khung hình đang dừng bằng bản đó. Bật lên thì dừng phát. Lần đầu mất khoảng 10 giây." />
          </Section>
        )}
        <details className="group pointer-coarse:hidden">
          <summary className="flex min-h-8 cursor-pointer list-none items-center gap-1.5 px-1 text-[13px] font-semibold [&::-webkit-details-marker]:hidden">
            <span aria-hidden className="mx-0.5 size-1.5 -rotate-45 border-r-[1.5px] border-b-[1.5px] border-current group-open:rotate-45" />
            Phím tắt
          </summary>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 rounded-xl bg-card p-3 text-[13px]">
            {KEYS.map(([k, v], i) => (
              <div key={i} className="contents">
                <dt className="flex flex-wrap items-center gap-0.5">{k}</dt>
                <dd className="text-muted-foreground">{v}</dd>
              </div>
            ))}
          </dl>
        </details>
      </div>
      <Footer />
    </div>
  );
}
