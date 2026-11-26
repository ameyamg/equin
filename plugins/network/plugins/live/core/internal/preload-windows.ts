import { tupleKey } from "./compile-value";
import type {
  LiveDecodedQuery,
  LiveOrderBy,
  LiveQuery,
  LiveWhere,
  LiveWindowParams,
} from "./query";

// App-scoped window preloads — `serveCollection(c, { preloadWindows })`.
//
// A collection's `preload: "boot"` ships ONE tuple, its unfiltered default
// window, on EVERY page load of every app. What an app's first frame reads is
// usually another window (Mail's Inbox, not "every thread"), and only that
// app's boot should pay for it. `preloadWindows` names those windows; the app
// is the one the SERVING plugin lies in (`apps/plugins/<app>/` — Mail's cache
// serves Mail's threads), never a name to get wrong: the boot snapshot of a
// page booting that app (and only that one) carries page 0 of each, encoded exactly as
// the reader's own page 0 (`codec.encode({ where, orderBy, limit: step })`,
// the tuple `useLive(c, q, { viewport })` and `useLive(c, q)` both subscribe
// first), so the app paints with its rows.
//
// The answer is what the server ALREADY holds, never a wait on a third party:
// a table-backed collection's compiled read (Postgres is its truth), an
// external one's `held(q)` (its cache: `{ held: false }` when it does not
// cover the window — the tuple is then absent and its reader loads it as
// without a preload). Never L2-persisted, never pinned eager, no `preload`
// flag: the key's default tuple is not preloaded by this.

/** One window a collection preloads: a reader's query, without a limit (page 0 is at the collection's step). */
export interface LivePreloadWindow<F, S extends string> {
  where?: LiveWhere<F>;
  orderBy?: LiveOrderBy<S>;
}

/** Where `preloadWindows`' answers come from — a table-backed collection's. */
export interface LivePreloadWindows<F, S extends string> {
  /** The windows, each exactly as its reader asks it (one per view the app may open on). */
  windows: () =>
    | Promise<readonly LivePreloadWindow<F, S>[]>
    | readonly LivePreloadWindow<F, S>[];
}

/** An external source's cache-only answer to one window: its rows, or that it does not hold them. */
export type LiveHeldWindow<Row> =
  { held: true; rows: readonly Row[] } | { held: false };

/** An external collection's `preloadWindows`: the windows, and the source's cache-only answer. */
export interface LiveExternalPreloadWindows<
  Row,
  F,
  S extends string,
> extends LivePreloadWindows<F, S> {
  /**
   * The window `q` asks for, from what the source already holds — answered
   * like `window(q)` (filtered, ordered, cut, ≤ `q.limit`), but never reaching
   * past the source's own store (no provider call, no wait): `{ held: false }`
   * when it does not cover the window whole.
   */
  held: (
    q: LiveDecodedQuery<S>,
  ) => Promise<LiveHeldWindow<Row>> | LiveHeldWindow<Row>;
}

/** One preloaded tuple, loaded or failed (each settles on its own). */
export type LivePreloadedTuple =
  | { params: LiveWindowParams; ok: true; value: unknown }
  /** Failed: its tuple, or — a window that did not encode — `{ window }`, the window as asked. */
  | { params: Record<string, string>; ok: false; error: unknown };

/** The codec half a window preload encodes through. */
interface PreloadCodec {
  defaultLimit: number;
  encode: (query?: LiveQuery<never, string, never>) => LiveWindowParams;
  clockQuantum: (query: {
    where?: object;
    orderBy?: LiveOrderBy<string>;
  }) => number | null;
}

const WINDOW_KEYS: ReadonlySet<string> = new Set(["where", "orderBy"]);

/**
 * The app preload of a window collection's `preloadWindows`: the loader of
 * its tuples, each answered by `answer` (a
 * table-backed window's load, an external one's `held`). Checks the spec at
 * serve time (`where` prefixes every error); each window is checked when
 * loaded — one that names a key other than `where` / `orderBy`, or a clock
 * field (its tuple pins a reader's `now`, which the server cannot know), fails
 * its tuple alone.
 */
export function windowAppPreload(
  where: string,
  codec: PreloadCodec,
  spec: { windows?: unknown },
  answer: (
    params: LiveWindowParams,
  ) => Promise<{ held: true; value: unknown } | { held: false }>,
): { tuples: () => Promise<LivePreloadedTuple[]> } {
  const fail = (message: string): never => {
    throw new Error(`${where}: preloadWindows: ${message}`);
  };
  const { windows } = spec;
  if (typeof windows !== "function") {
    fail("`windows` must be a function returning the windows to preload.");
  }
  const list = windows as () => unknown;
  return {
    tuples: async () => {
      const asked = await list();
      if (!Array.isArray(asked)) {
        fail(`\`windows()\` returned ${typeof asked}, not a list of windows.`);
      }
      const out: LivePreloadedTuple[] = [];
      const seen = new Set<string>();
      for (const w of asked as unknown[]) {
        let params: LiveWindowParams | undefined;
        try {
          const query = checkedWindow(w);
          params = codec.encode({
            ...(query as LiveQuery<never, string, never>),
            limit: codec.defaultLimit,
          });
          const k = tupleKey(params);
          if (seen.has(k)) continue;
          seen.add(k);
          const answered = await answer(params);
          if (answered.held) {
            out.push({ params, ok: true, value: answered.value });
          }
        } catch (error) {
          out.push({
            params: params ?? { window: JSON.stringify(w) },
            ok: false,
            error,
          });
        }
      }
      return out;
    },
  };

  function checkedWindow(w: unknown): LivePreloadWindow<never, string> {
    if (typeof w !== "object" || w === null || Array.isArray(w)) {
      return fail(
        `a window is ${JSON.stringify(w)}, not { where?, orderBy? }.`,
      );
    }
    const stray = Object.keys(w).filter((k) => !WINDOW_KEYS.has(k));
    if (stray.length > 0) {
      fail(
        `a window names ${stray.map((k) => `\`${k}\``).join(", ")} — a preloaded window is a reader's \`where\` / \`orderBy\` only (page 0 is at the collection's step).`,
      );
    }
    const query = w as LivePreloadWindow<never, string>;
    if (codec.clockQuantum(query as { where?: object }) !== null) {
      fail(
        "a window names a clock field — its tuple pins the reader's `now`, which the boot snapshot cannot know.",
      );
    }
    return query;
  }
}
