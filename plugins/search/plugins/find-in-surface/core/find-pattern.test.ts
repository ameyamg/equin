import { describe, expect, test } from "bun:test";
import { findPattern } from "./find-pattern";

const plain = { matchCase: false, wholeWord: false };
const count = (q: string, text: string, opts = plain) =>
  [...text.matchAll(findPattern(q, opts)!)].length;

describe("findPattern", () => {
  test("an empty or blank query finds nothing", () => {
    expect(findPattern("", plain)).toBeNull();
    expect(findPattern("  \t", plain)).toBeNull();
  });

  test("case is ignored unless asked for", () => {
    expect(count("chord", "Chord chord CHORD")).toBe(3);
    expect(
      count("chord", "Chord chord CHORD", { ...plain, matchCase: true }),
    ).toBe(1);
  });

  test("whole word refuses a match inside a longer word", () => {
    const opts = { ...plain, wholeWord: true };
    expect(count("chord", "chord chords chord_x (chord)", opts)).toBe(2);
    expect(count("été", "un été étés", opts)).toBe(1);
  });

  test("regex characters are literal", () => {
    expect(count("a.b (c)", "a.b (c) axb (c)")).toBe(1);
  });

  test("a line break in the query matches only a line break", () => {
    const text = "Chord training mode\nListen to a song";
    expect(count("Chord training mode\nListen", text)).toBe(1);
    expect(count("  Chord training mode  \n   Listen ", text)).toBe(1);
    expect(count("mode Listen", text)).toBe(0);
    expect(count("Chord\ntraining", text)).toBe(0);
  });

  test("a trailing line break matches the end of a line", () => {
    expect(count("mode\n", "training mode\nnext")).toBe(1);
    expect(count("mode\n", "training mode")).toBe(0);
  });

  test("spaces match any run of spaces on one line", () => {
    expect(count("a  b", "a b")).toBe(1);
    expect(count("a b", "a    b")).toBe(1);
  });
});
