import { describe, expect, test } from "bun:test";
import { HttpError } from "@plugins/infra/plugins/endpoints/core";
import { withRefusalHint } from "./refusal-hint";

describe("withRefusalHint", () => {
  test("appends the hint to a 4xx refusal after a blank line", () => {
    const out = withRefusalHint(new HttpError(400, "not found"), "Report it.");
    expect(out).toBeInstanceOf(HttpError);
    expect((out as HttpError).status).toBe(400);
    expect((out as HttpError).message).toBe("not found\n\nReport it.");
  });

  test("a blank hint leaves the refusal as it is", () => {
    const err = new HttpError(403, "refused");
    expect(withRefusalHint(err, "  \n")).toBe(err);
  });

  test("a crash is never hinted", () => {
    const server = new HttpError(500, "boom");
    const plain = new Error("boom");
    expect(withRefusalHint(server, "Report it.")).toBe(server);
    expect(withRefusalHint(plain, "Report it.")).toBe(plain);
  });
});
