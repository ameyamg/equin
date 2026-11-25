import { describe, expect, test } from "bun:test";
import { decideStop, evaluateStop } from "./decide";
import type { McpToolRegistration } from "@plugins/infra/plugins/mcp/server";
import type { StopGateEntry, StopVerdict, StopWaiverEntry } from "./registry";

const allow = { kind: "allow" } as const;
const block = (reason: string) => ({ kind: "block", reason }) as const;

describe("decideStop", () => {
  test("no gate: allow", () => {
    expect(decideStop([], [], [])).toEqual({ decision: "allow", reason: null });
  });

  test("every gate allows: allow, whatever the waivers", () => {
    expect(decideStop([allow, allow], ["woken later"], ["w"])).toEqual({
      decision: "allow",
      reason: null,
    });
  });

  test("a gate blocks, no waiver: block with its reason", () => {
    expect(decideStop([allow, block("submit a report")], [null], [])).toEqual({
      decision: "block",
      reason: "submit a report",
    });
  });

  test("several gates block: their reasons joined", () => {
    expect(decideStop([block("a"), block("b")], [], [])).toEqual({
      decision: "block",
      reason: "a\n\nb",
    });
  });

  test("a waiver waives a block: allow with the waiver's reason", () => {
    expect(
      decideStop([block("a")], [null, "you will be woken"], ["x", "y"]),
    ).toEqual({
      decision: "allow",
      reason: "you will be woken",
    });
  });

  test("a block names every way to stop anyway, so the agent can wait legally", () => {
    expect(
      decideStop(
        [block("submit a report")],
        [null, null],
        ["background work is running", "a watch is busy"],
      ),
    ).toEqual({
      decision: "block",
      reason:
        "submit a report\n\nYou may end your turn anyway while:\n- background work is running\n- a watch is busy",
    });
  });
});

describe("evaluateStop", () => {
  const gate = (
    id: string,
    verdict: () => Promise<StopVerdict>,
    tools: readonly McpToolRegistration[] = [],
  ): StopGateEntry => ({ id, tools, check: verdict });
  /** Every tool is callable: the session has what each gate asks for. */
  const all = () => Promise.resolve({ callable: true });

  test("asks the waivers only when a gate blocks", async () => {
    let asked = 0;
    const waiver: StopWaiverEntry = {
      id: "w",
      when: "woken later",
      waives: () => {
        asked++;
        return Promise.resolve("woken");
      },
    };
    expect(
      await evaluateStop(
        "c",
        [gate("g", () => Promise.resolve(allow))],
        [waiver],
        all,
      ),
    ).toEqual({ decision: "allow", reason: null });
    expect(asked).toBe(0);
    expect(
      await evaluateStop(
        "c",
        [gate("g", () => Promise.resolve(block("report")))],
        [waiver],
        all,
      ),
    ).toEqual({ decision: "allow", reason: "woken" });
    expect(asked).toBe(1);
  });

  describe("a report owed while the agent waits on background work", () => {
    const reportGate = gate("outcome-report", () =>
      Promise.resolve(block("submit your outcome report")),
    );
    const background = (pending: number): StopWaiverEntry => ({
      id: "background-work",
      when: "you have background work running that will wake you",
      waives: () =>
        Promise.resolve(pending > 0 ? `${String(pending)} running` : null),
    });

    test("background work running: the turn may end", async () => {
      expect(
        await evaluateStop("c", [reportGate], [background(1)], all),
      ).toEqual({
        decision: "allow",
        reason: "1 running",
      });
    });

    test("nothing pending: still refused, naming how to wait", async () => {
      expect(
        await evaluateStop("c", [reportGate], [background(0)], all),
      ).toEqual({
        decision: "block",
        reason:
          "submit your outcome report\n\nYou may end your turn anyway while:\n- you have background work running that will wake you",
      });
    });
  });

  test("passes the conversation to every gate", async () => {
    const seen: string[] = [];
    const g: StopGateEntry = {
      id: "g",
      tools: [],
      check: (id) => {
        seen.push(id);
        return Promise.resolve(allow);
      },
    };
    await evaluateStop("conv-1", [g], [], all);
    expect(seen).toEqual(["conv-1"]);
  });

  test("a gate that throws fails the decision", async () => {
    let error: unknown;
    try {
      await evaluateStop(
        "c",
        [gate("g", () => Promise.reject(new Error("db down")))],
        [],
        all,
      );
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(Error);
  });

  describe("a gate is enforced only while the agent can call its tools", () => {
    const turnFor = { toolName: "turn_for" } as McpToolRegistration;
    const turnForGate = gate(
      "turn-for",
      () => Promise.resolve(block("call turn_for")),
      [turnFor],
    );
    const asked: string[] = [];
    const reach =
      (callable: boolean) =>
      (conversationId: string, t: McpToolRegistration) => {
        asked.push(`${conversationId}:${t.toolName}`);
        return Promise.resolve({ callable });
      };

    test("the session holds the tool: the block stands", async () => {
      expect(await evaluateStop("c", [turnForGate], [], reach(true))).toEqual({
        decision: "block",
        reason: "call turn_for",
      });
    });

    test("the session lacks the tool (connected before it existed): allowed", async () => {
      asked.length = 0;
      expect(await evaluateStop("c", [turnForGate], [], reach(false))).toEqual({
        decision: "allow",
        reason: null,
      });
      expect(asked).toEqual(["c:turn_for"]);
    });

    test("an allowing gate's tools are never asked about", async () => {
      asked.length = 0;
      await evaluateStop(
        "c",
        [gate("g", () => Promise.resolve(allow), [turnFor])],
        [],
        reach(false),
      );
      expect(asked).toEqual([]);
    });

    test("another gate's block still stands", async () => {
      expect(
        await evaluateStop(
          "c",
          [turnForGate, gate("other", () => Promise.resolve(block("other")))],
          [],
          reach(false),
        ),
      ).toEqual({ decision: "block", reason: "other" });
    });
  });
});
