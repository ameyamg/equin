import { useCallback, useEffect, useMemo, useRef } from "react";
import type { ConfigDescriptor } from "@plugins/config_v2/core";
import type { SealContributions } from "@plugins/framework/plugins/web-sdk/core";
import type { VariantValue } from "@plugins/fields/plugins/variant/core";
import type { SavedSymbolName } from "@plugins/ui/plugins/icons/core";
import type { VariantEntry } from "@plugins/fields/plugins/variant/plugins/config/core";
import type {
  AddableSource,
  LockedViewRow,
  AddableViewType,
  ViewSourceEntry,
  ViewTypeMeta,
} from "../../core";
import {
  buildInstanceFromRow,
  buildLockedInstance,
  type ResolvedViewInstance,
} from "./resolve-instances";
import { useViewsConfig, type ViewsConfigHandle } from "./use-views-config";
import { cleanView, sameView, withDraft } from "./draft-values";
import { NO_DRAFTS, useDraftMap, useSurfaceDrafts } from "./view-drafts";
import { encodeViewAddress, parseViewAddress } from "./view-address";
import { useActiveViewId } from "@plugins/primitives/plugins/view-switcher/web";
import { resolveActiveId } from "./resolve-active-id";
import { usableTypes } from "./usable-types";
import {
  type AssertStableGetters,
  type ViewGetter,
  useViewGetter,
} from "./view-getter";

/**
 * Instance actions for the editable view-switcher (every view surface has
 * these). `updateView` is opaque about the variant value — the host layers
 * sort/filter on top of it.
 */
export interface ViewActionsCore {
  /** Add-menu groups, one per source entry (each entry's registered
   *  contributions ∩ `views` whitelist). A single-source
   *  surface yields exactly one untitled group — the flat-menu fast path. */
  availableSources: AddableSource[];
  /**
   * The type-switcher registry for ONE instance's settings popover: the types
   * that instance's own source can render (the same gate the add menu uses),
   * each paired with its options sub-form. Per-instance, never global — a
   * view can only switch into a type its own source entry offers.
   *
   * Stable per view: the same Map until THAT view's source entry or type
   * changes — renaming it, editing its options, or touching another view
   * leaves it alone, so a consumer can key a memo on it directly.
   */
  variantsFor: ViewGetter<Map<string, VariantEntry>>;
  /** Append a view of `type` (bound to `sourceId`) and make it the active
   *  one. */
  addView: (type: string, sourceId?: string) => void;
  renameView: (id: string, name: string) => void;
  /** Set the switcher glyph; `null` reverts to the view-type's own icon. */
  setViewIcon: (id: string, icon: SavedSymbolName | null) => void;
  /** Insert a copy of the view (its working copy, when drafted) after it and
   *  make the copy the active view. */
  duplicateView: (id: string) => void;
  /** Delete the view (and drop its draft). */
  deleteView: (id: string) => void;
  reorderView: (id: string, toIndex: number) => void;
  updateView: (
    id: string,
    view: VariantValue,
    opts?: { merge?: boolean },
  ) => void;
}

/**
 * Every value-returning member of `ViewActionsCore` must be a `ViewGetter` — a
 * new `fooFor: (id) => Foo` minting per call fails here; mint it with
 * `useViewGetter`.
 */
export const actionsGettersAreStable: AssertStableGetters<ViewActionsCore> = true;

/**
 * The generic, type-agnostic view model. Owns the instance list, active-id
 * resolution, and raw `view` read/write — but knows NOTHING about
 * sort/filter/query/expand. A consumer (e.g. data-view) wraps it to layer those
 * render concerns on top.
 */
