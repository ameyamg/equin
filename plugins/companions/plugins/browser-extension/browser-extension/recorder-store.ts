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
import { chrome } from "./chrome-api";

export const STATE_KEY = "recorder.state";
export const OPTIONS_KEY = "recorder.options";

const IDLE: RecorderState = { kind: "idle", last: null };

export async function readRecorderState(): Promise<RecorderState> {
  const raw = (await chrome.storage.session.get(STATE_KEY))[STATE_KEY];
  return raw === undefined ? IDLE : RecorderStateSchema.parse(raw);
}

export async function writeRecorderState(state: RecorderState): Promise<void> {
  await chrome.storage.session.set({ [STATE_KEY]: state });
}

export async function readRecorderOptions(): Promise<RecorderOptions> {
  const raw = (await chrome.storage.local.get(OPTIONS_KEY))[OPTIONS_KEY];
  if (raw === undefined) return DEFAULT_RECORDER_OPTIONS;
  // Options an older shell stored may lack a newer field: the default fills it.
  return RecorderOptionsSchema.parse({
    ...DEFAULT_RECORDER_OPTIONS,
    ...(raw as object),
  });
}

export async function writeRecorderOptions(
  options: RecorderOptions,
): Promise<void> {
  await chrome.storage.local.set({ [OPTIONS_KEY]: options });
}
