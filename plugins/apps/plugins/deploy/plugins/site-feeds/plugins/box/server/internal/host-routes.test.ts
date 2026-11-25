import { describe, expect, test } from "bun:test";
import {
  handleSiteFeedDelete,
  handleSiteFeedMissingMedia,
  handleSiteFeedUpsert,
} from "./host-routes";

const BASE = "http://box.localhost/api/host-only/site-feeds";

/** A request as the backend sees it, with the forwarding chain it crossed. */
function request(path: string, init: RequestInit, xff: string | null) {
  const headers = new Headers(init.headers);
  if (xff !== null) headers.set("x-forwarded-for", xff);
  return new Request(`${BASE}${path}`, { ...init, headers });
}

const body = JSON.stringify({ feedId: "tips", id: "e1" });
const post = {
  method: "POST",
  body,
  headers: {
    "content-length": String(body.length),
    "content-type": "application/json",
  },
};

describe("site-feeds host-only routes", () => {
  // A public request crossed Caddy AND the gateway: two hops. Refused before
  // the body is read or the database touched.
  for (const [name, handler, path, init] of [
    ["upsert", handleSiteFeedUpsert, "/entries/upsert", post],
    ["delete", handleSiteFeedDelete, "/entries/delete", post],
    [
      "missing",
      handleSiteFeedMissingMedia,
      "/media/missing?q=e30",
      { method: "GET" },
    ],
  ] as const) {
    test(`${name} answers 404 to a request from outside the box`, async () => {
      const res = await handler(
        request(path, init, "203.0.113.7, 127.0.0.1"),
        {},
      );
      expect(res.status).toBe(404);
    });
    test(`${name} answers 404 to a request that skipped the gateway`, async () => {
      const res = await handler(request(path, init, null), {});
      expect(res.status).toBe(404);
    });
  }

  test("an upsert body over the cap is refused on the box too", async () => {
    const res = await handleSiteFeedUpsert(
      request(
        "/entries/upsert",
        {
          method: "POST",
          body: "{}",
          headers: { "content-length": String(1024 * 1024) },
        },
        "127.0.0.1",
      ),
      {},
    );
    expect(res.status).toBe(413);
  });
});
