// A `git grep -E` pattern means what POSIX ERE says, and nothing more.
//
// `git grep -E` hands its pattern to the system regex library. glibc adds GNU
// escapes (`\b`, `\B`, `\s`, `\S`, `\w`, `\W`, `\<`, `\>`, `` \` ``, `\'`);
// macOS's library does not — there `\b` is a literal `b`, so a pre-filter
// using one selects NO file and the check behind it passes without looking
// (no-use-resource-cast did, 2026-11: a cast failed main's build on Linux and
// passed on every Mac). POSIX leaves a backslash before an ordinary character
// undefined, so the portable subset is: a backslash only ever escapes a
// punctuation character (`\.`, `\(`, `\[`, `\\`, `\|`, …).
//
// The pre-filter choke point (`grep-code.ts`) refuses anything else, on every
// OS — so a pattern that would be vacuous on one platform fails loudly on all
// of them, including a pattern a helper builds at runtime. Spell a word
// boundary as a character class (`(^|[^A-Za-z0-9_])name`), whitespace as
// `[[:space:]]`, a word character as `[[:alnum:]_]`.
//
// The grep index (`grep-index.ts`) keys its recorded answers by the pattern
// and `git --version` (which names the Apple build): with every pattern in the
// portable subset, an answer does not depend on which libc ran it either.

/** A non-fixed `git grep` pattern outside portable POSIX ERE. */
export class NonPortableGrepPatternError extends Error {
  constructor(
    readonly grepArg: string,
    readonly escape: string,
  ) {
    super(
      `grepArg ${JSON.stringify(grepArg)} uses \`${escape}\`, which POSIX ERE does not define: ` +
        "macOS's `git grep -E` matches nothing with it, so the pre-filter would select no file. " +
        "Spell it portably: a word boundary as `(^|[^A-Za-z0-9_])`, whitespace as `[[:space:]]`, " +
        "a word character as `[[:alnum:]_]`, a digit as `[0-9]`.",
    );
    this.name = "NonPortableGrepPatternError";
  }
}

/**
 * Throws {@link NonPortableGrepPatternError} unless every backslash in
 * `grepArg` escapes a punctuation character. `\\` is one escaped backslash,
 * so `\\b` (a backslash, then `b`) is allowed.
 */
export function assertPortableEre(grepArg: string): void {
  for (let i = 0; i < grepArg.length; i++) {
    if (grepArg[i] !== "\\") continue;
    const next = grepArg[i + 1];
    if (next === undefined)
      throw new NonPortableGrepPatternError(grepArg, "\\ (trailing)");
    if (!/[!-/:-@[-`{-~]/.test(next) || /[<>`']/.test(next))
      throw new NonPortableGrepPatternError(grepArg, `\\${next}`);
    i++;
  }
}
