/**
 * The helper's contract, against the real macOS SPI: the C source compiled
 * into a scratch dir (not the deps cache), then driven through `sh`, since
 * responsibility is only observable from another process.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const isDarwin = process.platform === "darwin";
const SOURCE = join(import.meta.dir, "../../native/disclaim-exec.c");

let dir = "";
let helper = "";
/** A copy of the helper under a conversation-like name (`--exec-named`). */
let named = "";

// Bun.spawnSync throughout: no stream to race (spawn-safety bans only async Bun.spawn).
function sh(script: string, stdin?: string) {
  const r = Bun.spawnSync(["/bin/sh", "-c", script], {
    env: { ...process.env, H: helper, N: named },
    stdin: stdin === undefined ? "ignore" : Buffer.from(stdin),
  });
  return {
    code: r.exitCode,
    out: r.stdout.toString(),
    err: r.stderr.toString(),
  };
}

beforeAll(() => {
  if (!isDarwin) return;
  dir = mkdtempSync(join(tmpdir(), "disclaim-exec-"));
  helper = join(dir, "disclaim-exec");
  const cc = Bun.spawnSync([
    process.env.CC ?? "cc",
    "-O2",
    "-Wall",
    "-Werror",
    "-std=c11",
    "-framework",
    "CoreFoundation",
    "-o",
    helper,
    SOURCE,
  ]);
  if (cc.exitCode !== 0) throw new Error(cc.stderr.toString());
  named = join(dir, "equin · conv-test · Fix login bug");
  copyFileSync(helper, named);
  // A cold compiler (the xcrun shim) on a loaded host takes well over bun's 5 s.
}, 120_000);

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe.skipIf(!isDarwin)("disclaim-exec", () => {
  // Responsibility is observed through a CHILD of the program it runs: a
  // process whose responsible ancestor has exited reads as responsible for
  // itself, so "the disclaimed process reports its own pid" proves nothing on
  // its own. A child naming a live, disclaimed parent does.
  const childOf = (prefix: string) => {
    const r = sh(
      `${prefix} /bin/sh -c '/bin/sleep 5 & sleep 0.3; "$H" --print-responsible $!; echo $$; echo $!; kill $!'`,
    );
    const [responsible, parent, child] = r.out.trim().split("\n");
    return { responsible, parent, child, err: r.err };
  };

  test("the program it runs is responsible for what it starts", () => {
    const r = childOf(`"$H"`);
    expect(r.err).toBe("");
    expect(r.responsible).toBe(r.parent);
    expect(r.responsible).not.toBe(r.child);
  });

  test("without it, the program is not", () => {
    const r = childOf("");
    expect(r.err).toBe("");
    expect(r.responsible).not.toBe(r.parent);
  });

  test("the program keeps the helper's pid (it is replaced in place)", () => {
    const r = sh(
      `"$H" /bin/sleep 5 & p=$!; sleep 0.3; ps -o comm= -p $p; kill $p`,
    );
    expect(r.out.trim()).toBe("/bin/sleep");
  });

  test("stdio, environment and the exit code pass through", () => {
    expect(sh(`"$H" /bin/cat`, "hello").out).toBe("hello");
    expect(sh(`FOO=bar "$H" /bin/sh -c 'echo $FOO; exit 42'`)).toEqual({
      code: 42,
      out: "bar\n",
      err: "",
    });
  });

  test("a signal reaches the program (it replaced the helper in place)", () => {
    const r = sh(
      `"$H" /bin/sleep 30 & p=$!; sleep 0.2; kill -TERM $p; wait $p; echo $?`,
    );
    expect(r.out.trim()).toBe("143");
  });

  test("the program is looked up on PATH", () => {
    expect(sh(`"$H" true`).code).toBe(0);
  });

  test("a program that cannot run fails loudly with 127", () => {
    const r = sh(`"$H" /nonexistent/program`);
    expect(r.code).toBe(127);
    expect(r.err).toContain("disclaim-exec: cannot run /nonexistent/program");
  });

  test("no program is a usage error", () => {
    const r = sh(`"$H"`);
    expect(r.code).toBe(127);
    expect(r.err).toContain("usage:");
  });

  describe("--exec-named (a copy named for whoever the process works for)", () => {
    test("becomes the program in place, argv[0] its own path", () => {
      const r = sh(
        `"$N" --exec-named /bin/sleep 5 & p=$!; sleep 0.3; ps -o args= -p $p; kill $p`,
      );
      expect(r.out.trim()).toBe(`${named} 5`);
    });

    test("stdio, environment and the exit code pass through", () => {
      expect(sh(`"$N" --exec-named /bin/cat`, "hello").out).toBe("hello");
      expect(
        sh(`FOO=bar "$N" --exec-named /bin/sh -c 'echo $FOO; exit 42'`),
      ).toMatchObject({ code: 42, out: "bar\n" });
    });

    test("the process is listed under the copy's file name", () => {
      const r = sh(
        `"$N" --exec-named /bin/sleep 5 & p=$!; sleep 0.5; lsappinfo info -only name "$(lsappinfo find pid=$p)"; kill $p`,
      );
      expect(r.err).toBe("");
      expect(r.out).toContain(`"equin · conv-test · Fix login bug"`);
    });

    test("disclaimed into the copy: responsible for what the program starts", () => {
      const r = childOf(`"$H" "$N" --exec-named`);
      expect(r.err).toBe("");
      expect(r.responsible).toBe(r.parent);
    });

    test("a program that cannot run fails loudly with 127", () => {
      const r = sh(`"$N" --exec-named /nonexistent/program`);
      expect(r.code).toBe(127);
      expect(r.err).toContain("disclaim-exec: cannot run /nonexistent/program");
    });

    test("no program is a usage error", () => {
      const r = sh(`"$N" --exec-named`);
      expect(r.code).toBe(127);
      expect(r.err).toContain("usage:");
    });
  });
});
