import { describe, expect, test } from "bun:test";
import type { DecisionExchangeRow } from "../../core";
import { threadAsOf } from "./thread-as-of";

const at = (s: string) => new Date(`2026-11-27T01:${s}Z`);

function row(
  id: string,
  createdAt: Date,
  agentAt: Date | null,
): DecisionExchangeRow {
  return {
    id,
    decisionId: "dec-1",
    turnId: null,
    kind: "question",
    pick: null,
    userText: `note ${id}`,
    agentText: agentAt === null ? null : `reply ${id}`,
    agentAt,
    consumedAt: null,
    createdAt,
  } as DecisionExchangeRow;
}

describe("threadAsOf", () => {
  // The question asked against version 1, answered by the edit that made version 2.
  const question = row("q", at("03:30.047"), at("03:45.931"));
  const note = row("n", at("03:47.539"), at("03:47.539"));

  test("keeps the user's note and the reply that made the next version", () => {
    expect(threadAsOf([question, note], at("03:45.943"))).toEqual([question]);
  });

  test("a reply recorded at the next version's instant belongs to this one", () => {
    expect(threadAsOf([question], at("03:45.931"))).toEqual([question]);
  });

  test("a reply written after the version was replaced is left out", () => {
    const [cut] = threadAsOf([question], at("03:40.000"));
    expect(cut?.userText).toBe("note q");
    expect(cut?.agentText).toBeNull();
    expect(cut?.agentAt).toBeNull();
  });

  test("an exchange written after the version is not in it", () => {
    expect(threadAsOf([question, note], at("03:20.000"))).toEqual([]);
  });
});
