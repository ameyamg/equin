// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { isMutedScriptError } from "../internal/muted-error";

const report = vi.fn((_body: unknown) => Promise.resolve(null));
vi.mock("@plugins/reports/web", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  report,
}));

const { CrashCollector } = await import("../components/crash-collector");

/** The event a browser dispatches for a muted cross-origin script's error. */
const muted = () =>
  new ErrorEvent("error", {
    message: "Script error.",
    filename: "",
    lineno: 0,
    colno: 0,
    error: null,
  });

describe("isMutedScriptError", () => {
  it("recognises the browser's muted shape", () => {
    expect(isMutedScriptError(muted())).toBe(true);
    // Firefox may keep the script's URL.
    expect(
      isMutedScriptError(
        new ErrorEvent("error", {
          message: "Script error.",
          filename: "https://ext.example/inject.js",
          error: null,
        }),
      ),
    ).toBe(true);
    // jsdom leaves `error` undefined when the init omits it.
    expect(
      isMutedScriptError(new ErrorEvent("error", { message: "Script error." })),
    ).toBe(true);
  });

  it("is not fooled by anything that carries more than the muted shape", () => {
    // Our own code: an Error object.
    expect(
      isMutedScriptError(
        new ErrorEvent("error", {
          message: "Script error.",
          error: new Error("Script error."),
        }),
      ),
    ).toBe(false);
    // A line: not muted.
    expect(
      isMutedScriptError(
        new ErrorEvent("error", {
          message: "Script error.",
          filename: "https://equin.ai/artifacts/x.js",
          lineno: 3,
        }),
      ),
    ).toBe(false);
    // Another stackless message.
    expect(
      isMutedScriptError(new ErrorEvent("error", { message: "boom" })),
    ).toBe(false);
  });
});

describe("CrashCollector", () => {
  afterEach(() => {
    cleanup();
    report.mockClear();
    document.querySelectorAll("script[data-test]").forEach((s) => s.remove());
  });

  it("leaves a muted error unjudged while the page holds a cross-origin library", () => {
    // Our call into it may be what threw (a destroyed YouTube player).
    const lib = document.createElement("script");
    lib.dataset.test = "";
    lib.setAttribute("src", "https://www.youtube.com/iframe_api");
    document.head.appendChild(lib);
    render(<CrashCollector />);
    window.dispatchEvent(muted());
    expect(
      (report.mock.calls[0]![0] as { data: object }).data,
    ).not.toHaveProperty("codeOrigin");
  });

  it("judges a muted error foreign beside our own same-origin scripts", () => {
    const own = document.createElement("script");
    own.dataset.test = "";
    own.type = "module";
    own.setAttribute("src", "/artifacts/chunk.x/index.js");
    document.head.appendChild(own);
    render(<CrashCollector />);
    window.dispatchEvent(muted());
    expect(report.mock.calls[0]![0]).toMatchObject({
      data: { codeOrigin: "foreign" },
    });
  });

  it("files a muted script error as not our code", () => {
    render(<CrashCollector />);
    window.dispatchEvent(muted());
    expect(report).toHaveBeenCalledTimes(1);
    expect(report.mock.calls[0]![0]).toMatchObject({
      kind: "crash",
      source: "browser-error",
      message: "Script error.",
      data: { errorType: null, stack: null, codeOrigin: "foreign" },
    });
  });

  it("still files our own error in full", () => {
    render(<CrashCollector />);
    const err = new TypeError("x is undefined");
    window.dispatchEvent(
      new ErrorEvent("error", { message: err.message, error: err }),
    );
    expect(report).toHaveBeenCalledTimes(1);
    const body = report.mock.calls[0]![0] as {
      message: string;
      data: { errorType: string; stack: string; codeOrigin: string };
    };
    expect(body.message).toBe("x is undefined");
    expect(body.data.errorType).toBe("TypeError");
    expect(body.data.stack).toContain("x is undefined");
    expect(body.data.codeOrigin).not.toBe("foreign");
  });

  it("leaves another stackless window error unjudged", () => {
    render(<CrashCollector />);
    window.dispatchEvent(new ErrorEvent("error", { message: "boom" }));
    expect(report.mock.calls[0]![0]).toMatchObject({
      data: { errorType: null, stack: null },
    });
    expect(
      (report.mock.calls[0]![0] as { data: object }).data,
    ).not.toHaveProperty("codeOrigin");
  });
});
