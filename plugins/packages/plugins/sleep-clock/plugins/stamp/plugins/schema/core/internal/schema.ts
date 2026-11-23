import { z } from "zod";
import {
  clockStamp,
  type ClockStamp,
  type SleepStamp,
} from "@plugins/packages/plugins/sleep-clock/plugins/stamp/core";

/** A stored {@link SleepStamp} (a JSON column, a log line), parsed. */
export const SleepStampSchema = z.object({
  boot: z.string(),
  asleepMs: z.number(),
}) satisfies z.ZodType<SleepStamp>;

/**
 * A stored {@link ClockStamp}: both halves of one instant, kept together so a
 * reader can never pair one instant's wall time with another's sleep.
 */
export const ClockStampSchema = z
  .object({
    wallMs: z.number(),
    sleep: SleepStampSchema.nullable(),
  })
  .transform(({ wallMs, sleep }) =>
    clockStamp(wallMs, sleep),
  ) satisfies z.ZodType<ClockStamp>;