export interface ViewModelCore<T extends ViewTypeMeta = ViewTypeMeta> {
  /** Is the authored config known yet? See `ViewsConfigHandle.ready` — while
   *  `false`, `instances` is "we don't know", never "there are none". */
  ready: boolean;
  /** Why `ready` is false when waiting will not fix it — see
   *  `ViewsConfigHandle.failure`. The host renders it (with Retry), never a
   *  loading state. `null` while loading, ready, or failed-with-a-held-value. */
  failure: ViewsConfigHandle["failure"];
  instances: ResolvedViewInstance<T>[];
  activeId: string;
  setActiveView: (id: string) => void;
  /** Raw `view` value for one instance (the variant blob) — its working copy
   *  while it is drafted, else the saved row's. `undefined` only for an unknown
   *  id. Returns stored objects, so a value keeps its identity until a write to
   *  that view replaces it. */
  viewFor: (id: string) => VariantValue | undefined;
  /** The saved row's `view` value, whatever its draft. Equal to `viewFor`
   *  without drafts. */
  savedViewFor: (id: string) => VariantValue | undefined;
  /** Whether the view has unsaved edits (a working copy differing from the
   *  saved row). Always `false` without drafts. */
  dirtyFor: ViewGetter<boolean>;
  /** Write a view's `view` value — into its working copy while drafts are on
   *  (a write equal to the saved value drops the copy), else to the config. */
  updateView: (
    id: string,
    view: VariantValue,
    opts?: { merge?: boolean },
  ) => void;
  /** The working-copy actions, or `null` when the surface did not opt into
   *  drafts (`useViewModel(…, { drafts: true })`). */
  drafts: ViewDrafts | null;
  actions: ViewActionsCore;
  /** Capability-gated add menu, grouped per source entry. */
  availableSources: AddableSource[];
}

/**
 * What a drafted surface does with a view's working copy. Every write to a
 * drafted view's `view` value (`updateView`, and so a host's sort / filter /
 * group-by setters) lands in its working copy; renaming, icons, reordering,
 * adding and deleting stay durable. A view's working copy lives per browser tab
 * (sessionStorage), like a search query.
 */
export interface ViewDrafts {
  /** Write the view's working copy to its config row and drop the copy. */
  save: (id: string) => void;
  /** Drop the view's working copy and return it (`null` when it had none), so
   *  a caller can offer to `restore` it. */
  discard: (id: string) => VariantValue | null;
  /** Make `view` the view's working copy again (an Undo of `discard`). */
  restore: (id: string, view: VariantValue) => void;
  /** Save the view's working copy as a NEW view right after it — named `name`,
   *  with `icon` (else the source's) — drop the source's copy, make the new
   *  view the active one and return its id. The source keeps its saved value. */
  saveAsNew: (
    id: string,
    row: { name: string; icon?: SavedSymbolName },
  ) => string;
}

/** `useViewModel`'s options. */
export interface ViewModelOptions {
  /** Edits to a view's `view` value go to a per-tab working copy — see
   *  {@link ViewDrafts}. Default off: every write is durable. */
  drafts?: boolean;
  /**
   * The projection under which two `view` values are the same view (a write
   * equal to the saved value drops the draft; `dirtyFor` compares under it).
   * Compared as canonical JSON (key order and `undefined` members ignored).
   * For a consumer whose values carry identities that do not make two views
   * different (data-view's filter-node ids). Pass a module-level function.
   */
  canonical?: (view: VariantValue) => unknown;
  /**
   * Where the URL holds the active view (a pane's surface view key), when it
   * does: a URL-named view outranks the device-local selection, and the URL is
   * DERIVED from the active view — see {@link activeViewUrlValue}. With
   * `drafts`, the value also carries the active view's working copy
   * (`<id>~<draft>`, `view-address.ts`), and a value arriving from outside (a
   * link, back/forward, F5) seeds that copy.
   * `null`/absent keeps the selection device-local only.
   */
  activeViewUrl?: ActiveViewUrl | null;
  /**
   * Views the host defines rather than the config (`LockedViewRow`). A config
   * row of a locked view's id is its PLACEHOLDER: it holds the view's place
   * only (the view is the host's). Locked views without one are listed
   * first, in this order, then the config's rows. Copy-only — renaming,
   * re-iconing, deleting or saving over one throws (no list offers it);
   * Duplicate and Save as new append a config row made from it; reordering
   * one writes its placeholder.
   * Needs `drafts` (an edit to a locked view can only be a working copy).
   * Pass a referentially-stable array: the instance list memoizes on it.
   */
  locked?: readonly LockedViewRow[];
}

const NO_LOCKED: readonly LockedViewRow[] = [];

/**
 * Where the URL holds the active view: the read and write of one address key
 * (a pane's `;view.<surface>`, see `usePaneViewParam`). Structural, so this
 * engine names no router.
 */
