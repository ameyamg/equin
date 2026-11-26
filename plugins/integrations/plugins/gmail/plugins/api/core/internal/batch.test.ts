import { describe, expect, test } from "bun:test";
import {
  batchBoundaryOf,
  decodeBatch,
  encodeBatch,
  GmailBatchFormatError,
} from "./batch";

describe("encodeBatch", () => {
  test("one application/http part per call, numbered, closed by the end delimiter", () => {
    const body = encodeBatch(
      [
        { method: "GET", path: "/gmail/v1/users/me/threads/a?format=metadata" },
        {
          method: "POST",
          path: "/gmail/v1/users/me/threads/b/modify",
          body: { removeLabelIds: ["INBOX"] },
        },
      ],
      "B",
    );
    expect(body).toBe(
      "--B\r\nContent-Type: application/http\r\nContent-ID: <item-0>\r\n\r\n" +
        "GET /gmail/v1/users/me/threads/a?format=metadata HTTP/1.1\r\n\r\n" +
        "--B\r\nContent-Type: application/http\r\nContent-ID: <item-1>\r\n\r\n" +
        "POST /gmail/v1/users/me/threads/b/modify HTTP/1.1\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" +
        '{"removeLabelIds":["INBOX"]}\r\n--B--',
    );
  });
  test("refuses a full URL or an empty batch", () => {
    expect(() =>
      encodeBatch([{ method: "GET", path: "https://x/y" }], "B"),
    ).toThrow('must start with "/"');
    expect(() => encodeBatch([], "B")).toThrow("empty batch");
  });
});

describe("decodeBatch", () => {
  // Line endings as bare LF and a quoted boundary: both occur in the wild.
  const body = [
    "--batch_Q",
    "Content-Type: application/http",
    "Content-ID: <response-item-1>",
    "",
    "HTTP/1.1 404 Not Found",
    "Content-Type: application/json; charset=UTF-8",
    "",
    '{"error":{"code":404,"message":"Not Found"}}',
    "",
    "--batch_Q",
    "Content-Type: application/http",
    "Content-ID: <response-item-0>",
    "",
    "HTTP/1.1 200 OK",
    "Content-Type: application/json; charset=UTF-8",
    "",
    '{\n  "id": "a"\n}',
    "",
    "--batch_Q--",
    "",
  ].join("\n");

  test("ties each part to its request by Content-ID, in request order", () => {
    const parts = decodeBatch('multipart/mixed; boundary="batch_Q"', body, 2);
    expect(parts.map((p) => [p.index, p.status])).toEqual([
      [0, 200],
      [1, 404],
    ]);
    expect(JSON.parse(parts[0]!.body)).toEqual({ id: "a" });
    expect(parts[1]!.headers["content-type"]).toBe(
      "application/json; charset=UTF-8",
    );
  });

  test("refuses a part for a request never sent, and a non-multipart answer", () => {
    expect(() =>
      decodeBatch("multipart/mixed; boundary=batch_Q", body, 1),
    ).toThrow(GmailBatchFormatError);
    expect(() => batchBoundaryOf("application/json")).toThrow(
      "not a multipart/mixed",
    );
  });
});
