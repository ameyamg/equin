import { z } from "zod";

/**
 * Where a reload-loss was seen:
 * - `unmount` — the dev unmount detector (kept-state/loss-detector): a
 *   page-level place unmounted (a hidden tab unloaded by tab residency) with
 *   React state the user changed that is neither kept nor marked transient.
 * - `scroll` — the same plugin's scroll watch: the user scrolled a pane's
 *   main `<Scroll>` that nothing keeps, so a reload opens it at its top.
 */
export const RELOAD_LOSS_ORIGINS = ["unmount", "scroll"] as const;

// The reload-loss report payload, stored in the generic `data` jsonb column
// and validated on ingest by the ReportKind. Mirrors loss-detector's
// `StateLoss` (the collector maps one onto the other).
const UnmountLossSchema = z.object({
  origin: z.literal("unmount"),
  // The keep-scope path of the place that unmounted (`t:<tabId>`).
  scope: z.string(),
  // The component holding the state, and the named components above it.
  component: z.string(),
  owners: z.array(z.string()).max(8),
  // Which useState / useReducer of the component, counting from 0.
  stateIndex: z.number().int().nonnegative(),
  // `<file>:<line>` of the first element the component renders, and the
  // `Name@<file>:<line>` owning it (element-picker's build stamps).
  source: z.string().optional(),
  uiOwner: z.string().optional(),
  // What the lost value looked like — its shape, never its content.
  value: z.string(),
});

const ScrollLossSchema = z.object({
  origin: z.literal("scroll"),
  // The pane holding the scroller (`data-pane-id`).
  pane: z.string(),
  // `Name@<file>:<line>` of the component rendering the `<Scroll>`, and the
  // scroller element's own `<file>:<line>` (element-picker's build stamps).
  uiOwner: z.string().optional(),
  source: z.string().optional(),
  // Where it was: `top 1200 of 4800`.
  offset: z.string(),
});

export const ReloadLossPayloadSchema = z.discriminatedUnion("origin", [
  UnmountLossSchema,
  ScrollLossSchema,
]);
export type ReloadLossPayload = z.infer<typeof ReloadLossPayloadSchema>;

// Fingerprint = sha256 of what names the defect, first 16 hex — one piece of
// state in one component (origin, component, state index, source), or one
// scroller (origin, owner stamp, source) — wherever it was lost.
export async function reloadLossFingerprint(
  data: ReloadLossPayload,
): Promise<string> {
  const parts =
    data.origin === "unmount"
      ? [
          data.origin,
          data.component,
          String(data.stateIndex),
          data.source ?? "",
        ]
      : [data.origin, data.uiOwner ?? "", data.source ?? ""];
  const bytes = new TextEncoder().encode(parts.join("\0"));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  let out = "";
  for (const b of digest) out += b.toString(16).padStart(2, "0");
  return out.slice(0, 16);
}