export interface ActiveViewUrl {
  /** The view the address names, `undefined` when it names none — its id, or
   *  under drafts its address (`<id>[~<draft>]`, `view-address.ts`). */
  value: string | undefined;
  /** Write the value into the address, or remove it with `undefined` (in
   *  place — no history entry). */
  set: (viewId: string | undefined) => void;
}

/** How many of its own URL writes a surface remembers, so none of them reads back as news. */
const RECENT_WRITES = 8;

/**
 * THE rule for what the URL holds while `activeId` is on screen: nothing on
 * the surface's static default (`staticDefault` — its authored `defaultView`,
 * else its first view), so a list on its default adds nothing to the address;
 * the active id otherwise, so the address always reproduces the screen.
 */
export function activeViewUrlValue(
  activeId: string,
  staticDefault: string,
): string | undefined {
  return activeId === staticDefault ? undefined : activeId;
}

/**
 * The single generic view model: config-authored instances, raw view read/write,
 * full instance actions. active-id stays device-local via `useActiveViewId`.
 * Opaque about per-instance options (`sort`/`filter`/query/expand are the host's
 * concern).
 *
 * `entries` is the ordered source-entry list; single-source consumers pass one
 * implicit entry (`id`/`title` undefined). Pass a referentially-stable array —
 * the instance list and add menu memoize on it.
 */
