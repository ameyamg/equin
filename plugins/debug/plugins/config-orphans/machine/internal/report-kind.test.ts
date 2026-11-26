import { describe, expect, test } from "bun:test";
import type { OrphanEntry } from "@plugins/config_v2/core";
import { STRANDED_CONFIG_KIND, strandedConfigReports } from "./report-kind";

function orphan(
  storeKey: string,
  riskClass: OrphanEntry["riskClass"],
  relPaths: string[],
): OrphanEntry {
  const [hier, name] = [
    storeKey.slice(0, storeKey.lastIndexOf("/")),
    storeKey.slice(storeKey.lastIndexOf("/") + 1),
  ];
  return {
    storeKey,
    hier,
    name,
    riskClass,
    reason: "removed",
    files: relPaths.map((relPath) => ({
      relPath,
      role: relPath.endsWith(".origin.jsonc") ? "origin" : "override",
      bytes: 1,
      mtimeMs: 0,
    })),
    totalBytes: relPaths.length,
    newestMtimeMs: 0,
  };
}

describe("strandedConfigReports", () => {
  test("one report per stranded config, none for noise", () => {
    const inputs = strandedConfigReports({
      orphans: [
        orphan("apps/mail/threads/mail-threads", "stranded-data", [
          "apps/mail/threads/mail-threads.jsonc",
          "apps/mail/threads/mail-threads.origin.jsonc",
        ]),
        orphan("apps/mail/shell/banner", "noise", [
          "apps/mail/shell/banner.origin.jsonc",
        ]),
        orphan("apps/other/x", "stranded-data", ["apps/other/x.jsonc"]),
      ],
    });
    expect(inputs.map((i) => i.data)).toEqual([
      {
        storeKey: "apps/mail/threads/mail-threads",
        files: [
          "apps/mail/threads/mail-threads.jsonc",
          "apps/mail/threads/mail-threads.origin.jsonc",
        ],
      },
      { storeKey: "apps/other/x", files: ["apps/other/x.jsonc"] },
    ]);
    expect(inputs.every((i) => i.kind === STRANDED_CONFIG_KIND)).toBe(true);
  });

  test("nothing stranded files nothing", () => {
    expect(strandedConfigReports({ orphans: [] })).toEqual([]);
  });
});
