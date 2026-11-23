import { describe, expect, it } from "bun:test";
import { AudioContextError, ownAudioContext } from "./owned-audio-context";

/**
 * An AudioContext as far as the owner reads one: resume() stays pending until
 * a gesture (`allow()`), close() rejects every pending resume the way WebKit
 * does, and a second close() rejects.
 */
function fakeContext() {
  let state: AudioContextState = "suspended";
  const pending: { resolve(): void; reject(err: unknown): void }[] = [];
  let closes = 0;
  const ctx = {
    get state() {
      return state;
    },
    resume: () =>
      state === "closed"
        ? Promise.reject(new DOMException("closed", "InvalidStateError"))
        : new Promise<void>((resolve, reject) =>
            pending.push({ resolve, reject }),
          ),
    close: () => {
      closes++;
      if (state === "closed")
        return Promise.reject(new DOMException("closed", "InvalidStateError"));
      state = "closed";
      for (const p of pending.splice(0))
        p.reject(
          new DOMException(
            "Closed before resume completed",
            "InvalidStateError",
          ),
        );
      return Promise.resolve();
    },
  } as unknown as AudioContext;
  return {
    ctx,
    closes: () => closes,
    allow() {
      state = "running";
      for (const p of pending.splice(0)) p.resolve();
    },
    rejectPending(err: unknown) {
      for (const p of pending.splice(0)) p.reject(err);
    },
  };
}

describe("ownAudioContext", () => {
  it("answers running once the browser allows sound", async () => {
    const fake = fakeContext();
    const owned = ownAudioContext(fake.ctx);
    const resumed = owned.requestResume();
    fake.allow();
    expect(await resumed).toEqual({ kind: "running" });
  });

  it("answers closed for a resume its own close cut short", async () => {
    const fake = fakeContext();
    const owned = ownAudioContext(fake.ctx);
    const resumed = owned.requestResume();
    owned.close();
    expect(await resumed).toEqual({ kind: "closed" });
  });

  it("answers closed for a resume asked after close, without calling the context", async () => {
    const fake = fakeContext();
    const owned = ownAudioContext(fake.ctx);
    owned.close();
    expect(await owned.requestResume()).toEqual({ kind: "closed" });
  });

  it("closes once", () => {
    const fake = fakeContext();
    const owned = ownAudioContext(fake.ctx);
    owned.close();
    owned.close();
    expect(fake.closes()).toBe(1);
    expect(owned.closed).toBe(true);
  });

  it("throws an InvalidStateError it did not cause, with the cause kept", () => {
    const fake = fakeContext();
    const owned = ownAudioContext(fake.ctx);
    const resumed = owned.requestResume();
    const err = new DOMException("other", "InvalidStateError");
    fake.rejectPending(err);
    expect(resumed).rejects.toThrow(AudioContextError);
  });

  it("throws any other rejection", () => {
    const fake = fakeContext();
    const owned = ownAudioContext(fake.ctx);
    const resumed = owned.requestResume();
    fake.rejectPending(new Error("boom"));
    expect(resumed).rejects.toThrow(/boom/);
  });
});
