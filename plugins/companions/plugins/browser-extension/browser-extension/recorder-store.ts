/**
 * Where the recorder keeps what outlives a page: the session state in
 * `chrome.storage.session` (the worker writes it, the popup follows it through
 * `storage.onChanged` — a push, no poll) and the panel's options in
 * `chrome.storage.local`.
 */
import {
  DEFAULT_RECORDER_OPTIONS,
  RecorderOptionsSchema,
  RecorderStateSchema,
  type RecorderOptions,
  type RecorderState,
} from "../core/recorder";
import { permitted } from "./chrome-api";

export const STATE_KEY = "recorder.state";
export const OPTIONS_KEY = "recorder.options";

const IDLE: RecorderState = { kind: "idle", last: null };

export async function readRecorderState(): Promise<RecorderState> {
  const raw = (await permitted("storage").session.get(STATE_KEY))[STATE_KEY];
  return raw === undefined ? IDLE : RecorderStateSchema.parse(raw);
}

export async function writeRecorderState(state: RecorderState): Promise<void> {
  await permitted("storage").session.set({ [STATE_KEY]: state });
}

export async function readRecorderOptions(): Promise<RecorderOptions> {
  const raw = (await permitted("storage").local.get(OPTIONS_KEY))[OPTIONS_KEY];
  if (raw === undefined) return DEFAULT_RECORDER_OPTIONS;
  // Options an older shell stored may lack a newer field: the default fills
  // it. Before 2026-11-25 the Clicks option was `pointer` (an arrow and
  // clicks): a person who had turned it off keeps clicks off.
  const stored = raw as { pointer?: unknown; clicks?: unknown };
  return RecorderOptionsSchema.parse({
    ...DEFAULT_RECORDER_OPTIONS,
    ...(typeof stored.pointer === "boolean" ? { clicks: stored.pointer } : {}),
    ...stored,
  });
}

export async function writeRecorderOptions(
  options: RecorderOptions,
): Promise<void> {
  await permitted("storage").local.set({ [OPTIONS_KEY]: options });
}
