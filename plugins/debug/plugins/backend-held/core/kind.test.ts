import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { OutboxEntrySchema } from "@plugins/reports/plugins/outbox/plugins/file/core";
import { REPO_ROOT } from "@plugins/infra/plugins/paths/plugins/repo-root/core";
import { BackendHeldPayloadSchema, describeBackendHeld } from "./kind";

// The entry the gateway's Go writer produces (its own test asserts it builds
// exactly this): the cross-language contract, read by both sides.
const GOLDEN = join(REPO_ROOT, "gateway/testdata/backend-held-entry.json");

describe("backend-held", () => {
  test("the gateway's entry parses as an outbox entry of this kind", () => {
    const entry = OutboxEntrySchema.parse(
      JSON.parse(readFileSync(GOLDEN, "utf8")),
    );
    expect(entry.kind).toBe("backend-held");
    const d = BackendHeldPayloadSchema.parse(entry.data);
    expect(describeBackendHeld(d)).toBe(
      "promo-film.att-1795752888-nua188 held up 5.0 h by a silent websocket GET /ws/notifications",
    );
  });
});
