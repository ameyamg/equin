import { afterEach, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  assertHostPlatformPackages,
  findMissingPlatformPackages,
  type HostPlatform,
} from "./host-platform-packages";

const DARWIN_ARM: HostPlatform = {
  os: "darwin",
  cpu: "arm64",
  libc: undefined,
};
const LINUX_GLIBC: HostPlatform = { os: "linux", cpu: "x64", libc: "glibc" };

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function write(path: string, body: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof body === "string" ? body : JSON.stringify(body));
}

/** An isolated-linker install, as bun lays it out: packages under node_modules/.bun, linked into their dependents. */
function installPackage(
  root: string,
  name: string,
  version: string,
  manifest: Record<string, unknown> = {},
): string {
  const store = join(
    root,
    "node_modules",
    ".bun",
    `${name.replace("/", "+")}@${version}`,
    "node_modules",
    name,
  );
  write(join(store, "package.json"), { name, version, ...manifest });
  return store;
}

function link(fromDir: string, name: string, target: string): void {
  const at = join(fromDir, "node_modules", name);
  mkdirSync(dirname(at), { recursive: true });
  symlinkSync(target, at);
}

/**
 * A checkout with one workspace declaring per-platform optional binaries
 * (like database/pgbouncer) and one npm package doing the same (like
 * @napi-rs/keyring). Only the darwin-arm64 binaries are installed.
 */
function makeCheckout(opts: {
  installWorkspaceBinary: boolean;
  installNestedBinary: boolean;
}): string {
  const root = mkdtempSync(join(tmpdir(), "host-platform-packages-"));
  dirs.push(root);
  write(
    join(root, "bun.lock"),
    `{
  "lockfileVersion": 1,
  "workspaces": {
    "": { "name": "repo", "dependencies": { "keyring": "^1.0.0" } },
    "workspaces/bouncer": {
      "name": "@x/plugin-bouncer",
      "optionalDependencies": { "@x/bouncer-darwin-arm64": "^1.0.0", "@x/bouncer-linux-x64": "^1.0.0" },
    },
  },
  "packages": {
    "@x/plugin-bouncer": ["@x/plugin-bouncer@workspace:workspaces/bouncer"],
    "@x/bouncer-darwin-arm64": ["@x/bouncer-darwin-arm64@1.0.1", "", { "os": "darwin", "cpu": "arm64" }, "sha512-a"],
    "@x/bouncer-linux-x64": ["@x/bouncer-linux-x64@1.0.1", "", { "os": "linux", "cpu": "x64" }, "sha512-b"],
    "keyring": ["keyring@1.0.0", "", { "optionalDependencies": { "keyring-darwin-arm64": "1.0.0", "keyring-linux-x64-musl": "1.0.0" } }, "sha512-c"],
    "keyring-darwin-arm64": ["keyring-darwin-arm64@1.0.0", "", { "os": "darwin", "cpu": "arm64" }, "sha512-d"],
    "keyring-linux-x64-musl": ["keyring-linux-x64-musl@1.0.0", "", { "os": "linux", "cpu": "x64", "libc": "musl" }, "sha512-e"],
  },
}
`,
  );
  const ws = join(root, "workspaces", "bouncer");
  write(join(ws, "package.json"), { name: "@x/plugin-bouncer" });
  if (opts.installWorkspaceBinary) {
    link(
      ws,
      "@x/bouncer-darwin-arm64",
      installPackage(root, "@x/bouncer-darwin-arm64", "1.0.1"),
    );
  }
  const keyring = installPackage(root, "keyring", "1.0.0", {
    optionalDependencies: {
      "keyring-darwin-arm64": "1.0.0",
      "keyring-linux-x64-musl": "1.0.0",
    },
  });
  link(root, "keyring", keyring);
  if (opts.installNestedBinary) {
    // bun links a package's dependencies beside it in its store entry.
    link(
      join(keyring, "..", ".."),
      "keyring-darwin-arm64",
      installPackage(root, "keyring-darwin-arm64", "1.0.0"),
    );
  }
  return root;
}

test("a whole install has nothing missing for the host it was made on", () => {
  const root = makeCheckout({
    installWorkspaceBinary: true,
    installNestedBinary: true,
  });
  expect(findMissingPlatformPackages(root, DARWIN_ARM)).toEqual([]);
});

test("a workspace's own platform binary that failed to fetch is named", () => {
  const root = makeCheckout({
    installWorkspaceBinary: false,
    installNestedBinary: true,
  });
  expect(findMissingPlatformPackages(root, DARWIN_ARM)).toEqual([
    {
      name: "@x/bouncer-darwin-arm64",
      declaredBy: "workspaces/bouncer",
      constraints: "os darwin, cpu arm64",
    },
  ]);
});

test("an npm package's platform binary that failed to fetch is named", () => {
  const root = makeCheckout({
    installWorkspaceBinary: true,
    installNestedBinary: false,
  });
  const missing = findMissingPlatformPackages(root, DARWIN_ARM);
  expect(missing.map((m) => m.name)).toEqual(["keyring-darwin-arm64"]);
});

test("os, cpu and libc decide which binaries a host needs", () => {
  const root = makeCheckout({
    installWorkspaceBinary: true,
    installNestedBinary: true,
  });
  // On linux-x64-glibc nothing of its own was installed, but the musl build is not its.
  expect(
    findMissingPlatformPackages(root, LINUX_GLIBC).map((m) => m.name),
  ).toEqual(["@x/bouncer-linux-x64"]);
  expect(
    findMissingPlatformPackages(root, {
      os: "linux",
      cpu: "x64",
      libc: "musl",
    }).map((m) => m.name),
  ).toEqual(["@x/bouncer-linux-x64", "keyring-linux-x64-musl"]);
});

test("the assert throws a message naming the package and the install phase", () => {
  const root = makeCheckout({
    installWorkspaceBinary: false,
    installNestedBinary: true,
  });
  expect(() => assertHostPlatformPackages(root, DARWIN_ARM)).toThrow(
    /dependency install INCOMPLETE[\s\S]*@x\/bouncer-darwin-arm64 \(os darwin, cpu arm64\)/,
  );
  const whole = makeCheckout({
    installWorkspaceBinary: true,
    installNestedBinary: true,
  });
  expect(() => assertHostPlatformPackages(whole, DARWIN_ARM)).not.toThrow();
});
