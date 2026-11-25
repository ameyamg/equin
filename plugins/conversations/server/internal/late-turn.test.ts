import { describe, expect, test } from "bun:test";
import { lateTurn } from "./late-turn";

// The shape of conv-1795608764-h27peb on 2026-11-25: a turn that ended at
// 12:22:25, then the agent's exit_clean turn — exit_clean's finalize armed its
// wait at 12:24:22, a message was typed in at 12:24:24 and main's backend
// restarted, and the final message was still streaming (its thinking block
// written, its text not yet, no stop_hook_summary). The boot's replay handed
// the 12:22 turn to the finalize, which closed the conversation mid-answer.

let n = 0;
const line = (at: string, fields: Record<string, unknown>) => ({
  uuid: `l${++n}`,
  timestamp: `2026-11-25T${at}Z`,
  ...fields,
});
const prompt = (at: string, text: string) =>
  line(at, { type: "user", message: { role: "user", content: text } });
const assistant = (
  at: string,
  id: string,
  stop: string,
  content: Record<string, unknown>[],
) =>
  line(at, {
    type: "assistant",
    message: { role: "assistant", id, stop_reason: stop, content },
  });
const summary = (at: string) =>
  line(at, { type: "system", subtype: "stop_hook_summary" });

const earlierTurn = () => [
  prompt("12:20:00.000", "fix it"),
  assistant("12:22:24.992", "m-earlier", "end_turn", [
    { type: "text", text: "Pushed." },
  ]),
  summary("12:22:25.166"),
];
const exitTurnStreaming = () => [
  prompt("12:24:06.786", "please close"),
  assistant("12:24:22.695", "m-exit", "tool_use", [
    { type: "tool_use", id: "t1", name: "exit_clean", input: {} },
  ]),
  line("12:24:22.843", {
    type: "user",
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }],
    },
  }),
  line("12:24:24.862", { type: "queue-operation" }),
  assistant("12:24:28.903", "m-final", "end_turn", [
    { type: "thinking", thinking: "…" },
  ]),
];
// The finalize armed its wait; main's backend followed the conversation again
// once it booted, after the whole transcript below was written.
const window = {
  firstArmedAt: new Date("2026-11-25T12:24:22.845Z"),
  followedSince: new Date("2026-11-25T12:24:40.000Z"),
};

describe("lateTurn", () => {
  test("a turn that ended before the wait was armed is not handed to it", () => {
    expect(
      lateTurn([...earlierTurn(), ...exitTurnStreaming()], window),
    ).toBeNull();
  });

  test("nor once the final message's text is written, before its stop hooks", () => {
    const lines = [
      ...earlierTurn(),
      ...exitTurnStreaming(),
      assistant("12:24:30.059", "m-final", "end_turn", [
        { type: "text", text: "Done." },
      ]),
    ];
    expect(lateTurn(lines, window)).toBeNull();
  });

  test("the turn the wait was armed in is handed over once it ended", () => {
    // It ended while the backend was down: the replay is how the wait hears it.
    const lines = [
      ...earlierTurn(),
      ...exitTurnStreaming(),
      assistant("12:24:30.059", "m-final", "end_turn", [
        { type: "text", text: "Done." },
      ]),
      summary("12:24:30.300"),
    ];
    expect(lateTurn(lines, window)).toEqual({
      messageId: "m-final",
      text: "Done.",
      endedAt: "2026-11-25T12:24:30.300Z",
    });
  });

  test("a stop a hook blocked is no end", () => {
    const lines = [
      ...earlierTurn(),
      ...exitTurnStreaming(),
      assistant("12:24:30.059", "m-final", "end_turn", [
        { type: "text", text: "Done." },
      ]),
      line("12:24:30.200", {
        type: "attachment",
        attachment: {
          type: "hook_blocking_error",
          hookEvent: "Stop",
          hookName: "Stop",
          blockingError: "not yet",
        },
      }),
      summary("12:24:30.300"),
    ];
    expect(lateTurn(lines, window)).toBeNull();
  });

  test("a turn that ended once followed again is the live path's", () => {
    const lines = [
      ...earlierTurn(),
      ...exitTurnStreaming(),
      assistant("12:24:30.059", "m-final", "end_turn", [
        { type: "text", text: "Done." },
      ]),
      summary("12:24:30.300"),
    ];
    expect(
      lateTurn(lines, {
        ...window,
        followedSince: new Date("2026-11-25T12:24:30.000Z"),
      }),
    ).toBeNull();
  });

  test("no finished turn at all hands nothing", () => {
    expect(lateTurn(exitTurnStreaming(), window)).toBeNull();
  });
});
