import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";

export {
  AudioContextError,
  openAudioContext,
  type AudioGraphContext,
  type OwnedAudioContext,
  type ResumeOutcome,
} from "./internal/owned-audio-context";

export default {
  description:
    "An AudioContext with one owner of its resume and close: openAudioContext(options?) builds the context and answers an OwnedAudioContext — ctx (an AudioGraphContext: the context typed without resume / suspend / close, for building the graph), requestResume() → running | closed (closed by this owner while the resume was pending — the teardown of a page left before any gesture, never a crash) and close() (once; a second call is a no-op). Any other rejection, an InvalidStateError on a context the owner did not close included, throws an AudioContextError carrying the caller's stack. Its lint rule (no-raw-audio-context) sends every other new AudioContext and raw .resume() promise here.",
  contributions: [],
} satisfies PluginDefinition;
