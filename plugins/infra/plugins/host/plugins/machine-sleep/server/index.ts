import type { ServerPluginDefinition } from "@plugins/framework/plugins/server-core/core";

export {
  awakeSpanStart,
  currentSleepReading,
  darkWakeDuring,
  onSleepReadingChanged,
  publishSleepReading,
  sleptDuring,
  stampOfWallInstant,
  wakeBefore,
} from "./internal/publish";

export default {
  description:
    "The machine's sleep clock, read and published: publishSleepReading() re-reads it and tells its listeners only when it changed — called by an existing periodic observer, so a wake reaches the browser without a poller of its own — with currentSleepReading() and onSleepReadingChanged() for the machine half that serves it as the machine.sleep live value, sleptDuring(start, end) — the sleep this process saw inside a wall-clock span — darkWakeDuring(start, end) — the time inside it the machine was in a dark (maintenance) wake, awake for no person — stampOfWallInstant(wallMs, now) — the ClockStamp of a past wall instant nothing stamped (a row's created_at), from those sleeps — awakeSpanStart(end, awakeMs) — the wall-clock instant that much awake time before end, stepping over those sleeps, and wakeBefore(at, within) — the sleep whose wake came just before an instant, so what a wake explains can say the machine had just woken.",
} satisfies ServerPluginDefinition;
