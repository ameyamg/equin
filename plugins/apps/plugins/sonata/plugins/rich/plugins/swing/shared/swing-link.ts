import type {
  Swing,
  SwingOverride,
} from "@plugins/apps/plugins/sonata/plugins/score/core";
import { DEFAULT_SWING, MAX_SWING_RATIO, MIN_SWING_RATIO } from "../core";

/**
 * A song's swing override as its link spells it (`;swing=` on the player
 * route) — words a person can read, in characters a URL leaves unescaped:
 *
 *   8x2            swing 8ths at 2:1
 *   16x1.5         swing 16ths at 1.5:1
 *   straight.8x2   straight, turning swing back on plays 8ths at 2:1
 *
 * The song's own feel (`score`) is spelt by no value at all: a song created
 * from the link keeps its content's feel anyway.
 */
const STRAIGHT = "straight";
const FEEL = /^(8|16)x(\d+(?:\.\d+)?)$/;

/** `override` as its link value, or `null` for the song's own feel. */
export function encodeSwingLink(override: SwingOverride): string | null {
  switch (override.kind) {
    case "score":
      return null;
    case "straight":
      return `${STRAIGHT}.${encodeFeel(override.feel)}`;
    case "swing":
      return encodeFeel(override.swing);
  }
}

function encodeFeel(swing: Swing): string {
  // Three decimals read back as the same stop; a ratio is never finer.
  return `${swing.unit}x${Number(swing.ratio.toFixed(3))}`;
}

/** A link value as an override — `null` for one that is not a swing. */
export function decodeSwingLink(value: string): SwingOverride | null {
  if (value === STRAIGHT) return { kind: "straight", feel: DEFAULT_SWING };
  if (value.startsWith(`${STRAIGHT}.`)) {
    const feel = decodeFeel(value.slice(STRAIGHT.length + 1));
    return feel === null ? null : { kind: "straight", feel };
  }
  const swing = decodeFeel(value);
  return swing === null ? null : { kind: "swing", swing };
}

function decodeFeel(text: string): Swing | null {
  const match = FEEL.exec(text);
  if (match === null) return null;
  const ratio = Number(match[2]);
  if (ratio < MIN_SWING_RATIO || ratio > MAX_SWING_RATIO) return null;
  return { unit: match[1] === "16" ? 16 : 8, ratio };
}
