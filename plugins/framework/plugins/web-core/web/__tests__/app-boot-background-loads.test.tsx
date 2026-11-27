import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as WebSdkCore from "@plugins/framework/plugins/web-sdk/core";
import type * as Namespace from "@plugins/infra/plugins/namespace/core";

// The registry App.tsx boots from, replaced by a fake eager plugin per test
// that contributes one Core.Boot task (plus a Core.Root proving the app shows).
// Hoisted above every import, so the id is loaded here, not bound from the
// file's own (later) import.
const registry = await vi.hoisted(async () => {
  const { MAIN_COMPOSITION_ID } = await vi.importActual<typeof Namespace>(
    "@plugins/infra/plugins/namespace/core",
  );
  return {
    webEntries: [] as {
      pluginPath: string;
      id: string;
      loader: () => Promise<{ default: unknown }>;
      dependsOn: string[];
    }[],
    webScopedEntries: [],
    composition: { id: MAIN_COMPOSITION_ID, home: null },
  };
});
vi.mock("@composition-web-registry", () => registry);

vi.mock("@plugins/framework/plugins/web-sdk/core", async (importOriginal) => {
  const real = await importOriginal<typeof WebSdkCore>();
  return {
    ...real,
    partitionWebEntries: <T,>(entries: T[]) => ({
      eager: entries,
      deferred: [],
    }),
  };
});

const reported = vi.hoisted(() => [] as { message: string }[]);
vi.mock("@plugins/reports/web", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  report: (body: { message: string }) => {
    reported.push(body);
    return Promise.resolve(null);
  },
}));

import { cleanup, render, waitFor } from "@testing-library/react";
import { Core } from "@plugins/framework/plugins/web-sdk/core";
import { resetDeferredLoadStateForTests } from "@plugins/framework/plugins/web-sdk/core/testing";
import { NotificationsClient } from "@plugins/network/plugins/live/plugins/live-state/web/testing";
import {
  backgroundLoadsHeld,
  startBackgroundLoad,
} from "@plugins/primitives/plugins/networking/plugins/background-loads/core";
import App from "../App";

/**
 * The boot is what the visitor waits on: a background load (an idle code
 * preload) asked for while it runs waits until the first app frame has
 * committed, instead of sharing the link with the boot's own modules
 * (report-1795765021-3jqcwb). One test: the hold is the page's, taken once
 * when App.tsx evaluates.
 */

beforeEach(() => {
  resetDeferredLoadStateForTests();
  reported.length = 0;
  vi.spyOn(NotificationsClient.prototype, "connect").mockImplementation(
    () => {},
  );
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  resetDeferredLoadStateForTests();
  vi.restoreAllMocks();
});

describe("App — background loads during the boot", () => {
  it("holds them until the first app frame has committed", async () => {
    expect(backgroundLoadsHeld()).toBe(true);
    let finishBoot!: () => void;
    const booted = new Promise<void>((r) => (finishBoot = r));
    let started = false;
    registry.webEntries.length = 0;
    registry.webEntries.push({
      pluginPath: "shell/plugins/fake-boot",
      id: "shell.plugins.fake-boot",
      loader: async () => {
        // Asked for while the eager tier evaluates, as a lazy component's
        // `preload: "idle"` is.
        startBackgroundLoad(() => (started = true));
        return {
          default: {
            description: "fake",
            contributions: [
              Core.Boot({
                label: "Fake snapshot",
                ifUnavailable: "block",
                run: () => booted,
              }),
              Core.Root({
                component: () => <div data-testid="app">app</div>,
                scope: "page",
              }),
            ],
          },
        };
      },
      dependsOn: [],
    });
    const { container, findByTestId } = render(<App />);
    await waitFor(() => {
      expect(container.textContent).toContain("Fake snapshot");
    });
    expect(started).toBe(false);
    finishBoot();
    await findByTestId("app");
    await waitFor(() => expect(started).toBe(true));
    expect(backgroundLoadsHeld()).toBe(false);
  });
});
