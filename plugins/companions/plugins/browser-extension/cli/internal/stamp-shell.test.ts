import { describe, expect, test } from "bun:test";
import { SHELL_BUILD_PLACEHOLDER, stampShell } from "./stamp-shell";

const P = SHELL_BUILD_PLACEHOLDER;

function shell(over: Record<string, string> = {}): Map<string, Buffer> {
  const files: Record<string, string> = {
    "manifest.json": JSON.stringify({ name: "equin", version_name: P }),
    "popup.js": `const b="${P}";`,
    "background.js": `const b="${P}";`,
    "offscreen.js": `const b="${P}";`,
    "content.js": `(()=>{const b="${P}"})();`,
    "icon-16.png": "\u0089PNG",
    ...over,
  };
  return new Map(
    Object.entries(files).map(([name, text]) => [name, Buffer.from(text)]),
  );
}

describe("stampShell", () => {
  test("the manifest and every script carry the same build", () => {
    const { digest, files } = stampShell(shell());
    const manifest = JSON.parse(String(files.get("manifest.json"))) as {
      version_name: string;
    };
    expect(manifest.version_name).toBe(digest);
    for (const name of [
      "popup.js",
      "background.js",
      "offscreen.js",
      "content.js",
    ])
      expect(String(files.get(name))).toContain(digest);
    for (const [, bytes] of files) expect(String(bytes)).not.toContain(P);
  });

  // The 2026-11-25 skew: a build that changed only the offscreen recorder
  // kept the manifest's version, so Chrome kept the old worker and nothing
  // asked it to reload.
  test("a change to any one script is a new manifest", () => {
    const before = stampShell(shell()).digest;
    for (const name of [
      "background.js",
      "offscreen.js",
      "content.js",
      "popup.js",
    ])
      expect(
        stampShell(shell({ [name]: `const b="${P}";/* changed */` })).digest,
      ).not.toBe(before);
  });

  test("the same files are the same build, whatever their order", () => {
    const files = [...shell()];
    expect(stampShell(new Map(files.reverse())).digest).toBe(
      stampShell(shell()).digest,
    );
  });

  test("a manifest without the placeholder is refused", () => {
    expect(() =>
      stampShell(
        shell({ "manifest.json": JSON.stringify({ version_name: "1.0" }) }),
      ),
    ).toThrow(/version_name/);
  });
});
