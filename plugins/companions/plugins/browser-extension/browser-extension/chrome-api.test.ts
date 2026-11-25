import { beforeAll, describe, expect, test } from "bun:test";

/**
 * The shell's parts can run from two builds at once (Chrome keeps the worker
 * it loaded, and reads the offscreen and content scripts from disk): a part
 * must refuse a message from another build in words, before its schema reads
 * it. 2026-11-25: an older worker's offscreen.stop lacked `stoppedBy`, and
 * the panel showed zod's raw issue list.
 */
type Listener = (
  message: unknown,
  sender: unknown,
  sendResponse: (r: unknown) => void,
) => boolean | undefined;
const listeners: Listener[] = [];
const sent: unknown[] = [];

let api: typeof import("./chrome-api");
beforeAll(async () => {
  Object.assign(globalThis, {
    __SHELL_BUILD__: "build-b",
    chrome: {
      runtime: {
        getManifest: () => ({ version_name: "build-a" }),
        sendMessage: async (m: unknown) => {
          sent.push(m);
          return null;
        },
        onMessage: { addListener: (l: Listener) => listeners.push(l) },
      },
      tabs: { sendMessage: async () => null },
    },
  });
  api = await import("./chrome-api");
});

function deliver(message: unknown): Promise<unknown> {
  return new Promise((resolve) => {
    for (const l of listeners) l(message, {}, resolve);
  });
}

describe("one shell, one build", () => {
  test("a script under another build's manifest knows it", () => {
    expect(api.runsThisBuild()).toBe(false);
  });

  test("every send is stamped with this build", async () => {
    await api.sendToExtension({ type: "offscreen.heartbeat" });
    expect(api.messageBuild(sent.at(-1))).toBe("build-b");
    expect(api.unstamped(sent.at(-1))).toEqual({ type: "offscreen.heartbeat" });
  });

  test("a message from another build is refused in words, unread", async () => {
    let handled = false;
    api.onMessageAsync(
      (m) => api.messageType(m) === "offscreen.stop",
      async () => {
        handled = true;
        return { ok: true };
      },
    );
    // What the older worker sent: no stamp, no stoppedBy.
    const answer = await deliver({
      type: "offscreen.stop",
      durationMs: 1,
      pointer: null,
    });
    expect(handled).toBe(false);
    expect(answer).toEqual({ ok: false, error: api.OTHER_BUILD_TEXT });
  });

  test("a message from this build reaches the handler unstamped", async () => {
    listeners.length = 0;
    let got: unknown = null;
    api.onMessageAsync(
      (m) => api.messageType(m) === "offscreen.pause",
      async (m) => {
        got = m;
        return { ok: true };
      },
    );
    expect(
      await deliver({ type: "offscreen.pause", equinShellBuild: "build-b" }),
    ).toEqual({ ok: true });
    expect(got).toEqual({ type: "offscreen.pause" });
  });

  test("a schema's refusal is words, never zod's issue list", async () => {
    const { z } = await import("zod");
    const parsed = z
      .object({ stoppedBy: z.enum(["user"]) })
      .safeParse({ stoppedBy: undefined });
    if (parsed.success) throw new Error("expected a refusal");
    const text = api.errorText(parsed.error);
    expect(text).not.toStartWith("[");
    expect(text).toContain("stoppedBy");
    expect(text).toContain("could not read a message");
  });
});
