export const GIT = Bun.which("git") ?? "git";
export const PGREP = Bun.which("pgrep") ?? "pgrep";
export const PS = Bun.which("ps") ?? "ps";
export const LSOF = Bun.which("lsof") ?? "/usr/sbin/lsof";
/** macOS `sample`: a native stack sample of a running process. */
export const SAMPLE = Bun.which("sample") ?? "sample";
/**
 * `sysctl`: reads kernel state (e.g. `kern.waketime`). In /usr/sbin, which an
 * agent's PATH may not hold, so looked up there too.
 */
export const SYSCTL =
  Bun.which("sysctl", { PATH: `${process.env.PATH ?? ""}:/usr/sbin:/sbin` }) ??
  "/usr/sbin/sysctl";
/** `mkfifo`: makes a named pipe. */
export const MKFIFO = Bun.which("mkfifo") ?? "mkfifo";
/**
 * macOS's own `trash` (macOS 15+): moves a path to the Trash the Finder's way,
 * so Put Back works. Looked up in the system's own bin folder only, never a
 * same-named tool on PATH; `null` where it is not there (older macOS, Linux).
 */
export const MACOS_TRASH: string | null = Bun.which("trash", {
  PATH: "/usr/bin",
});
/**
 * The system's `zip` (Info-ZIP, shipped with macOS): what Compress builds a
 * .zip with. Looked up in the system's own bin folder only; `null` where it is
 * not there.
 */
export const SYSTEM_ZIP: string | null = Bun.which("zip", { PATH: "/usr/bin" });
