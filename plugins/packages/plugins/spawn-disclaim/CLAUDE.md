# spawn-disclaim

Makes a spawned program its own **responsible process** on macOS. TCC (the
permission prompts: Automation, Files & Folders, …) charges the responsible
process — by default the launchd-started root of the tree, which for every
agent is the gateway (launchd → gateway → backend → `bun agent.ts` → `claude`).
So every agent's prompt said "gateway", and one Allow covered every agent.
Run through `disclaim-exec`, claude is responsible for itself and everything it
starts. Design: `research/2026-10-24-global-macos-permissions.md` §4.

The prompt names the responsible process's executable FILE (claude has no
bundle), and TCC keys a bundle-less client's decisions by that path too
(measured 2026-10-24: an Allow given to a renamed hardlink of the binary did
not reach the original path). So `conversations/runtime-sdk` runs claude
through a COPY of this helper named for the conversation
(`equin · <conv-id> · <title>`, `machine/internal/named-launcher.ts`):

    disclaim-exec <named copy> --exec-named <claude> [args…]

The disclaim makes the named copy the responsible process; the copy gives the
process its own file name as its LaunchServices display name (what Activity
Monitor lists) and becomes claude with a plain `execv`. TCC keeps charging the
copy's path after that exec (measured 2026-11-24 with the real claude: tccd's
`responsible_path` is the copy, `binary_path` claude, and the prompt is for the
copy). So the prompt says which agent asks, each conversation's grants are its
own, and the only per-conversation file macOS has to scan is 35 KB (~0.15 s)
instead of a 344 MB clone of claude (~3.3 s).

- `native/disclaim-exec.c` — `disclaim-exec <program> [args…]`:
  `posix_spawnattr_init` → `responsibility_spawnattrs_setdisclaim(&a, 1)` →
  `POSIX_SPAWN_SETEXEC` → `posix_spawnp`. SETEXEC replaces the helper in place,
  so the pid, stdio, environment, signal dispositions and darwinbg tier are the
  program's own — nothing to forward, and the SDK's pid / kill handling and
  `pgrep -P` liveness see claude exactly as before. Any failure (a missing
  symbol, a spawn error) is one `disclaim-exec: …` line on stderr and exit 127:
  claude never starts, loudly. `--print-responsible [pid]` prints who is
  responsible for a pid (`responsibility_get_pid_responsible_for_pid`), for
  verification.
- `<named copy> --exec-named <program> [args…]` (same source, second mode):
  the display name through LaunchServices' private SPI (`_LSApplicationCheckIn`,
  `_LSSetApplicationInformationItem` with `_kLSDisplayNameKey` — what Chromium
  names its helpers with), looked up with `dlsym` at run time, then `execv`
  with argv[0] kept (so `ps` shows the name). The registration is the pid's,
  so it survives the exec; background-only, no Dock icon. A name that cannot
  be set is one stderr line and the program still runs: the name is what a
  list shows, not who is charged. `top` reads the kernel's name (`claude`).
- `disclaimExec` (`deps/` barrel) — the compiled helper, a `build` dependency:
  identity = the `.c` hash + `cc --version` + target. macOS only (arm64 / x64,
  `cc -arch`), `admission: { none }` (one tiny compile), `bundle: { optional }`.
- `execNamedArgv(named | null, argv)` (`core/`) — `[named, "--exec-named",
  …argv]`, to wrap in `disclaimArgv`.
- `disclaimArgv(helper | null, argv)` / `spawnDisclaimWanted()` (`core/`,
  import-free) — `[helper, …argv]` on macOS, `argv` unchanged with no helper,
  off macOS, or under `EQUIN_NO_SPAWN_DISCLAIM=1`.

Which process is responsible and how much CPU it gets are separate settings,
so this is a sibling of `spawn-priority`, not a `spawnAtTier` tier.

## The one user

`conversations/runtime-sdk`: its machine half requests the dependency at boot
(`requestDisclaimHelper`, off the boot path) and resolves it at every agent
start (`resolveDisclaimExec`: `readyNow`, else at most 5 s on the install, else
a `SdkAgentDisclaimUnavailable` report and a launch without it — an agent never
fails for this). The path rides in `launch.json` (`disclaimExec`, rewritten by
every start), and `bin/agent.ts`'s `spawnClaudeCodeProcess` spawns
`disclaimArgv(helper, execNamedArgv(namedLauncher, …))`. Backends themselves stay attributed to the gateway (right
for app-level grants), and non-interactive `claude -p` probes are not wrapped.

## Things that look wrong and are not

- **Private SPI.** Both symbols are weak-imported from libSystem
  (re-exported from libquarantine; the macOS SDK's `.tbd` lists them, no header
  declares them). Measured 2026-10-24 on macOS 26.4: a disclaimed
  process's children report it as their responsible process; a plain one's
  report an ancestor. A macOS
  that drops them makes every agent start fail with the stderr line above —
  set `EQUIN_NO_SPAWN_DISCLAIM=1` to launch without while it is fixed.
- **The escape hatch is read by the backend, not the agent.** The agent's
  environment is an allowlist (`agent-launch`), so the variable never reaches
  it; the backend resolves `disclaimExec` to null instead. It reaches the
  backend through the gateway's `-child-env` (`launcher/core` runtime-env).
- **The named copy is ad-hoc signed** (the linker's signature), so TCC ties a
  grant to its exact bytes: a rebuild that changes them (this source, the
  compiler) makes every conversation ask again. Keep changes here rare.
- **Verify through a child.** A process whose responsible ancestor has exited
  reads as responsible for itself, so "the disclaimed process reports its own
  pid" proves nothing alone; the tests check that a disclaimed program's child
  names it.
- **`launchctl procinfo <pid>`** (which would also show responsibility) needs
  root — use `--print-responsible`.
- **A release bundle carries the helper but its backend cannot find it** (no
  backend reads the bundle's deps yet), so released apps' agents still prompt as
  the gateway, reported once per launch. Follow-up.

<!-- AUTOGENERATED:BEGIN — do not edit; regenerated by `./equin build` -->

## Plugin reference

- Core:
  - Uses: `infra/launcher/env-names.readEnv`
  - Exports (values):
    - `disclaimArgv`
    - `execNamedArgv`
    - `spawnDisclaimWanted`
- Deps:
  - Uses:
    - `infra/deps.defineDep`
    - `infra/deps/build.build`
  - Exports (values): `disclaimExec`
- Cross-plugin:
  - Imported by: `conversations/runtime-sdk`
- Structure:
  - Non-standard folders: `native/`

<!-- AUTOGENERATED:END -->
