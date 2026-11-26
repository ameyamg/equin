import { createKeyedMutex } from "@plugins/packages/plugins/keyed-mutex/core";

/**
 * One step at a time per recording in this process: a chunk's read of the
 * cursor, its write and its commit are one step, and a finish request, a
 * discard or a save runs after the chunks before it. (Across processes the
 * relay is the order — it sends one request at a time — and a save's disk
 * claim keeps two saves apart.)
 */
export const perRecording = createKeyedMutex("tab-recordings");
