import {
  afterEach,
  beforeAll,
  describe,
  expect,
  expectTypeOf,
  it,
} from "vitest";
import { cleanup, render } from "@testing-library/react";

import {
  PluginProvider,
  type LoadedPlugin,
} from "@plugins/framework/plugins/web-sdk/core";
import {
  Pane,
  parseUrl,
  setLiveStore,
  useSyncPaneRegistry,
  type PaneSlot,
} from "@plugins/primitives/plugins/pane/web";
import {
  impliedBy,
  relativeTo,
  sameAs,
  type ImpliedCodec,
  type RelativeSpelling,
} from "../implied";
import { buildRouteUrl, paneColumn } from "../pane";
import { defineApp, defineRoute } from "@plugins/primitives/plugins/pane/core";
import { defaultStore } from "../testing";
import { symbol } from "@plugins/ui/plugins/icons/core";

// A PANE CARRIES ITS WHOLE ADDRESS; THE URL OMITS WHAT POSITION IMPLIES.
//
// A satellite of a conversation carries the conversation it is about, a file
// preview its whole path. The URL leaves out (`sameAs`) or shortens
// (`relativeTo`) what the column to the left already says, and the parser
// fills it back from the same column — one codec, both directions. The
// property pinned throughout: `parseUrl(buildRouteUrl(route))` IS `route`,
// wherever the columns stand.

const app = defineApp({
  id: "implied-app",
  name: "Implied param test app",
  basePath: "/",
  icon: symbol("science"),
});

const convRoute = defineRoute({ id: "im-conv", segment: "c/:convId" });
const convPane = Pane.define({
  route: convRoute,
  app,
  useResolve: false,
  component: () => null,
});

/** A satellite of a conversation: about the one to its left unless it says. */
const summaryPane = Pane.define({
  route: defineRoute({ id: "im-summary", segment: "sum;conv" }),
  app,
  component: () => null,
  implied: { conv: impliedBy(convRoute, sameAs("convId")) },
});

/** The same, optional: a peek may be about no conversation at all. */
const peekPane = Pane.define({
  route: defineRoute({ id: "im-peek", segment: "peek/:file;conv" }),
  app,
  useResolve: false,
  component: () => null,
  implied: {
    conv: impliedBy(convRoute, sameAs("convId"), { optional: true }),
  },
});

/** A path spelling: `~` and `/` start a whole path, the rest is relative. */
const paths: RelativeSpelling = {
  within: (value, base) =>
    value.startsWith(base + "/") ? value.slice(base.length + 1) : undefined,
  join: (base, rel) => `${base}/${rel}`,
  isWhole: (w) => w.startsWith("/") || w === "~" || w.startsWith("~/"),
};

const folderRoute = defineRoute({ id: "im-folder", segment: "dir/:dir" });
const folderPane = Pane.define({
  route: folderRoute,
  app,
  useResolve: false,
  component: () => null,
});
const previewPane = Pane.define({
  route: defineRoute({ id: "im-preview", segment: "pv/:path" }),
  app,
  useResolve: false,
  component: () => null,
  implied: { path: impliedBy(folderRoute, relativeTo("dir", paths)) },
});

/** A codec that writes what it cannot read back. */
const lossy: ImpliedCodec<"convId"> = {
  fromParams: ["convId"],
  omits: true,
  shorten: () => undefined,
  expand: (written) => written,
};
const lossyPane = Pane.define({
  route: defineRoute({ id: "im-lossy", segment: "lossy;conv" }),
  app,
  component: () => null,
  implied: { conv: impliedBy(convRoute, lossy) },
});