export function useViewModel<T extends ViewTypeMeta>(
  storageKey: string,
  descriptorMap: Map<string, ConfigDescriptor>,
  entries: ViewSourceEntry<T>[],
  defaultView: string | undefined,
  pinnedView?: string,
  opts?: ViewModelOptions,
): ViewModelCore<T> {
  const draftsOn = opts?.drafts === true;
  const canonical = opts?.canonical;
  const locked = opts?.locked ?? NO_LOCKED;
  if (locked.length > 0 && !draftsOn) {
    throw new Error(
      `view-core(${storageKey}): locked views need drafts — an edit to one can only be a working copy`,
    );
  }
  // Config is the single source of truth — no synthesized defaults. The instance
  // list comes only from the authored config rows (terse `{ name, view }`,
  // normalized on read). The addable-types menu (`availableSources`, below) is
  // derived straight from each entry's contributions — that is "what view-types
  // exist per source", not "default instances".
  const cfg = useViewsConfig(storageKey, descriptorMap, entries);
  const active = useActiveViewId(storageKey);
  const surfaceDrafts = useSurfaceDrafts(storageKey);
  const url = opts?.activeViewUrl ?? null;
  const urlValue = url?.value;
  const setUrl = url?.set;
  // Under drafts the value is an address (`<id>[~<draft>]`); without, the id.
  const urlAddress = useMemo(
    () =>
      urlValue === undefined
        ? undefined
        : draftsOn
          ? parseViewAddress(urlValue)
          : ({ viewId: urlValue, draft: { kind: "none" } } as const),
    [urlValue, draftsOn],
  );
  const urlViewId = urlAddress?.viewId;

  // The surface's working copies — the tab's shared map (every mount of this
  // surface reads the same one), or none without drafts.
  const drafted = useDraftMap(surfaceDrafts, draftsOn);

  // The host's locked views, resolved like config rows (fail-soft), listed
  // ahead of the config's own.
  const lockedById = useMemo(
    () => new Map(locked.map((row) => [row.id, row])),
    [locked],
  );
  const lockedInstances = useMemo(
    () =>
      new Map(
        locked
          .map((row) => buildLockedInstance(row, entries))
          .filter((r): r is ResolvedViewInstance<T> => r !== null)
          .map((r) => [r.instance.id, r]),
      ),
    [locked, entries],
  );
  // Where each locked view sits: at its PLACEHOLDER — a config row of its id,
  // which holds only its position (the view is the host's) — else at the head,
  // in the host's order. Reordering a head view writes its placeholder, so a
  // locked view's place is the config's like any view's.
  // A placeholder whose locked view the host no longer defines (a label
  // since deleted) is dropped — never shown as the bare `{ type }` it holds.
  const { saved, head } = useMemo(() => {
    const own = (cfg.instances as ResolvedViewInstance<T>[]).flatMap((r) => {
      const lockedOne = lockedInstances.get(r.instance.id);
      if (lockedOne !== undefined) return [lockedOne];
      return isPlaceholder(r.instance.options) ? [] : [r];
    });
    const placed = new Set(own.map((r) => r.instance.id));
    const head = [...lockedInstances.values()].filter(
      (r) => !placed.has(r.instance.id),
    );
    return { saved: head.length === 0 ? own : [...head, ...own], head };
  }, [cfg.instances, lockedInstances]);
  const headCount = head.length;

  // A drafted view renders its working copy: its instance is rebuilt from the
  // copy (so a drafted option or type change shows), every other one is the
  // config's own (identity kept).
  const instances = useMemo(() => {
    if (drafted === NO_DRAFTS || Object.keys(drafted).length === 0) {
      return saved;
    }
    return saved.map((r) => {
      const draft = drafted[r.instance.id];
      if (draft === undefined) return r;
      const { instance } = r;
      const lockedRow = lockedById.get(instance.id);
      if (lockedRow !== undefined) {
        return buildLockedInstance({ ...lockedRow, view: draft }, entries) ?? r;
      }
      return (
        buildInstanceFromRow(
          {
            id: instance.id,
            name: instance.name,
            ...(instance.pickedIcon !== null
              ? { icon: instance.pickedIcon }
              : {}),
            view: draft,
            ...(instance.source !== undefined
              ? { source: instance.source }
              : {}),
          },
          entries,
        ) ?? r
      );
    });
  }, [saved, drafted, entries, lockedById]);

  const cfgViewFor = cfg.viewFor;
  const savedViewFor = useCallback(
    (id: string): VariantValue | undefined =>
      lockedById.get(id)?.view ?? cfgViewFor(id),
    [lockedById, cfgViewFor],
  );
  const assertNotLocked = useCallback(
    (id: string, what: string) => {
      if (lockedById.has(id)) {
        throw new Error(
          `view-core(${storageKey}): the locked view "${id}" cannot be ${what} — save a copy instead`,
        );
      }
    },
    [lockedById, storageKey],
  );
  const viewFor = useCallback(
    (id: string): VariantValue | undefined => {
      const saved = savedViewFor(id);
      return saved === undefined ? undefined : (drafted[id] ?? saved);
    },
    [savedViewFor, drafted],
  );

  // Set (or, with `null`, drop) one view's working copy against the tab's
  // CURRENT map — not this render's — so two writes in one tick compose.
  const setDraft = useCallback(
    (id: string, view: VariantValue | null) => {
      const current = surfaceDrafts.read();
      const next = withDraft(current, id, view);
      if (next !== current) surfaceDrafts.write(next);
    },
    [surfaceDrafts],
  );

  // A drafted write: over the working copy (else the saved value), dropped
  // when it lands back on the saved value. Without drafts, the config's own.
  const { updateView: saveView } = cfg;
  const updateView = useCallback(
    (id: string, view: VariantValue, o?: { merge?: boolean }) => {
      if (!draftsOn) {
        saveView(id, view, o);
        return;
      }
      const saved = savedViewFor(id);
      if (saved === undefined) return;
      const base = surfaceDrafts.read()[id] ?? saved;
      const next = cleanView(o?.merge ? { ...base, ...view } : view);
      setDraft(id, sameView(next, saved, canonical) ? null : next);
    },
    [draftsOn, saveView, savedViewFor, surfaceDrafts, setDraft, canonical],
  );

  const deriveDirty = useCallback(
    (draft: VariantValue | undefined, saved: VariantValue | undefined) =>
      draft !== undefined &&
      saved !== undefined &&
      !sameView(draft, saved, canonical),
    [canonical],
  );
  const dirtyFor = useViewGetter(
    useCallback(
      (id: string) => [drafted[id], savedViewFor(id)] as const,
      [drafted, savedViewFor],
    ),
    deriveDirty,
  );

  const activeId = resolveActiveId(instances, {
    fromUrl: urlViewId,
    persisted: active.activeViewId,
    defaultView,
    pinned: pinnedView,
  });
  // What the surface shows with nothing picked anywhere — the URL omits it.
  const staticDefault = resolveActiveId(instances, {
    fromUrl: undefined,
    persisted: null,
    defaultView,
    pinned: undefined,
  });

  // A view the URL opened becomes this device's selection too: should the
  // address later stop naming it (a link opened beside it), the surface keeps
  // showing it rather than jumping back to the previous device-local pick.
  // Edge-triggered on the URL's value, never level-triggered: a pick writes
  // the store and the URL together, but the address can reach this hook a
  // render later than the store. Level-triggered, that render (the URL still
  // naming the previous view, the store the new one) persisted the previous
  // view back over the pick — and a pick of the static default, which leaves
  // the URL empty, then resolved to that stale view for good.
  const { activeViewId: persistedId, setActiveView: persist } = active;
  const adoptedUrlViewId = useRef<string | undefined | null>(null);
  useEffect(() => {
    if (activeId === "" || urlViewId === adoptedUrlViewId.current) return;
    adoptedUrlViewId.current = urlViewId;
    if (activeId === urlViewId && persistedId !== activeId) persist(activeId);
  }, [activeId, urlViewId, persistedId, persist]);

  // What the URL says for `id` on screen: `activeViewUrlValue`, and under
  // drafts the view's CURRENT working copy with it (read from the store, not
  // this render's map, so a copy seeded in this commit is included). A drafted
  // default view is named, so its copy has somewhere to live.
  const urlValueFor = useCallback(
    (id: string): string | undefined => {
      const draft = draftsOn ? surfaceDrafts.read()[id] : undefined;
      if (draft === undefined) return activeViewUrlValue(id, staticDefault);
      return encodeViewAddress(id, draft);
    },
    [draftsOn, surfaceDrafts, staticDefault],
  );

  // The URL values this surface wrote itself (the last few — a burst of
  // edits can write several before the address shows the first), and the one
  // it last read: only a value that is neither is news from outside. A value
  // of ours the address still shows a render after a newer write is never
  // re-read as news, so it cannot revert that write.
  const wroteUrl = useRef<(string | undefined)[]>([]);
  const seenUrl = useRef<string | undefined | null>(null);
  const writeUrl = useCallback(
    (value: string | undefined) => {
      wroteUrl.current = [
        ...wroteUrl.current.slice(-(RECENT_WRITES - 1)),
        value,
      ];
      setUrl?.(value);
    },
    [setUrl],
  );

  // Under drafts the URL is the truth for its view's working copy when it
  // changes from outside (a link opened, back/forward, F5): its draft becomes
  // the copy, and naming the view with no draft drops the copy. Waits for the
  // config — the copy is compared with, and only kept for, a saved view.
  // Declared before the derived-URL effect, so that effect, in the same
  // commit, writes the seeded copy back in its canonical spelling.
  useEffect(() => {
    if (!draftsOn || setUrl === undefined || !cfg.ready) return;
    if (urlValue === seenUrl.current) return;
    seenUrl.current = urlValue;
    if (wroteUrl.current.includes(urlValue) || urlAddress === undefined) return;
    const { viewId, draft } = urlAddress;
    const saved = savedViewFor(viewId);
    // An unknown view: the derived-URL effect rewrites the address.
    if (saved === undefined) return;
    // A draft part that does not decode (a hand-edited or truncated link) is
    // not a draft: the view keeps whatever copy it has, and the derived-URL
    // effect rewrites the address to what is on screen.
    if (draft.kind === "malformed") return;
    const current = surfaceDrafts.read()[viewId];
    if (draft.kind === "none") {
      if (current !== undefined) setDraft(viewId, null);
      return;
    }
    if (current !== undefined && sameView(current, draft.view, undefined)) {
      return;
    }
    setDraft(
      viewId,
      sameView(draft.view, saved, canonical) ? null : cleanView(draft.view),
    );
  }, [
    draftsOn,
    setUrl,
    cfg.ready,
    urlValue,
    urlAddress,
    savedViewFor,
    surfaceDrafts,
    setDraft,
    canonical,
  ]);

  // The URL is derived from the active view: once the instances are known,
  // whatever is on screen is what the address says (`urlValueFor`). So a view
  // restored from this device is stamped in, a stale or unknown id is
  // rewritten to the view actually shown, the default leaves no key — and
  // under drafts every edit to the active view's copy is written in.
  useEffect(() => {
    if (setUrl === undefined || activeId === "") return;
    const desired = urlValueFor(activeId);
    if (urlValue !== desired) writeUrl(desired);
    // `drafted`: `urlValueFor` reads the store, so a write to a copy must
    // re-run this effect.
  }, [setUrl, activeId, urlValueFor, urlValue, writeUrl, drafted]);

  // Selecting a view writes the device's store and — by the same rule — the
  // URL, in one batch. The URL outranks the store, so a pick that left it
  // naming the previous view would resolve straight back to it.
  const setActiveView = useCallback(
    (id: string) => {
      persist(id);
      if (setUrl !== undefined) writeUrl(urlValueFor(id));
    },
    [persist, setUrl, writeUrl, urlValueFor],
  );

  // Capability-gated add menu, grouped per source entry: each group is that
  // entry's registered contributions ∩ `views` whitelist (if present). The `views` whitelist gates ADDABILITY only — authored
  // rows of a non-whitelisted type still resolve (see `buildInstanceFromRow`).
  // Generic — driven by the entries, never by a named view child.
  const availableSources = useMemo<AddableSource[]>(() => {
    return entries.map((entry) => {
      const types = usableTypes(entry).map<AddableViewType>((c) => ({
        type: c.type,
        title: c.title,
        icon: c.icon,
      }));
      return {
        sourceId: entry.id,
        title: entry.title,
        icon: entry.icon,
        types,
      };
    });
  }, [entries]);

  // The settings popover's type list, derived per instance from that instance's
  // OWN source entry through the same `usableTypes` gate the add menu uses.
  // The instance's current type is always listed even when the entry's `views`
  // whitelist excludes it: the whitelist gates addability, not authored rows
  // (`buildInstanceFromRow` renders them), so the picker must be able to show
  // the value it is bound to. Its inputs are the instance's source entry (from
  // the caller's stable `entries`) and resolved `viewType` (the registered
  // contribution — it changes exactly when the view's type does), so a rename
  // or an options edit hands back the same Map.
  const variantsFor = useViewGetter(
    useCallback(
      (id: string) => {
        const resolved = instances.find((r) => r.instance.id === id);
        return [
          resolved && entries.find((e) => e.id === resolved.instance.source),
          resolved?.viewType,
        ] as const;
      },
      [instances, entries],
    ),
    deriveVariants,
  );

  // Adding or duplicating a view makes the new view the active one — every
  // surface that creates a view (the strip's `+`, the chip's "Add view", the
  // settings popover's Duplicate) lands on it, rather than each caller having
  // to remember to select the id it gets back.
  const actions = useMemo<ViewActionsCore>(
    () => ({
      availableSources,
      variantsFor,
      addView: (type, sourceId) => {
        setActiveView(cfg.addView(type, sourceId));
      },
      renameView: (id, name) => {
        assertNotLocked(id, "renamed");
        cfg.renameView(id, name);
      },
      setViewIcon: (id, icon) => {
        assertNotLocked(id, "given an icon");
        cfg.setViewIcon(id, icon);
      },
      duplicateView: (id) => {
        // What you see is what you copy: a drafted view's working copy.
        const draft = draftsOn ? surfaceDrafts.read()[id] : undefined;
        const lockedRow = lockedById.get(id);
        if (lockedRow !== undefined) {
          setActiveView(
            cfg.insertView(
              lockedCopy(lockedRow, {
                name: `${lockedRow.name} copy`,
                view: draft ?? lockedRow.view,
              }),
            ),
          );
          return;
        }
        setActiveView(
          cfg.duplicateView(
            id,
            draft === undefined ? undefined : { view: draft },
          ),
        );
      },
      deleteView: (id) => {
        assertNotLocked(id, "deleted");
        cfg.deleteView(id);
        if (draftsOn) setDraft(id, null);
      },
      // `toIndex` is the view's final position in `instances`, whose head is
      // the locked views without a placeholder: the config's order starts
      // after them. A head view moved gets its placeholder at that place.
      reorderView: (id, toIndex) => {
        const touchesHead =
          head.some((r) => r.instance.id === id) || toIndex < headCount;
        if (!touchesHead) {
          cfg.reorderView(id, toIndex - headCount);
          return;
        }
        // The head's order becomes the config's first: a placeholder for each
        // head view, where it stands — then an ordinary move, on positions
        // that are the config's own.
        head.forEach((r, at) => {
          const row = lockedById.get(r.instance.id)!;
          cfg.insertView(placeholderOf(row), { id: row.id, at });
        });
        cfg.reorderView(id, toIndex);
      },
      updateView,
    }),
    [
      availableSources,
      variantsFor,
      cfg,
      setActiveView,
      draftsOn,
      surfaceDrafts,
      setDraft,
      updateView,
      assertNotLocked,
      lockedById,
      head,
      headCount,
    ],
  );

  const drafts = useMemo<ViewDrafts | null>(
    () =>
      draftsOn
        ? {
            save: (id) => {
              assertNotLocked(id, "saved over");
              const draft = surfaceDrafts.read()[id];
              if (draft === undefined) return;
              saveView(id, draft);
              setDraft(id, null);
            },
            discard: (id) => {
              const draft = surfaceDrafts.read()[id] ?? null;
              setDraft(id, null);
              return draft;
            },
            restore: (id, view) => {
              const saved = savedViewFor(id);
              if (saved === undefined) return;
              setDraft(id, sameView(view, saved, canonical) ? null : view);
            },
            saveAsNew: (id, row) => {
              const view = surfaceDrafts.read()[id] ?? savedViewFor(id);
              if (view === undefined) {
                throw new Error(
                  `view-core(${storageKey}): saveAsNew("${id}") names no view`,
                );
              }
              const lockedRow = lockedById.get(id);
              const newId =
                lockedRow !== undefined
                  ? cfg.insertView(
                      lockedCopy(lockedRow, {
                        name: row.name,
                        view,
                        ...(row.icon !== undefined ? { icon: row.icon } : {}),
                      }),
                    )
                  : cfg.duplicateView(id, {
                      name: row.name,
                      ...(row.icon !== undefined ? { icon: row.icon } : {}),
                      view,
                    });
              setDraft(id, null);
              setActiveView(newId);
              return newId;
            },
          }
        : null,
    [
      draftsOn,
      storageKey,
      surfaceDrafts,
      saveView,
      setDraft,
      savedViewFor,
      canonical,
      cfg,
      setActiveView,
      assertNotLocked,
      lockedById,
    ],
  );

  return useMemo(
    () => ({
      ready: cfg.ready,
      failure: cfg.failure,
      instances,
      activeId,
      setActiveView,
      viewFor,
      savedViewFor,
      dirtyFor,
      updateView,
      drafts,
      actions,
      availableSources,
    }),
    [
      cfg.ready,
      cfg.failure,
      instances,
      activeId,
      setActiveView,
      viewFor,
      savedViewFor,
      dirtyFor,
      updateView,
      drafts,
      actions,
      availableSources,
    ],
  );
}

