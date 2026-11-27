import { Badge } from "@plugins/primitives/plugins/css/plugins/badge/web";
import { Inline } from "@plugins/primitives/plugins/css/plugins/inline/web";
import { StatusDot } from "@plugins/primitives/plugins/css/plugins/status-dot/web";
import { Text } from "@plugins/primitives/plugins/css/plugins/text/web";
import { useNow } from "@plugins/primitives/plugins/relative-time/web";
import { HOLD_SPECS, type HoldClass } from "@plugins/infra/plugins/jobs/core";
import { formatDuration } from "@plugins/fields/plugins/duration/core";
import { useDateFormatter } from "@plugins/fields/plugins/date/plugins/format/web";
import { formatAbsolute, formatWhen } from "../internal/format";
import type { JobListStatus, JobProblem } from "../internal/job-rows";
import { PROBLEM_LABEL, STATUS_META } from "../internal/status";

/**
 * An instant read relative to now, either way (`in 3m`, `12s ago`), ticking.
 * A future instant reads at full strength (it is still coming); a past one muted.
 */
export function WhenText({
  date,
  prefix,
  due = false,
}: {
  date: Date;
  /** What the instant is, for the tooltip ("Run at", "Finished"). */
  prefix?: string;
  /** A pending row's run-at: once passed, it reads `due` (runnable, waiting for a slot). */
  due?: boolean;
}) {
  const now = useNow(10_000);
  const fmt = useDateFormatter();
  const future = date.getTime() > now;
  const tone = future ? "default" : "muted";
  const title = `${prefix === undefined ? "" : `${prefix} `}${formatAbsolute(date, fmt)}`;
  return (
    <Text tone={tone} className="tabular-nums" title={title}>
      {due && !future ? "due" : formatWhen(date, now)}
    </Text>
  );
}

/** The time since `since`, as a duration ticking every second. */
export function RunningDuration({
  since,
  overCeilingAt,
}: {
  since: Date;
  /** Past this many ms it reads in the warning tint. */
  overCeilingAt: number | null;
}) {
  const now = useNow(1000);
  const ms = Math.max(0, now - since.getTime());
  const over = overCeilingAt !== null && ms > overCeilingAt;
  return (
    <Text className={over ? "tabular-nums text-warning" : "tabular-nums"}>
      {formatDuration(ms)}
    </Text>
  );
}

/**
 * A finished run's duration against its hold class's work ceiling. It is AWAKE
 * time (`sleptMs` says how long the machine slept during the run); a run
 * recorded before that (`sleptMs` null) is wall-clock and marked so, since a
 * sleep mid-run reads as run time on it.
 */
export function DurationText({
  ms,
  sleptMs,
  hold,
}: {
  ms: number;
  sleptMs: number | null;
  hold: HoldClass | null;
}) {
  const ceiling = hold === null ? null : HOLD_SPECS[hold].ceilingMs;
  const over = ceiling !== null && ms > ceiling;
  const notes = [
    over
      ? `Over the ${HOLD_SPECS[hold ?? "instant"].label} ceiling (${formatDuration(ceiling)})`
      : null,
    sleptMs === null
      ? "Wall-clock: recorded before runs were timed on awake time, so it counts any machine sleep during the run"
      : sleptMs > 0
        ? `Awake time — the machine also slept ${formatDuration(sleptMs)} during this run`
        : null,
  ].filter((n) => n !== null);
  return (
    <Text
      className={over ? "tabular-nums text-warning" : "tabular-nums"}
      title={notes.length === 0 ? undefined : notes.join("\n")}
    >
      {formatDuration(ms)}
      {sleptMs === null && <Text tone="muted"> (wall)</Text>}
    </Text>
  );
}

/** A status as a coloured dot + its label in the same colour. */
export function StatusLabel({ status }: { status: JobListStatus }) {
  const meta = STATUS_META[status];
  return (
    <Inline gap="xs">
      <StatusDot colorClass={meta.dot} />
      <Text className={meta.text}>{meta.label}</Text>
    </Inline>
  );
}

/** A status as a tinted badge with its dot (the detail header's form). */
export function StatusBadge({ status }: { status: JobListStatus }) {
  const meta = STATUS_META[status];
  return (
    <Badge variant={meta.badge} icon={<StatusDot colorClass={meta.dot} />}>
      {meta.label}
    </Badge>
  );
}

export function ProblemBadge({ problem }: { problem: JobProblem }) {
  return <Badge variant="destructive">{PROBLEM_LABEL[problem]}</Badge>;
}

export function HoldBadge({ hold }: { hold: HoldClass }) {
  return <Badge>{HOLD_SPECS[hold].label}</Badge>;
}

export function JobBadge({ name }: { name: string }) {
  return (
    <Badge variant="muted" mono tooltip={name}>
      {name}
    </Badge>
  );
}
