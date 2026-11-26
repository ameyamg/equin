import { describe, expect, test } from "bun:test";
import { excerpt } from "./record-refusal";

describe("excerpt", () => {
  test("keeps the first 300 characters and stops reading", async () => {
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls++;
        controller.enqueue(new TextEncoder().encode("x".repeat(200)));
      },
    });
    const got = await excerpt(new Response(body, { status: 404 }));
    expect(got.message).toBe("x".repeat(300));
    // An endless body: read only until 300 characters were in hand.
    expect(pulls).toBeLessThan(5);
  });

  test("an empty body is null", async () => {
    expect(await excerpt(new Response(null, { status: 404 }))).toEqual({
      message: null,
    });
    expect(await excerpt(new Response("", { status: 404 }))).toEqual({
      message: null,
    });
  });

  test("a clone leaves the answer readable", async () => {
    const res = new Response("no such block", { status: 404 });
    expect((await excerpt(res.clone())).message).toBe("no such block");
    expect(await res.text()).toBe("no such block");
  });

  test("a failing body is recorded with its error", async () => {
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error("socket closed"));
      },
    });
    const got = await excerpt(new Response(body, { status: 409 }));
    expect(got.message).toBeNull();
    expect(got.bodyError).toContain("socket closed");
  });
});