/**
 * One instance's type-switcher registry from its source `entry` and resolved
 * `viewType` (both `undefined` for an unknown id → an empty Map). Module-level
 * so `useViewGetter` re-runs it only when one of the two changes identity.
 */
function deriveVariants<T extends ViewTypeMeta>(
  entry: ViewSourceEntry<T> | undefined,
  viewType: SealContributions<T> | undefined,
): Map<string, VariantEntry> {
  if (!viewType) return new Map();
  const usable = entry ? usableTypes(entry) : [];
  const listed = usable.some((c) => c.type === viewType.type)
    ? usable
    : [...usable, viewType];
  return new Map(
    listed.map((c) => [
      c.type,
      { label: c.title, fields: c.configSchema ?? {} },
    ]),
  );
}

/** The key a placeholder row's `view` carries, so one whose locked view is
 *  gone is known for what it is. */
const PLACEHOLDER = "lockedPlaceholder";

/** A locked view's placeholder row: its place in the config, nothing else. */
function placeholderOf(row: LockedViewRow) {
  return {
    name: row.name,
    view: { type: row.view.type, [PLACEHOLDER]: true } as VariantValue,
    ...(row.source !== undefined ? { source: row.source } : {}),
  };
}

function isPlaceholder(options: unknown): boolean {
  return (
    typeof options === "object" &&
    options !== null &&
    (options as Record<string, unknown>)[PLACEHOLDER] === true
  );
}

/** A config row made from a locked view: its source, `over`'s name, view and
 *  icon. Its own icon (code's, not a saved pick) and colour stay behind — a
 *  config row carries neither. */
function lockedCopy(
  row: LockedViewRow,
  over: { name: string; view: VariantValue; icon?: SavedSymbolName },
) {
  const icon = over.icon;
  return {
    name: over.name,
    ...(icon !== undefined ? { icon } : {}),
    view: over.view,
    ...(row.source !== undefined ? { source: row.source } : {}),
  };
}
