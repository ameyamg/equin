import { describe, expect, test } from "bun:test";
import {
  FIRE_CLICKS_FOR_FIREWORKS,
  FireClicks,
  firesideNight,
  fireStrength,
  flaring,
  nightOf,
  Marshmallow,
  seatAround,
  Storyteller,
} from "./campfire";

describe("fireStrength", () => {
  test("burns as usual through the day and the evening", () => {
    for (const h of [7, 9, 12, 17, 20, 23.9, 0])
      expect(fireStrength(h)).toBe(1);
  });
  test("burns low in the small hours", () => {
    for (const h of [1.5, 3, 5.4]) expect(fireStrength(h)).toBeLessThan(0.5);
  });
  test("flares up at dawn, then settles", () => {
    expect(flaring(fireStrength(6))).toBe(true);
    expect(flaring(fireStrength(6.9))).toBe(false);
    expect(fireStrength(6.9)).toBeGreaterThan(1);
  });
  test("never jumps", () => {
    for (let h = 0; h < 24; h += 0.01)
      expect(Math.abs(fireStrength(h + 0.01) - fireStrength(h))).toBeLessThan(
        0.1,
      );
  });
});

describe("FireClicks", () => {
  test("five clicks running set the fireworks off; a pause starts the count again", () => {
    const c = new FireClicks();
    const hits = (ts: number[]) => ts.map((t) => c.click(t));
    expect(hits([0, 0.5, 1, 1.5])).toEqual([false, false, false, false]);
    expect(c.click(2)).toBe(true);
    expect(hits([10, 10.5, 11, 11.5, 14])).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(FIRE_CLICKS_FOR_FIREWORKS).toBe(5);
  });
});

describe("Marshmallow", () => {
  test("toasted after a moment standing there, eaten or burnt, then another", () => {
    let i = 0;
    const m = new Marshmallow(() => [0.1, 0.5, 0.9][i++ % 3]!);
    const lines: string[] = [];
    for (let t = 0; t < 60; t += 0.1) {
      const said = m.step(t, true);
      if (said) lines.push(said.burnt ? "burnt" : "eaten");
    }
    expect(lines).toContain("eaten");
    expect(lines).toContain("burnt");
  });
  test("walking off drops the stick", () => {
    const m = new Marshmallow(() => 0.1);
    for (let t = 0; t < 4; t += 0.1) m.step(t, true);
    expect(m.holding).toBe(true);
    m.step(4.1, false);
    expect(m.holding).toBe(false);
  });
});

describe("seatAround", () => {
  test("every place is clear of the stones", () => {
    for (let i = 0; i < 5; i++) {
      const [x, y] = seatAround(0, 0, i, 5);
      expect(Math.hypot(x, y)).toBeGreaterThan(40);
    }
  });
});

describe("Storyteller", () => {
  test("a story is told turn about, never by a listener to themself", () => {
    const s = new Storyteller(() => 0);
    const said: { who: number; line: string }[] = [];
    let busy = -Infinity;
    for (let t = 0; t < 120; t += 0.25) {
      const l = s.next(t, 3, busy, false);
      if (l) {
        said.push(l);
        busy = t + 2;
      }
    }
    expect(said.length).toBeGreaterThan(8);
    expect(new Set(said.map((l) => l.who)).size).toBe(3);
  });
  test("someone sitting down mid-story does not take it over", () => {
    const s = new Storyteller(() => 0);
    const tellers = new Set<number>();
    let t = 0;
    // the first story (index 0): its teller lines are 0, 2, 3
    for (let i = 0; i < 5; i++, t += 5) {
      const l = s.next(t, i < 2 ? 2 : 3, -Infinity, false)!;
      if (i !== 1 && i !== 4) tellers.add(l.who);
    }
    expect(tellers.size).toBe(1);
  });
  test("nobody tells stories alone, but they greet the hero", () => {
    const s = new Storyteller(() => 0);
    expect(s.next(0, 1, -Infinity, false)).toBeNull();
    expect(s.next(1, 1, -Infinity, true)?.who).toBe(0);
    expect(s.next(5, 1, -Infinity, true)).toBeNull();
  });
});

describe("firesideNight", () => {
  test("the small hours belong to the evening before", () => {
    expect(nightOf(new Date(2026, 10, 24, 21))).toBe("2026-11-24");
    expect(nightOf(new Date(2026, 10, 25, 3))).toBe("2026-11-24");
    expect(nightOf(new Date(2026, 10, 25, 13))).toBe("2026-11-25");
  });
  test("one thing all night long", () => {
    const evening = firesideNight(new Date(2026, 10, 24, 19));
    for (const h of [20, 23, 26, 29, 33])
      expect(firesideNight(new Date(2026, 10, 24, h))).toBe(evening);
  });
  test("both come round, night after night", () => {
    const seen = new Set(
      Array.from({ length: 30 }, (_, i) =>
        firesideNight(new Date(2026, 0, 1 + i, 22)),
      ),
    );
    expect([...seen].sort()).toEqual(["marshmallow", "stories"]);
  });
  test("New Year's Eve is fireworks, from the evening into the small hours", () => {
    expect(firesideNight(new Date(2026, 11, 31, 19))).toBe("fireworks");
    expect(firesideNight(new Date(2027, 0, 1, 2))).toBe("fireworks");
    expect(firesideNight(new Date(2027, 0, 1, 20))).not.toBe("fireworks");
    expect(firesideNight(new Date(2026, 11, 30, 22))).not.toBe("fireworks");
  });
});
