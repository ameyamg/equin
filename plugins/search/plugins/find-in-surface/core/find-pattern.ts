/** How a query is matched. */
export interface FindOptions {
  /** Upper and lower case are different letters. */
  matchCase: boolean;
  /** A match may not sit inside a longer word. */
  wholeWord: boolean;
}

const REGEX_SPECIAL = /[.*+?^${}()|[\]\\]/g;

/**
 * The query as the regular expression that finds it in a region's text
 * (`regionText`'s output), or `null` for a query with nothing to find.
 *
 * A line break in the query matches a line break in the text — a block
 * boundary or a `<br>`, never a space — with any indentation around it. Any
 * other run of spaces matches any run of spaces on the same line. So a query
 * pasted from the page finds the passage it was copied from, and
 * `Chord training` does not match across two lines.
 */
export function findPattern(
  query: string,
  options: FindOptions,
): RegExp | null {
  const trimmed = query.replace(/^[ \t]+|[ \t]+$/g, "");
  if (trimmed === "") return null;
  const lines = trimmed.split(/[ \t]*\r?\n[ \t]*/).map((line) =>
    line
      .split(/[ \t]+/)
      .map((word) => word.replace(REGEX_SPECIAL, "\\$&"))
      .join("[^\\S\\n]+"),
  );
  const body = lines.join("[^\\S\\n]*\\n\\s*");
  const source = options.wholeWord
    ? `(?<![\\p{L}\\p{N}_])${body}(?![\\p{L}\\p{N}_])`
    : body;
  return new RegExp(source, options.matchCase ? "gu" : "giu");
}
