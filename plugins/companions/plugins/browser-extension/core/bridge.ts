import { z } from "zod";
import { EXTENSION_ORIGIN } from "./extension-id";
import {
  RecordPresetIdSchema,
  RecorderCommandSchema,
  RecorderOptionsSchema,
  RecorderSnapshotSchema,
  TabFitSchema,
} from "./recorder";

/**
 * The bridge between the extension's shell (`browser-extension/popup.ts`) and
 * the equin page it frames — the contract both halves parse, mirroring the
 * menu bar's `native-bridge.ts`.
 *
 * Transport: the page, once it listens, says hello to its parent (posted to
 * the extension's origin only); the shell answers a hello from its own iframe
 * — pinned to the equin origin it framed — with a fresh `MessagePort`. Every
 * call then goes over that port. The page accepts a port only from the
 * extension's origin (`acceptBridgePort`), so a foreign page framing equin
 * gets no bridge.
 */

/** What the host can do. A capability a shell lacks is `false`, and the page
 *  hides what would use it. `setHeight` and `reload` are every shell's. */
export const ExtensionCapabilitiesSchema = z.object({
  /** Read the tab the popup is about (`activeTab`). */
  activeTab: z.boolean(),
  /** Navigate that tab (`navigate`). */
  navigate: z.boolean(),
  /** Open a new tab (`openTab`). */
  openTab: z.boolean(),
  /** Close the popup (`close`). */
  close: z.boolean(),
  /** Record the tab (`recorder`, `recorderFit`, `recorderStart`,
   *  `recorderOptions`, `recorderCommand`, `recorderApplySize`,
   *  `requestMicrophone`). Absent on a
   *  shell from before the recorder. */
  record: z.boolean().optional(),
  /** Hand over the previous popup's lifecycle trace (`lastPopupTrace`).
   *  Absent on a shell from before the trace. */
  trace: z.boolean().optional(),
});
export type ExtensionCapabilities = z.infer<typeof ExtensionCapabilitiesSchema>;

/** `hostInfo()`'s answer. `shellDigest` names the shell's own build: the page
 *  reloads the extension when the served shell's differs. */
export const ExtensionHostInfoSchema = z.object({
  version: z.literal(1),
  shellDigest: z.string().min(1),
  capabilities: ExtensionCapabilitiesSchema,
});
export type ExtensionHostInfo = z.infer<typeof ExtensionHostInfoSchema>;

/**
 * What happened to one popup, from its open to its close: each lifecycle
 * event the shell saw (its window's focus, its visibility, its page hiding,
 * an uncaught error, a bridge call that closes it), stamped in ms since the
 * popup's script started. Chrome closes a popup on its own — on focus loss,
 * on an extension reload — and leaves no trace of why, so the shell keeps
 * this in its own storage as it goes, and the next popup hands it to the
 * page to log (`lastPopupTrace`).
 */
export const PopupTraceEventSchema = z.object({
  at: z.number().nonnegative(),
  kind: z.enum([
    "open",
    "frame-load",
    "hello",
    "focus",
    "blur",
    "visibility",
    "pagehide",
    "error",
    "rejection",
    "close-call",
    "reload-call",
    "set-height",
  ]),
  detail: z.string(),
});
export type PopupTraceEvent = z.infer<typeof PopupTraceEventSchema>;

/** At most this many events are kept per popup: the first ones (the open is
 *  what the trace is for) and a last marker that more were dropped. */
export const POPUP_TRACE_MAX_EVENTS = 64;

export const PopupTraceSchema = z.object({
  /** Epoch ms of the popup's start. */
  openedAt: z.number(),
  shellDigest: z.string(),
  events: z.array(PopupTraceEventSchema).max(POPUP_TRACE_MAX_EVENTS),
  /** Events not kept past the cap. */
  dropped: z.number().int().nonnegative(),
});
export type PopupTrace = z.infer<typeof PopupTraceSchema>;

/** The tab the popup is about. */
export const ActiveTabSchema = z.object({
  url: z.string(),
  title: z.string(),
});
export type ActiveTab = z.infer<typeof ActiveTabSchema>;

const UrlParams = z.object({ url: z.url() });
const NoParams = z.object({});

