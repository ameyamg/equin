import { cn } from "@plugins/primitives/plugins/css/plugins/ui-kit/web";
import { rigidClass } from "@plugins/primitives/plugins/css/plugins/rigid/web";
import { useDateFormatter } from "@plugins/fields/plugins/date/plugins/format/web";
import { useMinuteClock } from "../internal/use-minute-clock";

/**
 * The tray's clock (mockup `.tray-clock`): `10:42` over `Fri 16 Oct` (in the
 * user's clock and date order, without the comma some engines put after the
 * weekday), right-aligned, tabular figures. The date drops below 1100px of viewport,
 * the whole clock below 760px, as in the mockup.
 */
export function TrayClock() {
  const now = useMinuteClock();
  const fmt = useDateFormatter();
  return (
    <time
      dateTime={now.toISOString()}
      // eslint-disable-next-line layout/no-adhoc-layout -- the mockup's `.tray-clock` column, right-aligned, padding 0 8px 0 6px
      className={cn(
        rigidClass(),
        "flex flex-col items-end pr-sm pl-xsm text-caption font-[550] whitespace-nowrap tabular-nums max-[760px]:hidden",
      )}
    >
      <span>{fmt.time(now)}</span>
      <span className="font-[450] text-foreground/52 max-[1100px]:hidden">
        {fmt.date(now, { weekday: "short", year: "never" }).replace(",", "")}
      </span>
    </time>
  );
}
