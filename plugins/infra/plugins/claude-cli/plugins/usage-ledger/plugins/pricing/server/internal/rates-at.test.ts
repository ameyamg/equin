import { describe, expect, test } from "bun:test";
import { priceWithRates, type RatesInForce } from "./rates-at";

const tiered = (below: number) => ({ below, above: 0 });

const bucket = (model: string, tokens: number) => ({
  model,
  speed: "standard" as const,
  input: tiered(tokens),
  output: tiered(tokens),
  cacheRead: tiered(0),
  cacheCreate5m: tiered(0),
  cacheCreate1h: tiered(0),
});

describe("priceWithRates", () => {
  const none: RatesInForce = new Map();

  test("a model with tokens and no rate is unpriced, never $0", () => {
    expect(priceWithRates(none, bucket("claude-unknown", 10))).toBeNull();
  });

  test("a bucket of no tokens costs $0 without a rate (Claude Code's <synthetic>)", () => {
    expect(priceWithRates(none, bucket("<synthetic>", 0))).toBe(0);
  });
});
