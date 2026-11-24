import type { ComponentType, ReactNode } from "react";
import type { ClassName } from "@plugins/primitives/plugins/css/plugins/ui-kit/core";
import { defineRenderSlot } from "@plugins/primitives/plugins/slot-render/web";
import { defineSlot } from "@plugins/framework/plugins/web-sdk/core";
import type { ResourceResult } from "@plugins/network/plugins/live/plugins/live-state/web";

/**
 * Which of the two config-detail conflict banners is hosting the action.
 *
 * - `hash` — upstream defaults moved under the user's override; the app runs
 *   the upstream values until the user reconciles.
 * - `invalid` — the stored document no longer validates against the current
 *   schema; the app runs the code defaults.
 */
export type ConfigConflictKind = "hash" | "invalid";

/** conflict = both sides changed it differently; upstream-changed = only upstream moved; unchanged = identical. */
export type ConfigConflictFieldStatus =
  "conflict" | "upstream-changed" | "unchanged";

export interface ConfigConflictField {
  key: string;
  label?: string;
  description?: string;
  /** The user's own override value (what the editor binds to). */
  mine: unknown;
  /** The origin/upstream value the app currently resolves to. */
  upstream: unknown;
  status: ConfigConflictFieldStatus;
}

/**
 * Everything a contributed conflict action needs to describe the conflict it
 * sits on, WITHOUT reading config_v2's resources itself: which descriptor, which
 * scope, which kind of breakage, and the per-field classification the banner
 * already computed.
 *
 * The banner supplies it whole and the contribution is pure over it — which is
 * what lets the tasks stack stay out of the generic config editor.
 */
export interface ConfigConflictContext {
  storePath: string;
  /** Human label for this config — the owning plugin's leaf name, as the nav shows it. */
  name: string;
  /** undefined = the base scope. */
  scopeId?: string;
  kind: ConfigConflictKind;
  /** Every field of the descriptor, classified. */
  fields: ConfigConflictField[];
  /** kind === "invalid" only: schema issues with the path pre-joined ("items.6" / "(root)"). */
  issues?: { path: string; message: string }[];
  /**
   * The hosting banner's own button tint — spread on the contributed trigger so
   * contributed actions match the banner they sit in (warning vs destructive).
   */
  actionClassName: ClassName;
}

/** The document a detail banner is about: the descriptor's store path and the selected scope. */
export interface ConfigDocumentBannerProps {
  storePath: string;
  /** undefined = the base scope. */
  scopeId?: string;
}

export const ConfigDetailSlots = {
  /**
   * Lines about the document as a whole, above its conflict banners and its
   * fields — pane chrome, outside `ControlPanelPane` (e.g. "updated with the
   * new defaults · Undo"). A contribution renders nothing when it has nothing
   * to say about this document.
   */
  Banner: defineRenderSlot<{
    component: ComponentType<ConfigDocumentBannerProps>;
  }>(),
  /**
   * Extra actions inside a conflict banner, rendered leftmost — the "get help"
   * end of the row, ahead of the decisive Merge / Accept / Reset resolutions.
   */
  ConflictAction: defineRenderSlot<{
    component: ComponentType<{ conflict: ConfigConflictContext }>;
  }>(),
};

/** What a contributed nav field reads: the store paths it is true for. */
export type ConfigNavFieldRead = ResourceResult<ReadonlySet<string>>;

/**
 * A yes/no field of every config row in the nav, contributed by a plugin that
 * knows something about configs the nav does not (e.g. "auto-merged"): a
 * filterable bool an authored nav view can filter on.
 *
 * `component` reads the field — its own fixed hook — and hands the read to
 * `children`. While it is loading the whole nav renders its loading state (a
 * view filtered on the field would otherwise claim "none"); a failure renders
 * the nav's error.
 */
export interface ConfigNavField {
  /** The field id an authored view's filter names (`fieldId`). */
  id: string;
  label: string;
  component: ComponentType<{
    children: (read: ConfigNavFieldRead) => ReactNode;
  }>;
}

export const ConfigNavSlots = {
  /** Contributed nav fields (data, never drawn): see {@link ConfigNavField}. */
  Field: defineSlot<ConfigNavField>(),
  /**
   * Notices pinned above the config nav — something about the user's saved
   * settings as a whole that no single config row can say (e.g. overrides that
   * no longer apply to any config). A contribution renders nothing when it has
   * nothing to say.
   */
  Notice: defineRenderSlot<{ component: ComponentType }>(),
};
