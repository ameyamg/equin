import { describe, expect, test } from "bun:test";
import { declaredDeps, hostTarget } from "@plugins/infra/plugins/deps/deps";
import { declaredDepSmokes } from "./dep-smokes";
import type { UpdaterMove } from "./runner";

const move = (updater: string, name: string): UpdaterMove => ({
  updater,
  name,
  from: "1.0.0",
  to: "1.1.0",
});

describe("declaredDepSmokes", () => {
  test("a move of a dependency's source runs that dependency's smoke test, and nothing else does", async () => {
    const withSmoke = (await declaredDeps()).filter(
      (d) => d.smoke !== null && d.source.movedAs !== undefined,
    );
    expect(withSmoke.length).toBeGreaterThan(0);
    for (const dep of withSmoke) {
      const name = dep.source.movedAs!(hostTarget());
      const smokes = await declaredDepSmokes([move(dep.source.updater!, name)]);
      expect(smokes.map((s) => s.name)).toContain(dep.smoke!.name);
      // The same name under another updater is another package.
      expect(
        (await declaredDepSmokes([move("not-an-updater", name)])).map(
          (s) => s.name,
        ),
      ).not.toContain(dep.smoke!.name);
    }
    expect(await declaredDepSmokes([move("npm", "left-pad")])).toEqual([]);
  });
});
