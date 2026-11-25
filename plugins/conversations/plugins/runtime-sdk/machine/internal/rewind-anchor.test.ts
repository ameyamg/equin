import { describe, expect, test } from "bun:test";
import { promptParentUuid } from "./rewind-anchor";

const jsonl = (...lines: object[]) =>
  lines.map((l) => JSON.stringify(l)).join("\n") + "\n";

describe("promptParentUuid", () => {
  test("resumes at the entry the prompt hangs off, not the last relayed assistant block", () => {
    // conv-1795608764-h27peb, 2026-11-25: the agent relayed the thinking
    // block (a-think) and was shut down before the text block (a-text) of
    // the same message reached its events; the transcript holds both.
    const transcript = jsonl(
      { type: "assistant", uuid: "a-think", parentUuid: "u-0" },
      { type: "queue-operation", content: "x" },
      { type: "assistant", uuid: "a-text", parentUuid: "a-think" },
      { type: "ai-title" },
      { type: "user", uuid: "p-1", parentUuid: "a-text" },
      { type: "file-history-snapshot", messageId: "p-1" },
      { type: "user", uuid: "u-int", parentUuid: "p-1" },
    );
    expect(promptParentUuid(transcript, "p-1")).toBe("a-text");
  });

  test("a prompt that opened the session keeps nothing", () => {
    expect(
      promptParentUuid(
        jsonl({ type: "user", uuid: "p-1", parentUuid: null }),
        "p-1",
      ),
    ).toBeNull();
  });

  test("a line still being written is not read", () => {
    const transcript =
      jsonl({ type: "user", uuid: "p-1", parentUuid: "a-1" }) +
      '{"type":"user","uuid":"u-int","parentUuid":"p-1","mess';
    expect(promptParentUuid(transcript, "p-1")).toBe("a-1");
  });

  test("a null parent after earlier messages is an error, never a fresh session", () => {
    expect(() =>
      promptParentUuid(
        jsonl(
          { type: "assistant", uuid: "a-1", parentUuid: null },
          { type: "user", uuid: "p-1", parentUuid: null },
        ),
        "p-1",
      ),
    ).toThrow(/follows earlier messages/);
  });

  test("a prompt the transcript does not hold is an error, never a guess", () => {
    expect(() =>
      promptParentUuid(
        jsonl({ type: "user", uuid: "p-0", parentUuid: null }),
        "p-1",
      ),
    ).toThrow(/no entry p-1/);
  });
});
