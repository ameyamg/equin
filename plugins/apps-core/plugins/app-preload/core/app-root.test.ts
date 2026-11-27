import { describe, expect, test } from "bun:test";
import { appRootOf } from "./app-root";

describe("appRootOf", () => {
  test("an app's own and nested plugins share its root", () => {
    expect(appRootOf("apps/plugins/website/plugins/shell", new Map())).toBe(
      "apps/plugins/website/",
    );
    expect(
      appRootOf("apps/plugins/website/plugins/pages/plugins/story", new Map()),
    ).toBe("apps/plugins/website/");
  });
  test("a plugin outside every app has none", () => {
    expect(appRootOf("menu-bar", new Map())).toBeNull();
    expect(appRootOf("apps-core/plugins/layout", new Map())).toBeNull();
    expect(appRootOf("apps", new Map())).toBeNull();
  });
});

describe("appRootOf: hosted plugins", () => {
  test("a plugin the hosts name is that app's code, whatever its folder", () => {
    const hosts = new Map([
      ["apps/plugins/website/plugins/isle-building", "apps/plugins/isle/"],
    ]);
    expect(appRootOf("apps/plugins/website/plugins/isle-building", hosts)).toBe(
      "apps/plugins/isle/",
    );
    expect(appRootOf("apps/plugins/website/plugins/landing", hosts)).toBe(
      "apps/plugins/website/",
    );
  });
});
