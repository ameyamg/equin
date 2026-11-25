import { describe, expect, test } from "bun:test";
import { envEntries } from "@plugins/infra/plugins/launcher/plugins/env-names/core";
import {
  disclaimArgv,
  execNamedArgv,
  spawnDisclaimWanted,
} from "./disclaim-argv";

describe("spawnDisclaimWanted", () => {
  test("on macOS by default", () => {
    expect(spawnDisclaimWanted({}, "darwin")).toBe(true);
  });
  test("never off macOS", () => {
    expect(spawnDisclaimWanted({}, "linux")).toBe(false);
  });
  test("off with the escape hatch", () => {
    expect(
      spawnDisclaimWanted(envEntries({ NO_SPAWN_DISCLAIM: "1" }), "darwin"),
    ).toBe(false);
  });
  test("only `1` turns it off", () => {
    expect(
      spawnDisclaimWanted(envEntries({ NO_SPAWN_DISCLAIM: "0" }), "darwin"),
    ).toBe(true);
  });
});

describe("disclaimArgv", () => {
  const argv: [string, ...string[]] = [
    "/usr/local/bin/claude",
    "--output-format",
    "stream-json",
  ];

  test("prefixes the helper when wanted", () => {
    expect(disclaimArgv("/cache/disclaim-exec", argv, true)).toEqual([
      "/cache/disclaim-exec",
      ...argv,
    ]);
  });
  test("unchanged without a helper", () => {
    expect(disclaimArgv(null, argv, true)).toEqual(argv);
  });
  test("unchanged when not wanted", () => {
    expect(disclaimArgv("/cache/disclaim-exec", argv, false)).toEqual(argv);
  });
  test("returns a copy, never the caller's array", () => {
    expect(disclaimArgv(null, argv, true)).not.toBe(argv);
  });
  test("an empty argv has no spelling", () => {
    // @ts-expect-error — argv names the program at least.
    expect(disclaimArgv(null, [], true)).toEqual([]);
  });
});

describe("execNamedArgv", () => {
  const argv: [string, ...string[]] = ["/usr/local/bin/claude", "--verbose"];

  test("runs the program through the named copy", () => {
    expect(execNamedArgv("/agent/bin/equin · conv-1", argv)).toEqual([
      "/agent/bin/equin · conv-1",
      "--exec-named",
      ...argv,
    ]);
  });
  test("unchanged without a named copy", () => {
    expect(execNamedArgv(null, argv)).toEqual(argv);
  });
  test("disclaimed into the named copy, not the program", () => {
    expect(
      disclaimArgv(
        "/cache/disclaim-exec",
        execNamedArgv("/bin/named", argv),
        true,
      ),
    ).toEqual(["/cache/disclaim-exec", "/bin/named", "--exec-named", ...argv]);
  });
});
