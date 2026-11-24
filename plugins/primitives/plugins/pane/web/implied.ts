// ---------------------------------------------------------------------------
// Implied params — a pane's OWN param whose URL spelling is shortened (or
// omitted) where the column to its left already says it.
//
// A pane reads only its own params, so its state is always complete: the
// satellite of a conversation carries the conversation it is about, the file
// preview its whole path. What position implies is only a URL matter — the
// writer (`buildRouteUrl`) spells such a param against the nearest column of
// its `from` pane to the LEFT, and the reader (`parseUrl`) expands the
// spelling against the same column. One codec, both directions, and the
// writer asserts `expand(shorten(v)) === v` on every URL it writes, so a codec
// can never write a URL that reads back as something else.
// ---------------------------------------------------------------------------

import type { RouteDef, RouteParams } from "../core";

/**
 * The two directions of one implied param, over strings. `From` is what the
 * codec reads of the from-column: its OWN params (the names in `fromParams`).
 *
 * - `shorten(value, from)` — the URL spelling of `value` beside `from`;
 *   `undefined` omits the param (only legal where the URL may lack it: a keyed
 *   `;name` or an optional `:name?` — declare `omits: true`).
 * - `expand(written, from)` — the value a spelling names, `from` being the
 *   nearest from-column to the left, or `undefined` when there is none.
 *   `undefined` = cannot be determined: a required param then fails the
 *   parse (the URL is not this route), an optional one is absent.
 */
export interface ImpliedCodec<FromKey extends string = string> {
  /** The from-column's params the codec reads — checked against its segment at registry sync. */
  readonly fromParams: readonly FromKey[];
  /** Whether `shorten` can omit the param (return `undefined`). */
  readonly omits: boolean;
  shorten(
    value: string,
    from: Readonly<Partial<Record<FromKey, string>>>,
  ): string | undefined;
  expand(
    written: string | undefined,
    from: Readonly<Partial<Record<FromKey, string>>> | undefined,
  ): string | undefined;
}

/**
 * One `Pane.define({ implied: { <param>: … } })` entry, built by
 * {@link impliedBy}. `Optional` is the literal of `optional: true`: an implied
 * KEYED param is required in the pane's params type unless it says so.
 */
export interface ImpliedParam<Optional extends boolean = boolean> {
  /** The route whose nearest column to the LEFT implies the param. */
  readonly from: RouteDef<any, any>;
  readonly codec: ImpliedCodec;
  readonly optional: Optional;
}

/**
 * `param` is implied by the nearest `from` column to the left, through
 * `codec`. The codec's from-param names are checked against `from`'s own
 * segment by tsc. `{ optional: true }` keeps a keyed param optional in the
 * pane's params type (it is required otherwise — a satellite always says what
 * it is about).
 *
 * ```ts
 * implied: { conv: impliedBy(conversationRoute, sameAs("convId")) }
 * ```
 */
export function impliedBy<
  FromSeg extends string,
  K extends keyof RouteParams<FromSeg> & string,
>(from: RouteDef<any, FromSeg>, codec: ImpliedCodec<K>): ImpliedParam<false>;
export function impliedBy<
  FromSeg extends string,
  K extends keyof RouteParams<FromSeg> & string,
>(
  from: RouteDef<any, FromSeg>,
  codec: ImpliedCodec<K>,
  opts: { optional: true },
): ImpliedParam<true>;
// Overloads, not a defaulted `Optional` type parameter: inside
// `Pane.define({ implied })` the contextual type (`ImpliedParam<boolean>`)
// would infer it as `boolean`, and a required param would type as optional.
export function impliedBy(
  from: RouteDef<any, any>,
  codec: ImpliedCodec<string>,
  opts?: { optional: true },
): ImpliedParam {
  return {
    from,
    codec: codec as unknown as ImpliedCodec,
    optional: opts?.optional ?? false,
  };
}

/**
 * The value IS the from-column's `fromParam` when it equals it: omitted then
 * (`/c/conv-A/summary`), written otherwise (`/c/conv-B/summary;conv=conv-A`),
 * filled from the from-column when absent. Omits, so only for a keyed or
 * optional param.
 */
export function sameAs<K extends string>(fromParam: K): ImpliedCodec<K> {
  return {
    fromParams: [fromParam],
    omits: true,
    shorten: (value, from) => (from[fromParam] === value ? undefined : value),
    expand: (written, from) => written ?? from?.[fromParam],
  };
}

/**
 * The path algebra {@link relativeTo} is written over — passed in, so the
 * codec knows nothing of any one path syntax.
 */
export interface RelativeSpelling {
  /**
   * `value` spelled relative to `base`, or `undefined` when it is not inside
   * it. Never a spelling {@link isWhole} reads as whole, never `""`.
   */
  within(value: string, base: string): string | undefined;
  /** The value a relative spelling names under `base`. */
  join(base: string, relative: string): string;
  /**
   * Whether a written spelling is already the whole value — read as itself,
   * never joined (a path from the root: `/x`, `~`, `~/x`).
   */
  isWhole(written: string): boolean;
}

/**
 * The value written relative to the from-column's `fromParam` when it is
 * inside it (`/dir/~%2Fp/pv/README.md`), whole otherwise — and whole when no
 * from-column stands to the left. A whole value is recognised by its own
 * spelling (`isWhole`), so a URL needs no marker to say which it is. Never
 * omits.
 */
export function relativeTo<K extends string>(
  fromParam: K,
  spelling: RelativeSpelling,
): ImpliedCodec<K> {
  return {
    fromParams: [fromParam],
    omits: false,
    shorten: (value, from) => {
      const base = from[fromParam];
      if (base === undefined) return value;
      return spelling.within(value, base) ?? value;
    },
    expand: (written, from) => {
      if (written === undefined) return undefined;
      if (spelling.isWhole(written)) return written;
      const base = from?.[fromParam];
      return base === undefined ? undefined : spelling.join(base, written);
    },
  };
}

/**
 * The pane params type an `implied` declaration leaves: every implied param
 * that is not `optional: true` becomes required (a keyed `;name` is optional
 * by default).
 */
export type WithImplied<P, Implied> = [RequiredImplied<Implied>] extends [never]
  ? P
  : Simplify<
      Omit<P, RequiredImplied<Implied> & keyof P> & {
        [K in RequiredImplied<Implied> & keyof P]-?: string;
      }
    >;

type RequiredImplied<Implied> = {
  [K in keyof Implied]-?: Implied[K] extends ImpliedParam<false> ? K : never;
}[keyof Implied];

type Simplify<T> = { [K in keyof T]: T[K] } & {};
