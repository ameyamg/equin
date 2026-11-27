import { RelativeTime } from "@plugins/primitives/plugins/relative-time/web";
import { formatAbsoluteTime } from "../utils";
import { useDateFormatter } from "@plugins/fields/plugins/date/plugins/format/web";

export function Timestamp({ at, className }: { at: string; className?: string }) {
  const fmt = useDateFormatter();
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return null;
  return (
    <span title={formatAbsoluteTime(fmt, date)}>
      <RelativeTime date={date} className={className} />
    </span>
  );
}
