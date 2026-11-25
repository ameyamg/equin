import { describe, expect, it } from "bun:test";
import type { SshTarget } from "@plugins/infra/plugins/ssh/server";
import type { DataDir } from "@plugins/infra/plugins/paths/core";
import {
  boxDataDirPaths,
  ensureBoxDirArgv,
  uploadOverSsh,
  type UploadDeps,
} from "./upload";

const TARGET: SshTarget = {
  host: "box.example",
  port: 22,
  user: "root",
  privateKey: "KEY",
  hostKey: { mode: "pinned", knownHostsLine: "box ssh-ed25519 AAAA" },
};

const DIR = { spec: { name: "x" } } as unknown as DataDir;

describe("boxDataDirPaths", () => {
  it("joins the install's data root with the dir's place under any root", () => {
    expect(
      boxDataDirPaths("website", "cache/site-feeds-staging", "a1.mp4"),
    ).toEqual({
      dir: "/srv/equin/website/data/cache/site-feeds-staging",
      file: "/srv/equin/website/data/cache/site-feeds-staging/a1.mp4",
      runUser: "svc-website",
    });
  });

  it("refuses a name or a relative path the remote shell would read", () => {
    for (const name of ["a b", "../x", "a;b", "$(id)", ".hidden", ""]) {
      expect(() => boxDataDirPaths("website", "cache/x", name)).toThrow();
    }
    expect(() => boxDataDirPaths("website", "../etc", "f")).toThrow();
    expect(() => boxDataDirPaths("website", "cache/a b", "f")).toThrow();
  });
});

describe("ensureBoxDirArgv", () => {
  it("makes the dir owned by the run user", () => {
    expect(ensureBoxDirArgv("/srv/d", "svc-w")).toEqual([
      "install",
      "-d",
      "-m",
      "750",
      "-o",
      "svc-w",
      "-g",
      "svc-w",
      "/srv/d",
    ]);
  });
});

function deps(over: Partial<UploadDeps>): UploadDeps {
  return {
    resolveDeployment: async () => ({
      kind: "ready",
      target: TARGET,
      loopbackPort: 9100,
      compositionId: "website",
    }),
    sshRun: async () => ({
      ok: true,
      stdout: "",
      stderr: "",
      learnedHostKey: null,
    }),
    sshUpload: async () => ({ ok: true, learnedHostKey: null }),
    copyLocal: async () => {
      throw new Error("no local copy for a real box");
    },
    relativeToDataRoot: () => "cache/site-feeds-staging",
    ...over,
  };
}

describe("uploadOverSsh", () => {
  it("makes the dir, then copies the file to its place in it", async () => {
    const steps: string[] = [];
    const answer = await uploadOverSsh(
      deps({
        sshRun: async (_t, argv) => {
          steps.push(argv.join(" "));
          return { ok: true, stdout: "", stderr: "", learnedHostKey: null };
        },
        sshUpload: async (_t, local, remote) => {
          steps.push(`scp ${local} ${remote}`);
          return { ok: true, learnedHostKey: null };
        },
      }),
      "dep-1",
      DIR,
      "/tmp/local.bin",
      "att.bin",
    );
    expect(answer).toEqual({ kind: "uploaded" });
    expect(steps).toEqual([
      "install -d -m 750 -o svc-website -g svc-website /srv/equin/website/data/cache/site-feeds-staging",
      "scp /tmp/local.bin /srv/equin/website/data/cache/site-feeds-staging/att.bin",
    ]);
  });

  it("stops at a failed mkdir, naming the SSH failure", async () => {
    let uploaded = false;
    const answer = await uploadOverSsh(
      deps({
        sshRun: async () => ({
          ok: false,
          kind: "command-failed",
          message: "install failed",
          stderr: "denied",
          exitCode: 1,
        }),
        sshUpload: async () => {
          uploaded = true;
          return { ok: true, learnedHostKey: null };
        },
      }),
      "dep-1",
      DIR,
      "/tmp/f",
      "f",
    );
    expect(answer).toEqual({
      kind: "ssh-failed",
      failure: "command-failed",
      message: "install failed",
      stderr: "denied",
    });
    expect(uploaded).toBe(false);
  });

  it("copies locally for a stand-in box, with no SSH", async () => {
    const copies: string[] = [];
    const answer = await uploadOverSsh(
      deps({
        resolveDeployment: async () => ({ kind: "this-instance" }),
        sshRun: async () => {
          throw new Error("no SSH");
        },
        copyLocal: async (from, _dir, name) => {
          copies.push(`${from} -> ${name}`);
        },
      }),
      "dep-1",
      DIR,
      "/tmp/f",
      "g",
    );
    expect(answer).toEqual({ kind: "uploaded" });
    expect(copies).toEqual(["/tmp/f -> g"]);
  });

  it("answers an unresolved deployment as is", async () => {
    expect(
      await uploadOverSsh(
        deps({ resolveDeployment: async () => ({ kind: "no-ssh-key" }) }),
        "dep-1",
        DIR,
        "/tmp/f",
        "g",
      ),
    ).toEqual({ kind: "no-ssh-key" });
  });
});
