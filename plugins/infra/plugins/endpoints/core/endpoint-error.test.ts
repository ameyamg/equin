import { describe, expect, test } from "bun:test";
import {
  EndpointError,
  EndpointForeignAnswerError,
  EndpointNetworkError,
  EndpointResponseUnreadableError,
  isLostInTransit,
  ResponseBodyLostError,
} from "./endpoint-error";
import { FetchRequestError } from "@plugins/primitives/plugins/networking/plugins/request-guard/core";

const ROUTE = "POST /api/analytics/collect";

describe("isLostInTransit — what a caller may treat as a harmless loss", () => {
  test("the browser's fetch rejecting, or a body lost on the way, is lost in transit", () => {
    const fetchRejected = new FetchRequestError(
      "POST",
      "/api/analytics/collect",
      "Failed to fetch",
      new TypeError("Failed to fetch"),
    );
    expect(
      isLostInTransit(new EndpointNetworkError(ROUTE, fetchRejected)),
    ).toBe(true);
    expect(
      isLostInTransit(
        new EndpointNetworkError(ROUTE, new ResponseBodyLostError("cut short")),
      ),
    ).toBe(true);
  });

  test("a TypeError code raised on the way is not, though it is named the same", () => {
    expect(
      isLostInTransit(
        new EndpointNetworkError(ROUTE, new TypeError("Invalid header value")),
      ),
    ).toBe(false);
  });

  test("a proxy's HTML page answering in equin's place is lost in transit", () => {
    expect(
      isLostInTransit(
        new EndpointForeignAnswerError(ROUTE, 403, "<!DOCTYPE html>"),
      ),
    ).toBe(true);
  });

  test("equin's own refusals and failures are not", () => {
    expect(isLostInTransit(new EndpointError(ROUTE, 500, "boom"))).toBe(false);
    expect(
      isLostInTransit(new EndpointError(ROUTE, 400, "Validation failed")),
    ).toBe(false);
    expect(
      isLostInTransit(
        new EndpointResponseUnreadableError(
          ROUTE,
          200,
          0,
          null,
          new SyntaxError("x"),
        ),
      ),
    ).toBe(false);
  });

  test("a bug of the page is not", () => {
    expect(isLostInTransit(new TypeError("undefined is not a function"))).toBe(
      false,
    );
    expect(isLostInTransit(new Error("x"))).toBe(false);
  });
});
