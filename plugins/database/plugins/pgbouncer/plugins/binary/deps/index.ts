import type { DepTarget } from "@plugins/infra/plugins/deps/deps";
import { defineDep } from "@plugins/infra/plugins/deps/deps";
import { npmPackageCopy } from "@plugins/infra/plugins/deps/plugins/package-copy/deps";

/** `@equin/pgbouncer-<platform>`, the package carrying this target's binary. */
function pgbouncerPackage(target: DepTarget): string {
  const tags: Record<string, Record<string, string>> = {
    darwin: { arm64: "darwin-arm64", x64: "darwin-x64" },
    linux: { arm64: "linux-arm64", x64: "linux-x64" },
  };
  const tag = tags[target.platform]?.[target.arch];
  if (tag === undefined) {
    throw new Error(
      `pgbouncer: no PgBouncer build for ${target.platform}/${target.arch}`,
    );
  }
  return `@equin/pgbouncer-${tag}`;
}

/**
 * The PgBouncer binary: a copy of this platform's `@equin/pgbouncer` package
 * outside the checkout, so a `bun install` that moves the package never
 * replaces the binary under the running daemon, and the next start does not
 * silently run a new version.
 *
 * Run by PgBouncer's start script on the install main declares, from its next
 * start, falling back to the last install it started on when that start
 * fails. A move of the package lands only once its smoke test has started it
 * on a throwaway socket.
 */
export const pgbouncerBinary = defineDep({
  id: "pgbouncer-binary",
  owner: "database/pgbouncer/binary",
  description:
    "The PgBouncer binary the gateway runs the pooler from, copied out of main's checkout",
  sizeHint: "≈0.5 MB",
  source: npmPackageCopy({
    workspace: "plugins/database/plugins/pgbouncer",
    package: pgbouncerPackage,
    admission: {
      none: "PgBouncer's start waits on it (a one-file copy), and that start must never queue behind the background lane",
    },
  }),
  daemon: {
    holder: "machine-pgbouncer",
    appliesAt: "PgBouncer's next start (a reattach keeps the running daemon)",
  },
  smoke: {
    name: "pgbouncer-binary starts on a throwaway socket",
    argv: [
      "./equin",
      "run",
      "plugins/database/plugins/pgbouncer/scripts/smoke.ts",
    ],
    timeoutMs: 5 * 60_000,
  },
});

export default [pgbouncerBinary];