const plugins = [
  {
    id: "implied-param-test-plugin",
    description: "implied params fixture",
    contributions: [
      Pane.Register({ pane: convPane }),
      Pane.Register({ pane: summaryPane }),
      Pane.Register({ pane: peekPane }),
      Pane.Register({ pane: folderPane }),
      Pane.Register({ pane: previewPane }),
      Pane.Register({ pane: lossyPane }),
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

afterEach(() => {
  setLiveStore(defaultStore);
});

type Shape = Array<{ paneId: string; params: Record<string, string> }>;

let nextId = 0;
const route = (shape: Shape): PaneSlot[] =>
  shape.map((s) => ({
    instanceId: nextId++,
    uuid: `u${nextId}`,
    paneId: s.paneId,
    params: s.params,
    options: {},
    hint: {},
  }));

function parsed(url: string): Shape | "unresolved" {
  const r = parseUrl(url, "/");
  if (r.status !== "matched") return "unresolved";
  return r.slots.map((s) => ({ paneId: s.paneId, params: s.params }));
}

/** The URL `shape` is written as — and that it reads back as `shape`. */
function roundTrip(shape: Shape): string {
  const url = buildRouteUrl(route(shape));
  expect(parsed(url)).toEqual(shape);
  return url;
}

const conv = (convId: string) => ({ paneId: "im-conv", params: { convId } });
const summary = (c: string) => ({ paneId: "im-summary", params: { conv: c } });
const folder = (dir: string) => ({ paneId: "im-folder", params: { dir } });
const preview = (path: string) => ({ paneId: "im-preview", params: { path } });

describe("sameAs: a satellite and the conversation it hangs off", () => {
  it("right after its conversation, the URL omits it", () => {
    expect(roundTrip([conv("A"), summary("A")])).toBe("/c/A/sum");
  });

  it("after ANOTHER conversation, it is written", () => {
    expect(roundTrip([conv("B"), summary("A")])).toBe("/c/B/sum;conv=A");
  });

  it("after two conversations, the nearest one implies it", () => {
    expect(roundTrip([conv("A"), conv("B"), summary("B")])).toBe(
      "/c/A/c/B/sum",
    );
    expect(roundTrip([conv("A"), conv("B"), summary("A")])).toBe(
      "/c/A/c/B/sum;conv=A",
    );
  });

  it("alone, it is written", () => {
    expect(roundTrip([summary("A")])).toBe("/sum;conv=A");
  });

  it("dragged left of its conversation, it is written", () => {
    expect(roundTrip([summary("A"), conv("A")])).toBe("/sum;conv=A/c/A");
  });

  it("a written value that equals the implied one reads the same", () => {
    expect(parsed("/c/A/sum;conv=A")).toEqual([conv("A"), summary("A")]);
  });

  it("required, it cannot stand with nothing to imply it", () => {
    expect(parsed("/sum")).toBe("unresolved");
    expect(() =>
      buildRouteUrl(route([{ paneId: "im-summary", params: {} }])),
    ).toThrow(/Missing param "conv"/);
  });

  it("keeps the embed tail on the last column", () => {
    const shape = [
      conv("A"),
      { paneId: "im-summary", params: { conv: "A", "view.embed": "/x/y" } },
    ];
    expect(roundTrip(shape)).toBe("/c/A/sum/at/x/y");
  });
});

describe("sameAs, optional", () => {
  it("absent alone is absent", () => {
    const shape = [{ paneId: "im-peek", params: { file: "f" } }];
    expect(roundTrip(shape)).toBe("/peek/f");
  });

  it("beside a conversation it is that conversation", () => {
    expect(parsed("/c/A/peek/f")).toEqual([
      conv("A"),
      { paneId: "im-peek", params: { file: "f", conv: "A" } },
    ]);
  });

  it("absent beside a conversation has no spelling, and says so", () => {
    expect(() =>
      buildRouteUrl(
        route([conv("A"), { paneId: "im-peek", params: { file: "f" } }]),
      ),
    ).toThrow(/im-peek.*"conv"/);
  });
});

describe("relativeTo: a preview and the folder it is in", () => {
  it("inside the folder to its left, the path is relative", () => {
    expect(roundTrip([folder("~/p"), preview("~/p/README.md")])).toBe(
      "/dir/~%2Fp/pv/README.md",
    );
    expect(roundTrip([folder("~/p"), preview("~/p/a/b.md")])).toBe(
      "/dir/~%2Fp/pv/a%2Fb.md",
    );
  });

  it("outside it, the path is whole", () => {
    expect(roundTrip([folder("~/p"), preview("/etc/hosts")])).toBe(
      "/dir/~%2Fp/pv/%2Fetc%2Fhosts",
    );
  });

  it("reordered left of the folder, the path is whole", () => {
    expect(roundTrip([preview("~/p/README.md"), folder("~/p")])).toBe(
      "/pv/~%2Fp%2FREADME.md/dir/~%2Fp",
    );
  });

  it("alone, the path is whole", () => {
    expect(roundTrip([preview("~/p/README.md")])).toBe("/pv/~%2Fp%2FREADME.md");
  });

  it("two folder / preview pairs each read their own folder", () => {
    expect(
      roundTrip([
        folder("~/a"),
        preview("~/a/f.md"),
        folder("~/b"),
        preview("~/b/g.md"),
      ]),
    ).toBe("/dir/~%2Fa/pv/f.md/dir/~%2Fb/pv/g.md");
  });

  it("a relative path with no folder to its left is no URL", () => {
    expect(parsed("/pv/README.md")).toBe("unresolved");
  });
});

describe("the writer", () => {
  it("throws on a codec whose spelling reads back as something else", () => {
    expect(() =>
      buildRouteUrl(
        route([conv("B"), { paneId: "im-lossy", params: { conv: "A" } }]),
      ),
    ).toThrow(/im-lossy.*"conv".*"A"/);
  });
});

describe("typing", () => {
  it("a required implied keyed param is required; an optional one is not", () => {
    expectTypeOf(summaryPane.useParams).returns.toEqualTypeOf<{
      conv: string;
    }>();
    expectTypeOf(peekPane.useParams).returns.toEqualTypeOf<{
      file: string;
      conv?: string;
    }>();
    // @ts-expect-error — the satellite must say what it is about
    paneColumn(summaryPane, {});
    paneColumn(peekPane, { file: "f" });
  });
});
