// Right side of the picture, under the clock: the options whose moment is now or about to come (engine/options.ts picks
// them). A pick shows or sounds at once; Chốt writes it for the renders. Only the chips take clicks; the rest of the
// picture still pins notes
import { cn } from "cn";
import { useLayoutEffect } from "react";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { letter, rangeText } from "../engine/env";
import { choose, pinPick } from "../engine/options";
import { fitOverlays } from "../engine/player";
import { type GroupView, useStudio } from "../engine/store";

function Chip({ group: g, range }: { group: GroupView; range: [number, number] }) {
  const now = g.options.find((o) => o.id === g.pick) ?? g.options[0];
  return (
    <div role="group" aria-label={`${g.title}, ${rangeText(range)}`} className="pointer-events-auto max-w-full flex-none rounded-lg bg-black/62 px-1.5 pt-1 pb-1.5 upright:px-1 upright:pt-0.75 upright:pb-1">
      <p title={`${g.title}: ${now.title}`} className="mx-0.5 mb-1 flex items-baseline gap-1.5 text-xs whitespace-nowrap text-muted-foreground tabular-nums upright:flex-wrap upright:gap-x-1.5 upright:gap-y-0 upright:text-[11px]">
        <b className="font-semibold text-picture">{g.title}</b>
        <span>{rangeText(range)}</span>
        <span className="ml-auto min-w-0 truncate pl-1.5 text-foreground upright:hidden">{now.title}</span>
      </p>
      <div className="flex gap-1 upright:flex-wrap">
        <ToggleGroup
          value={[g.pick]}
          // A tap on the pick already made comes back empty: play it again, as a tap on any other does
          onValueChange={(v: string[]) => { const i = g.options.findIndex((o) => o.id === (v[0] ?? g.pick)); if (i >= 0) choose(g.name, i); }}
          spacing={1}
          className="flex-wrap"
          aria-label={g.title}
        >
          {g.options.map((o, i) => {
            const chosen = o.id === g.chosen;
            return (
              <ToggleGroupItem
                key={o.id}
                value={o.id}
                title={`${letter(i)}: ${o.title}${chosen ? " (đã chốt)" : ""}`}
                aria-label={`${letter(i)}, ${o.title}${chosen ? ", đã chốt" : ""}`}
                className={cn(
                  "min-h-7.5 min-w-7.5 border border-transparent bg-secondary px-2 text-[13px] font-semibold tabular-nums aria-pressed:border-primary aria-pressed:bg-tint aria-pressed:text-primary upright:min-h-7 upright:min-w-7 upright:px-1.5 upright:text-xs",
                  chosen && "shadow-[inset_0_-3px_0_var(--warn)]",
                )}
              >
                {letter(i)}
              </ToggleGroupItem>
            );
          })}
        </ToggleGroup>
        {g.pick !== g.chosen && (
          <Button className="min-h-7.5 px-2 text-[13px] font-semibold upright:min-h-7 upright:text-xs" onClick={(e) => {
            // This button goes once the pick is saved: from the keyboard, focus moves to the pick that stays instead of the page
            if (!e.detail) e.currentTarget.closest("[role=group]")?.querySelector<HTMLElement>("[aria-pressed=true]")?.focus();
            pinPick(g.name);
          }} aria-label={`Chốt ${now.title} cho ${g.title}`}>Chốt</Button>
        )}
      </div>
    </div>
  );
}

export function OptionChips({ ref }: { ref: (node: HTMLDivElement | null) => void }) {
  const chips = useStudio((s) => s.chips), groups = useStudio((s) => s.groups);
  useLayoutEffect(fitOverlays, [chips, groups]);
  return (
    <div ref={ref} className="pointer-events-none absolute top-13 right-2.5 bottom-11 z-3 flex max-w-[48%] flex-col items-end gap-1 overflow-y-auto overscroll-contain [scrollbar-width:none] upright:top-8 upright:right-1.5 upright:bottom-1.5 upright:max-w-[46%] upright:gap-0.75 sideways:top-8 sideways:right-1.5 sideways:bottom-1.5">
      {chips.map(({ name, range }) => {
        const g = groups.find((x) => x.name === name);
        return g ? <Chip key={name} group={g} range={range} /> : null;
      })}
    </div>
  );
}