/** One call, by method. */
export const BridgeCallSchema = z.discriminatedUnion("method", [
  z.object({ method: z.literal("hostInfo"), params: NoParams }),
  z.object({ method: z.literal("activeTab"), params: NoParams }),
  z.object({ method: z.literal("navigate"), params: UrlParams }),
  z.object({
    method: z.literal("openTab"),
    // `background`: open it behind the current tab, as a middle-click on a
    // link does (the popup stays open).
    params: UrlParams.extend({ background: z.boolean().optional() }),
  }),
  z.object({ method: z.literal("close"), params: NoParams }),
  z.object({
    method: z.literal("setHeight"),
    params: z.object({ px: z.number().int().nonnegative() }),
  }),
  z.object({ method: z.literal("reload"), params: NoParams }),
  // The recorder (capability `record`). `recorder` also subscribes this port
  // to the snapshot's changes, pushed as `BridgeEvent`s.
  z.object({ method: z.literal("recorder"), params: NoParams }),
  z.object({ method: z.literal("recorderFit"), params: NoParams }),
  z.object({
    method: z.literal("recorderStart"),
    params: z.object({ options: RecorderOptionsSchema }),
  }),
  z.object({
    method: z.literal("recorderOptions"),
    params: z.object({ options: RecorderOptionsSchema }),
  }),
  z.object({
    method: z.literal("recorderCommand"),
    params: z.object({ command: RecorderCommandSchema }),
  }),
  // Size the tab's window to a preset's page now, without recording.
  z.object({
    method: z.literal("recorderApplySize"),
    params: z.object({ preset: RecordPresetIdSchema }),
  }),
  z.object({ method: z.literal("requestMicrophone"), params: NoParams }),
  // The previous popup's trace (capability `trace`), handed over once.
  z.object({ method: z.literal("lastPopupTrace"), params: NoParams }),
]);
export type BridgeCall = z.infer<typeof BridgeCallSchema>;
export type BridgeMethod = BridgeCall["method"];

/** What each method answers; every other method answers `null`. */
export const BRIDGE_RESULTS = {
  hostInfo: ExtensionHostInfoSchema,
  activeTab: ActiveTabSchema,
  navigate: z.null(),
  openTab: z.null(),
  close: z.null(),
  setHeight: z.null(),
  reload: z.null(),
  recorder: RecorderSnapshotSchema,
  recorderFit: TabFitSchema,
  recorderStart: z.null(),
  recorderOptions: z.null(),
  recorderCommand: z.null(),
  recorderApplySize: z.null(),
  requestMicrophone: z.null(),
  lastPopupTrace: PopupTraceSchema.nullable(),
} as const satisfies Record<BridgeMethod, z.ZodType>;
export type BridgeResult<M extends BridgeMethod> = z.infer<
  (typeof BRIDGE_RESULTS)[M]
>;

/** A call on the port: its id and the call. */
export const BridgeRequestSchema = z
  .object({ id: z.number().int() })
  .and(BridgeCallSchema);
export type BridgeRequest = z.infer<typeof BridgeRequestSchema>;

/** A call's answer on the port. */
export const BridgeResponseSchema = z.discriminatedUnion("ok", [
  z.object({ id: z.number().int(), ok: z.literal(true), value: z.unknown() }),
  z.object({ id: z.number().int(), ok: z.literal(false), error: z.string() }),
]);
export type BridgeResponse = z.infer<typeof BridgeResponseSchema>;

/**
 * What the shell pushes on the port unasked: the recorder's snapshot, each
 * time it changes, to a port that called `recorder` (a page that never did
 * gets none, so an older page never sees one).
 */
export const BridgeEventSchema = z.object({
  event: z.literal("recorder"),
  value: RecorderSnapshotSchema,
});
export type BridgeEvent = z.infer<typeof BridgeEventSchema>;

/** The page's hello to its parent, asking for the port. */
export const BRIDGE_HELLO = { type: "equin-bridge-hello" } as const;
export const BridgeHelloSchema = z.object({
  type: z.literal(BRIDGE_HELLO.type),
});

/** The shell's answer to a hello, carrying the port. */
export const BRIDGE_PORT = { type: "equin-bridge-port", version: 1 } as const;
const BridgePortSchema = z.object({
  type: z.literal(BRIDGE_PORT.type),
  version: z.literal(1),
});

/** The parts of a `message` event the port check reads. */
export interface BridgePortMessage<Port, Source> {
  origin: string;
  source: Source | null;
  data: unknown;
  ports: readonly Port[];
}

/**
 * The bridge port a message hands the page, or `null` when it is not the
 * extension's: it must come from the page's own parent, from the extension's
 * origin, in the port message's shape, with exactly one port. Anything else —
 * a foreign page framing equin, another window posting — is not a bridge.
 */
export function acceptBridgePort<Port, Source>(
  event: BridgePortMessage<Port, Source>,
  parent: Source,
): Port | null {
  if (event.origin !== EXTENSION_ORIGIN) return null;
  if (event.source !== parent) return null;
  if (!BridgePortSchema.safeParse(event.data).success) return null;
  const [port] = event.ports;
  if (port === undefined || event.ports.length !== 1) return null;
  return port;
}
