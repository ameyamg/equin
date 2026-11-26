import type { z } from "zod";
import { ResourceRefusal } from "@plugins/network/plugins/live/plugins/resource-protocol/core";

// A declaration's typed refusals — the expected, caller-caused answers "this
// cannot be answered as asked" its loader may give instead of a value — shared
// by `liveValue` (every form) and `liveCollection` (window, lookup-only and
// `all` forms): one spelling, one check, one `refuse`.

/**
 * The refusal codes a declaration declares — the expected, caller-caused
 * answers "this cannot be answered as asked" its loader may give instead of
 * a value or rows (`ResourceRefusal`): a zod enum (`z.enum(["missing",
 * "denied"])`) or the same codes as a const list (`["missing", "denied",
 * "too-large"]`). The loader throws one through the declaration's typed
 * `refuse(code, message)`; a reader's `useLive` error arm is `kind:
 * "refused"` with `code` typed by this list. Both ends check it: the runtime
 * turns a refusal with an undeclared code into a server failure, and the
 * client reads one as a contract mismatch (its bundle does not know the
 * code).
 */
export type LiveRefusals<C extends string> =
  z.ZodEnum<{ [K in C]: K }> | readonly [C, ...C[]];

/** The `refusals` field every `liveValue` form and `liveCollection` form but a union takes (see {@link LiveRefusals}). */
export interface LiveRefusalsSpec<C extends string> {
  refusals?: LiveRefusals<C>;
}

/**
 * What a declaration's refusals add to it: the codes (read by the runtime
 * and the client, on every descriptor it mints) and `refuse(code, message)` —
 * the `ResourceRefusal` to throw from the loader, its code typed by the
 * declaration (`throw fileText.refuse("missing", "no such file")`). A
 * declaration that declares none has neither, so it cannot be refused (tsc).
 */
export type LiveRefusalsBrand<C extends string> = [C] extends [never]
  ? { refusals?: undefined; refuse?: undefined }
  : {
      refusals: readonly C[];
      /** The refusal to throw from the loader — `code` one of the declared ones. */
      refuse(code: C, message: string): ResourceRefusal;
    };

/**
 * The fields declared `refusals` set: the codes, as a list (a zod enum's
 * `options`), and `refuse` — the `ResourceRefusal` a loader throws, refusing
 * an undeclared code at the throw site for an untyped caller (the runtime
 * would turn it into a server failure anyway). Throws on a declaration tsc
 * cannot reject: an empty list, an empty code, a duplicate. `where` names
 * the declaration in messages (`liveValue("x")`).
 */
export function refusalFields(
  where: string,
  refusals: LiveRefusals<string> | undefined,
): {
  refusals?: readonly string[];
  refuse?: (code: string, message: string) => ResourceRefusal;
} {
  if (refusals === undefined) return {};
  const codes: readonly string[] = Array.isArray(refusals)
    ? [...(refusals as readonly string[])]
    : (refusals as z.ZodEnum<Record<string, string>>).options;
  if (
    codes.length === 0 ||
    codes.some((c) => typeof c !== "string" || c === "") ||
    new Set(codes).size !== codes.length
  ) {
    throw new Error(
      `${where}: bad \`refusals\` ${JSON.stringify(codes)} — a ` +
        `non-empty list of unique, non-empty codes (or omit it).`,
    );
  }
  return {
    refusals: codes,
    refuse: (code, message) => {
      if (!codes.includes(code)) {
        throw new Error(
          `${where}.refuse: "${code}" is not a declared refusal ` +
            `(${JSON.stringify(codes)}).`,
        );
      }
      return new ResourceRefusal(code, message);
    },
  };
}
