import { declaredDeps, hostTarget } from "@plugins/infra/plugins/deps/deps";
import type { UpdaterSmoke } from "../../core";
import type { UpdaterMove } from "./runner";

/**
 * The smoke test of every declared dependency one of `moves` touches: a
 * dependency whose source's updater moved it under the name it is moved as
 * on this host (`DepSource.movedAs` — an npm package copy's package name).
 * Generic over the declared set: a dependency adds a smoke test by declaring
 * one (`defineDep({ smoke })`), naming nothing here.
 */
export async function declaredDepSmokes(
  moves: readonly UpdaterMove[],
): Promise<UpdaterSmoke[]> {
  const target = hostTarget();
  return (await declaredDeps()).flatMap((dep) => {
    const { smoke, source } = dep;
    if (smoke === null || source.movedAs === undefined) return [];
    const name = source.movedAs(target);
    const moved = moves.some(
      (m) => m.updater === source.updater && m.name === name,
    );
    return moved
      ? [
          {
            name: smoke.name,
            argv: [...smoke.argv],
            timeoutMs: smoke.timeoutMs,
          },
        ]
      : [];
  });
}
