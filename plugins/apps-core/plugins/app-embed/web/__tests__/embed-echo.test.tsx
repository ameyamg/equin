import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import {
  PluginProvider,
  type LoadedPlugin,
} from "@plugins/framework/plugins/web-sdk/core";
import { Apps } from "@plugins/apps-core/web";
import { useNavigate } from "@plugins/apps-core/plugins/tabs/web";
import { useRouteState } from "@plugins/primitives/plugins/pane/web";
import { ErrorBoundary } from "@plugins/primitives/plugins/error-boundary/web";
import { symbol } from "@plugins/ui/plugins/icons/core";
import { AppEmbed, type EmbedPlaceBinding } from "../components/app-embed";

vi.mock("@plugins/shell/plugins/notifications/web", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useToast: () => () => {},
}));

// An embed's moves reach its host as fast as the user makes them, while the
// host may tell it of each change late — a pane surface draws its route
// deferred, so on a slow device the host's DRAWN place trailed its moves by a
// render. The embed decides on what the host holds now: two quick app
// switches heard back late used to swap it between them for as long as the
// page stayed open (equin.ai's demo page, 22–42 commits/s with no input).

let go: (url: string) => void = () => {};
function capture(fn: (url: string) => void) {
  go = fn;
}
function Probe({ app }: { app: string }) {
  capture(useNavigate());
  const state = useRouteState();
  return (
    <div data-testid="at">
      {state.kind === "unresolved" ? `/${app}/${state.rawPath}` : `/${app}`}
    </div>
  );
}

const app = (id: string) =>
  Apps.App({
    app: { id, name: id, basePath: `/${id}`, icon: symbol("home") },
    component: () => <Probe app={id} />,
  });
const plugins = [
  {
    id: "embed-echo-slots",
    description: "the slots an embed reads",
    slots: { ...Apps, ...ErrorBoundary },
    contributions: [],
  },
  {
    id: "embed-echo-apps",
    description: "two tab apps and a surface-mode app",
    contributions: [
      app("one"),
      app("two"),
      Apps.App({
        app: {
          id: "desk",
          name: "Desk",
          basePath: "/desk",
          icon: symbol("home"),
        },
        surfaceMode: "desktop",
      }),
    ],
  },
] as unknown as LoadedPlugin[];

/** A runaway stops here, so a loop is a failed assertion, not a hung test. */
const RUNAWAY = 40;

/**
 * The host: the place it holds (a write lands at once), and the change
 * notices it owes the embed — handed over when the test says (`late`), or at
 * once.
 */
function host(seed: string, late: boolean) {
  let held: string | undefined = seed;
  const writes: string[] = [];
  const listeners = new Set<() => void>();
  let owed = 0;
  const notify = () => {
    if (late) owed += 1;
    else for (const l of [...listeners]) l();
  };
  const binding: EmbedPlaceBinding = {
    location: {
      read: () => held,
      subscribe: (l) => {
        listeners.add(l);
        return () => listeners.delete(l);
      },
    },
    onLocationChange: (url) => {
      if (url === held || writes.length >= RUNAWAY) return;
      writes.push(url);
      held = url;
      notify();
    },
    browserTabUrl: (at) => at,
  };
  return {
    binding,
    writes,
    held: () => held,
    /** The page's Back / Forward: the host moves by itself. */
    moveTo(url: string) {
      held = url;
      notify();
    },
    /** Hand over one owed notice, as a late draw would. */
    tellOne() {
      if (owed === 0) return false;
      owed -= 1;
      act(() => {
        for (const l of [...listeners]) l();
      });
      return true;
    },
  };
}

function mount(seed: string, late: boolean) {
  const h = host(seed, late);
  render(
    <PluginProvider
      plugins={plugins}
      composition={{ id: "embed-echo", home: "one" }}
    >
      <AppEmbed place={h.binding} />
    </PluginProvider>,
  );
  return h;
}
const move = (url: string) => act(() => go(url));
const at = () => screen.getByTestId("at").textContent;

afterEach(cleanup);

describe("an embed whose host tells it of changes late", () => {
  for (const [name, first, last] of [
    ["two places of one app", "/one/b", "/one/c"],
    ["two apps", "/two/b", "/one/c"],
    ["an app and back", "/two/b", "/one/a"],
  ] as const) {
    it(`${name}, in quick succession: comes to rest on the last`, () => {
      const h = mount("/one/a", true);
      move(first);
      move(last);
      while (h.tellOne()) {
        // every late notice, one commit apart
      }
      expect(h.writes).toEqual([first, last]);
      expect(at()).toBe(last);
      expect(h.held()).toBe(last);
    });
  }

  it("a move back to the place the host showed is written", () => {
    const h = mount("/one/a", true);
    move("/one/b");
    move("/one/a");
    expect(h.held()).toBe("/one/a");
  });

  it("the page's Back while notices are still owed: the embed follows it", () => {
    const h = mount("/one/a", true);
    move("/two/b");
    move("/one/c");
    h.moveTo("/two/b");
    while (h.tellOne()) {
      // every late notice, one commit apart
    }
    expect(at()).toBe("/two/b");
    expect(h.held()).toBe("/two/b");
  });
});

describe("an embed's report names the mode it moves into", () => {
  for (const [name, to] of [
    ["the same app", "/desk/one/b"],
    ["another app", "/desk/two/b"],
  ] as const) {
    it(`into a surface mode, ${name}: one place is written`, () => {
      const h = mount("/one/a", false);
      move(to);
      expect(h.writes).toEqual([to]);
    });
  }

  it("out of a surface mode: one place is written", () => {
    const h = mount("/desk/one/a", false);
    move("/two/b");
    expect(h.writes).toEqual(["/desk/two/b"]);
  });
});
