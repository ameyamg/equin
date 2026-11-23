/** The transpose range — a full octave each way (the endpoint's clamp). */
const MAX_SEMITONES = 12;
const SEMITONES = /^[+-]?\d{1,2}$/;

/**
 * A song's transpose as its link spells it (`;transpose=`): the signed
 * semitone offset (`3`, `-2`). The original key (`0`) is spelt by no value at
 * all — a song created from the link plays in it anyway.
 */
export function encodeTransposeLink(semitones: number): string | null {
  return semitones === 0 ? null : String(semitones);
}

/** A link value as an offset — `null` for one that is not one in range. */
export function decodeTransposeLink(value: string): number | null {
  if (!SEMITONES.test(value)) return null;
  const semitones = Number(value);
  return Math.abs(semitones) > MAX_SEMITONES ? null : semitones;
}
