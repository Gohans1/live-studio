// The "?" next to an option that isn't clear from its name: a tap or a click opens the explanation, so it works on a phone too
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export function HelpTip({ label, children }: { label: string; children: string }) {
  return (
    <Popover>
      <PopoverTrigger
        aria-label={`${label}: giải thích`}
        className="relative inline-grid size-5 flex-none place-items-center rounded-full bg-raised-2 text-xs leading-none font-semibold text-foreground after:absolute after:-inset-2 data-popup-open:bg-tint data-popup-open:text-primary"
      >
        ?
      </PopoverTrigger>
      <PopoverContent side="bottom" align="start" className="w-[min(260px,calc(100vw-24px))] text-[13px] leading-normal">
        {children}
      </PopoverContent>
    </Popover>
  );
}
