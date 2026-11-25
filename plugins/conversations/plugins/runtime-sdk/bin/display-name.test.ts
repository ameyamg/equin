import { describe, expect, test } from "bun:test";
import { checkDisplayName, type LsAppInfo } from "./display-name";

const NAME = 'equin · conv-1 · Fix "login" bug';

/** A fake `lsappinfo`: answers `find` and `info` from the given outputs, recording each call. */
function fakeLsAppInfo(opts: {
  find: { code: number; stdout: string; stderr?: string };
  info?: { code: number; stdout: string; stderr?: string };
}): { run: LsAppInfo; calls: string[][] } {
  const calls: string[][] = [];
  const run: LsAppInfo = (args) => {
    calls.push([...args]);
    const out = args[0] === "find" ? opts.find : opts.info;
    if (!out) throw new Error(`unexpected lsappinfo ${args.join(" ")}`);
    return Promise.resolve({ stderr: "", ...out });
  };
  return { run, calls };
}

const ASN = 'ASN:0x0-0xb6e56da-"equin_·_conv-1":\n';

describe("checkDisplayName", () => {
  test("the launcher's name, quotes and all, is no finding", async () => {
    const fake = fakeLsAppInfo({
      find: { code: 0, stdout: ASN },
      info: { code: 0, stdout: `"LSDisplayName"="${NAME}"\n` },
    });
    expect(
      await checkDisplayName({ pid: 42, expected: NAME, lsappinfo: fake.run }),
    ).toBeNull();
    expect(fake.calls).toEqual([
      ["find", "pid=42"],
      ["info", "-only", "name", ASN.trim()],
    ]);
  });

  test("a pid LaunchServices never registered", async () => {
    const fake = fakeLsAppInfo({ find: { code: 0, stdout: "\n" } });
    expect(
      await checkDisplayName({ pid: 42, expected: NAME, lsappinfo: fake.run }),
    ).toEqual({
      cause: "unregistered",
      expected: NAME,
      registered: null,
      detail: null,
    });
    expect(fake.calls).toHaveLength(1);
  });

  test("registered with no display name", async () => {
    const fake = fakeLsAppInfo({
      find: { code: 0, stdout: ASN },
      info: { code: 0, stdout: "\n" },
    });
    expect(
      await checkDisplayName({ pid: 42, expected: NAME, lsappinfo: fake.run }),
    ).toMatchObject({ cause: "unnamed", registered: null });
  });

  test("a call that 'succeeded' but left another name", async () => {
    const fake = fakeLsAppInfo({
      find: { code: 0, stdout: ASN },
      info: { code: 0, stdout: '"LSDisplayName"="claude"\n' },
    });
    expect(
      await checkDisplayName({ pid: 42, expected: NAME, lsappinfo: fake.run }),
    ).toEqual({
      cause: "other-name",
      expected: NAME,
      registered: "claude",
      detail: null,
    });
  });

  test("an lsappinfo that fails is unreadable, with its words", async () => {
    const fake = fakeLsAppInfo({
      find: { code: 1, stdout: "", stderr: "no session\n" },
    });
    expect(
      await checkDisplayName({ pid: 42, expected: NAME, lsappinfo: fake.run }),
    ).toEqual({
      cause: "unreadable",
      expected: NAME,
      registered: null,
      detail: "lsappinfo find pid=42 exited 1: no session",
    });
  });

  test("an lsappinfo that cannot be spawned is unreadable", async () => {
    const run: LsAppInfo = () => Promise.reject(new Error("spawn ENOENT"));
    expect(
      await checkDisplayName({ pid: 42, expected: NAME, lsappinfo: run }),
    ).toMatchObject({ cause: "unreadable", detail: "spawn ENOENT" });
  });

  test("no lsappinfo on the machine is unreadable", async () => {
    expect(
      await checkDisplayName({ pid: 42, expected: NAME, lsappinfo: null }),
    ).toMatchObject({ cause: "unreadable" });
  });
});
