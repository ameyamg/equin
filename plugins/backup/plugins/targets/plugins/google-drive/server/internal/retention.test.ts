import { afterEach, describe, expect, test } from "bun:test";
import { pruneOldBackups } from "./retention";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("pruneOldBackups", () => {
  // report-1794884443-cyv4ww: a 5 h run sent the token fetched at its start to
  // the retention listing, and Drive answered 401. Each call asks for its own.
  test("every Drive call carries the token asked for when it is sent", async () => {
    let issued = 0;
    const token = async () => `tok-${++issued}`;
    const seen: string[] = [];
    globalThis.fetch = (async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      const auth = new Headers(init?.headers).get("Authorization");
      seen.push(`${init?.method ?? "GET"} ${auth}`);
      if ((init?.method ?? "GET") === "GET") {
        const files = [
          { id: "a", name: "a", createdTime: "1" },
          { id: "b", name: "b", createdTime: "2" },
          { id: "c", name: "c", createdTime: "3" },
        ];
        return new Response(JSON.stringify({ files }), { status: 200 });
      }
      expect(String(input)).toContain("/files/");
      return new Response(null, { status: 204 });
    }) as typeof fetch;

    const res = await pruneOldBackups("folder", 1, token);

    expect(res).toEqual({ pruned: 2, failures: [] });
    expect(seen).toEqual([
      "GET Bearer tok-1",
      "DELETE Bearer tok-2",
      "DELETE Bearer tok-3",
    ]);
  });

  test("a token that cannot be had fails the pass loudly", async () => {
    globalThis.fetch = (async () => {
      throw new Error("no request may be sent without a token");
    }) as unknown as typeof fetch;
    const token = async () => {
      throw new Error("refused");
    };
    expect(pruneOldBackups("folder", 1, token)).rejects.toThrow("refused");
  });
});
