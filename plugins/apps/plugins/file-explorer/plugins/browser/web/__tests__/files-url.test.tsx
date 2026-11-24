import { beforeAll, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";

import {
  PluginProvider,
  type LoadedPlugin,
} from "@plugins/framework/plugins/web-sdk/core";
import {
  Pane,
  createPaneStore,
  parseUrl,
  useSyncPaneRegistry,
  type PaneSlot,
} from "@plugins/primitives/plugins/pane/web";
import {
  filePreviewBesidePane,
  filesFolderPane,
  filesHomePane,
  filesPreviewPane,
} from "../panes";

// THE FILES URL: each column its whole address, the preview's path written
// relative to the folder column to its LEFT when the file is inside it.
//
// The real panes, through the pane primitive's writer (`routeUrl`) and reader
// (`parseUrl`): every route below writes the URL shown, and that URL reads
// back as the same route.

const BASE = "/files";
const FOLDER = "files-at";
const PREVIEW = "files-preview-path";

const plugins = [
  {
    id: "files-url-test-plugin",
    description: "the Files panes",
    contributions: [
      Pane.Register({ pane: filesHomePane }),
      Pane.Register({ pane: filesFolderPane }),
      Pane.Register({ pane: filesPreviewPane }),
      Pane.Register({ pane: filePreviewBesidePane }),
    ],
  } as unknown as LoadedPlugin,
];

function RegistrySync() {
  useSyncPaneRegistry();
  return null;
}

beforeAll(() => {
  render(
    <PluginProvider plugins={plugins}>
      <RegistrySync />
    </PluginProvider>,
  );
  cleanup();
});

type Column = [paneId: string, params: Record<string, string>];

function slotsOf(columns: Column[]): PaneSlot[] {
  return columns.map(([paneId, params], i) => ({
    instanceId: i + 1,
    uuid: `u${i}`,
    paneId,
    params,
    options: {},
    hint: {},
  }));
}

function urlOf(columns: Column[]): string {
  const store = createPaneStore({ live: false });
  store.setBasePath(BASE);
  return store.routeUrl(slotsOf(columns));
}

function routeOf(url: string): Column[] | "unresolved" {
  const parsed = parseUrl(url.slice(BASE.length), BASE);
  if (parsed.status !== "matched") return "unresolved";
  return parsed.slots.map((s) => [s.paneId, s.params]);
}

const cases: Array<{ name: string; route: Column[]; url: string }> = [
  {
    name: "a file in the folder beside it: relative",
    route: [
      [FOLDER, { dir: "~/p" }],
      [PREVIEW, { path: "~/p/README.md" }],
    ],
    url: "/files/browse/~%2Fp/preview/README.md",
  },
  {
    name: "a file deeper in it: relative, one segment",
    route: [
      [FOLDER, { dir: "~/p" }],
      [PREVIEW, { path: "~/p/sub/a.md" }],
    ],
    url: "/files/browse/~%2Fp/preview/sub%2Fa.md",
  },
  {
    name: "a file outside the folder: whole",
    route: [
      [FOLDER, { dir: "~/p" }],
      [PREVIEW, { path: "/etc/hosts" }],
    ],
    url: "/files/browse/~%2Fp/preview/%2Fetc%2Fhosts",
  },
  {
    name: "a file in the filesystem root's folder",
    route: [
      [FOLDER, { dir: "/" }],
      [PREVIEW, { path: "/etc" }],
    ],
    url: "/files/browse/%2F/preview/etc",
  },
  {
    name: "a file whose relative spelling would read as whole: whole",
    route: [
      [FOLDER, { dir: "~" }],
      [PREVIEW, { path: "~/~/x" }],
    ],
    url: "/files/browse/~/preview/~%2F~%2Fx",
  },
  {
    name: "the preview alone: whole",
    route: [[PREVIEW, { path: "~/p/README.md" }]],
    url: "/files/preview/~%2Fp%2FREADME.md",
  },
  {
    name: "the preview reordered left of its folder: whole",
    route: [
      [PREVIEW, { path: "~/p/README.md" }],
      [FOLDER, { dir: "~/p" }],
    ],
    url: "/files/preview/~%2Fp%2FREADME.md/browse/~%2Fp",
  },
  {
    name: "beside a second folder: relative to the nearest one to its left",
    route: [
      [FOLDER, { dir: "~/a" }],
      [PREVIEW, { path: "~/a/x.md" }],
      [FOLDER, { dir: "~/b" }],
      [PREVIEW, { path: "~/a/y.md" }],
    ],
    url: "/files/browse/~%2Fa/preview/x.md/browse/~%2Fb/preview/~%2Fa%2Fy.md",
  },
  {
    name: "another file system: `;fs` on each column",
    route: [
      [FOLDER, { dir: "~", fs: "browser" }],
      [PREVIEW, { path: "~/This week.md", fs: "browser" }],
    ],
    url: "/files/browse/~;fs=browser/preview/This%20week.md;fs=browser",
  },
];

describe("Files URLs round-trip", () => {
  for (const c of cases) {
    it(c.name, () => {
      expect(urlOf(c.route)).toBe(c.url);
      expect(routeOf(c.url)).toEqual(c.route);
    });
  }

  it("the whole-path spelling written before still reads as the same route", () => {
    expect(routeOf("/files/browse/~%2Fp/preview/~%2Fp%2FREADME.md")).toEqual([
      [FOLDER, { dir: "~/p" }],
      [PREVIEW, { path: "~/p/README.md" }],
    ]);
  });

  it("a relative path with no folder to its left is no Files route", () => {
    expect(routeOf("/files/preview/README.md")).toBe("unresolved");
  });
});
