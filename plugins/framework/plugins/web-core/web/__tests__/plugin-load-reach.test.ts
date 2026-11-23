import { afterEach, describe, expect, test, vi } from "vitest";
import { loadPlugins } from "@plugins/framework/plugins/web-sdk/core";

// A chunk the browser dropped while the page was hidden / offline / asleep / leaving is
// loaded again once the page is back (web-sdk's page-reach); one that failed
// while the page kept its reach fails at once, as before.

let visibility: DocumentVisibilityState = "visible";
vi.spyOn(document, "visibilityState", "get").mockImplementation(
  () => visibility,
);

function setVisibility(next: DocumentVisibilityState): void {
  visibility = next;
  document.dispatchEvent(new Event("visibilitychange"));
}

const lost = () => new TypeError("Failed to fetch dynamically imported module");

afterEach(() => {
  setVisibility("visible");
});

describe("loadPlugins across a loss of reach", () => {
  test("a failure while the page stayed visible and online fails at once", async () => {
    const loader = vi.fn(() => Promise.reject(lost()));
    const { plugins, errors } = await loadPlugins([
      { pluginPath: "a", id: "a", loader },
    ]);
    expect(plugins).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  test("a failure after the tab was hidden is loaded again once it is visible", async () => {
    let calls = 0;
    const loader = vi.fn(() => {
      calls++;
      if (calls === 1) {
        // The phone backgrounds the browser mid-download.
        setVisibility("hidden");
        return Promise.reject(lost());
      }
      return Promise.resolve({ default: { description: "a" } });
    });
    const result = loadPlugins([{ pluginPath: "a", id: "a", loader }]);
    await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(1));
    // Still hidden: nothing asked again, nothing failed.
    await Promise.resolve();
    expect(loader).toHaveBeenCalledTimes(1);
    setVisibility("visible");
    const { plugins, errors } = await result;
    expect(errors).toHaveLength(0);
    expect(plugins).toHaveLength(1);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  test("a failure after the device slept mid-load is loaded again (no event marks a sleep)", async () => {
    // The lid closes with the tab in front: still visible and online, but the
    // wall clock runs on while the performance timeline pauses.
    const realNow = Date.now.bind(Date);
    let slept = 0;
    const spy = vi
      .spyOn(Date, "now")
      .mockImplementation(() => realNow() + slept);
    try {
      let calls = 0;
      const loader = vi.fn(() => {
        calls++;
        if (calls === 1) {
          slept = 39 * 60_000;
          return Promise.reject(lost());
        }
        return Promise.resolve({ default: { description: "a" } });
      });
      const { plugins, errors } = await loadPlugins([
        { pluginPath: "a", id: "a", loader },
      ]);
      expect(errors).toHaveLength(0);
      expect(plugins).toHaveLength(1);
      expect(loader).toHaveBeenCalledTimes(2);
    } finally {
      spy.mockRestore();
    }
  });

  test("a load that fails again with the page back is a failure", async () => {
    let calls = 0;
    const loader = vi.fn(() => {
      calls++;
      if (calls === 1) setVisibility("hidden");
      return Promise.reject(lost());
    });
    const result = loadPlugins([{ pluginPath: "a", id: "a", loader }]);
    await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(1));
    setVisibility("visible");
    const { errors } = await result;
    expect(errors).toHaveLength(1);
    expect(errors[0]!.failure).toBe("fetch");
    expect(loader).toHaveBeenCalledTimes(2);
  });

  // The network explains only a fetch failure. A graph that arrived and does
  // not link (or a module that threw) is asked again for nothing — in Firefox
  // the retry of a link failure inside an import cycle answers "Module
  // function declarations have already been instantiated" (equin.ai,
  // 2026-11-22), hiding the real missing export.
  test.each([
    [
      "link",
      new SyntaxError(
        "The requested module 'https://x/a.js' doesn't provide an export named: 'init_a'",
      ),
    ],
    ["other", new TypeError("x is not a function")],
  ] as const)(
    "a %s failure after the tab was hidden fails at once, never asked again",
    async (failure, error) => {
      const loader = vi.fn(() => {
        setVisibility("hidden");
        return Promise.reject(error);
      });
      const { errors } = await loadPlugins([
        { pluginPath: "a", id: "a", loader },
      ]);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.failure).toBe(failure);
      expect(loader).toHaveBeenCalledTimes(1);
    },
  );
});
