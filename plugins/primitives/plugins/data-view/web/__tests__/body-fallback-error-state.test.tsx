/**
 * The body's failed-read rendering (`BodyFallback`, the `error` and
 * `field-error` arms): by default the failure through `ResourceErrorInline` —
 * a refused read (a source whose collection declares `refusals`) shows the
 * server's message and NO Retry; a host's node replaces it; a host's
 * function is handed the failure — the refusal's `code` reachable on its
 * `ResourceError` — and its `undefined` keeps the default.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ResourceError } from "@plugins/network/plugins/live/plugins/live-state/core";
import { BodyFallback } from "../components/body-fallback";
import type { DataViewReadFailure } from "../../core";

const refused = new ResourceError(
  "refused",
  "Connect your Gmail account",
  null,
  "not-connected",
);
const refetch = () => Promise.resolve();

afterEach(cleanup);

function renderError(
  error: Error,
  errorState?: Parameters<typeof BodyFallback>[0]["errorState"],
) {
  return render(
    <BodyFallback
      state={{
        kind: "error",
        error: { status: "error", error: error as ResourceError, refetch },
      }}
      errorState={errorState}
      loadingState={undefined}
      loadingVariant={undefined}
      loadingCount={undefined}
      onRemoveRules={() => {}}
    />,
  );
}

describe("BodyFallback — a failed read", () => {
  it("a refused read renders its message, with no Retry", () => {
    renderError(refused);
    expect(screen.getByText(/Connect your Gmail account/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("any other failure offers Retry", () => {
    renderError(new ResourceError("loader-failed", "boom", null));
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("a host node replaces it", () => {
    renderError(refused, <p>host state</p>);
    expect(screen.getByText("host state")).toBeTruthy();
  });

  it("a host function is handed the failure — the refusal's code — and `undefined` keeps the default", () => {
    const seen: DataViewReadFailure[] = [];
    const state = (f: DataViewReadFailure) => {
      seen.push(f);
      return f.error instanceof ResourceError &&
        f.error.kind === "refused" &&
        f.error.code === "not-connected" ? (
        <button type="button">Connect Gmail</button>
      ) : undefined;
    };
    renderError(refused, state);
    expect(screen.getByRole("button", { name: "Connect Gmail" })).toBeTruthy();
    expect(seen[0]!.error).toBe(refused);
    expect(seen[0]!.refetch).toBe(refetch);
    cleanup();

    renderError(new ResourceError("loader-failed", "boom", null), state);
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("a field's failure is handed with the field's label", () => {
    const seen: DataViewReadFailure[] = [];
    render(
      <BodyFallback
        state={{ kind: "field-error", field: "Git", error: new Error("nope") }}
        errorState={(f) => {
          seen.push(f);
          return <p>field failed</p>;
        }}
        loadingState={undefined}
        loadingVariant={undefined}
        loadingCount={undefined}
        onRemoveRules={() => {}}
      />,
    );
    expect(screen.getByText("field failed")).toBeTruthy();
    expect(seen[0]!.field).toBe("Git");
    expect(seen[0]!.refetch).toBeUndefined();
  });
});
