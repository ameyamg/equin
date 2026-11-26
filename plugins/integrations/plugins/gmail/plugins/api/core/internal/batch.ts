// Google's HTTP batch format (developers.google.com/workspace/gmail/api/guides/
// batch): one `multipart/mixed` POST whose parts are each a whole HTTP request
// (`Content-Type: application/http`, a `Content-ID`, then the request line with
// a path, never a full URL); the answer is a `multipart/mixed` whose parts are
// whole HTTP responses, each `Content-ID` the request's prefixed `response-`.
// Pure string work, so it is tested on recorded bodies without a network.

export type BatchRequestPart = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Path and query, from the API root: `/gmail/v1/users/me/threads/abc?format=metadata`. */
  path: string;
  /** A JSON body, for writes. */
  body?: unknown;
};

export type BatchResponsePart = {
  /** Index of the request this answers, in the order it was encoded. */
  index: number;
  status: number;
  /** Header names lowercased. */
  headers: Record<string, string>;
  body: string;
};

const CRLF = "\r\n";

/** A boundary that cannot occur in a JSON body or a path. */
export function newBatchBoundary(): string {
  return `batch_${crypto.randomUUID().replaceAll("-", "")}`;
}

/** The multipart body of a batch of `parts`, under `boundary`. */
export function encodeBatch(
  parts: readonly BatchRequestPart[],
  boundary: string,
): string {
  if (parts.length === 0) throw new Error("encodeBatch: an empty batch");
  let out = "";
  parts.forEach((p, i) => {
    if (!p.path.startsWith("/")) {
      throw new Error(
        `encodeBatch: a part's path must start with "/", got ${p.path}`,
      );
    }
    out += `--${boundary}${CRLF}`;
    out += `Content-Type: application/http${CRLF}`;
    out += `Content-ID: <item-${i}>${CRLF}${CRLF}`;
    out += `${p.method} ${p.path} HTTP/1.1${CRLF}`;
    if (p.body !== undefined) {
      out += `Content-Type: application/json; charset=UTF-8${CRLF}${CRLF}`;
      out += JSON.stringify(p.body);
    }
    out += CRLF;
  });
  out += `--${boundary}--`;
  return out;
}

/** Thrown when a batch answer is not the multipart we sent for. */
export class GmailBatchFormatError extends Error {
  constructor(message: string) {
    super(`Gmail batch answer: ${message}`);
    this.name = "GmailBatchFormatError";
  }
}

/** The boundary a `multipart/mixed; boundary=…` Content-Type names. */
export function batchBoundaryOf(contentType: string): string {
  const m = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
  if (!m || !/^multipart\/mixed/i.test(contentType.trim())) {
    throw new GmailBatchFormatError(
      `not a multipart/mixed answer (${contentType})`,
    );
  }
  return (m[1] ?? m[2])!;
}

/** Split a header block into lowercased name → value. */
function parseHeaders(block: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of block.split(/\r?\n/)) {
    if (line === "") continue;
    const colon = line.indexOf(":");
    if (colon <= 0)
      throw new GmailBatchFormatError(`a malformed header line "${line}"`);
    headers[line.slice(0, colon).trim().toLowerCase()] = line
      .slice(colon + 1)
      .trim();
  }
  return headers;
}

/** Head and the rest, split at the first blank line. */
function splitHead(text: string): [string, string] {
  const m = /\r?\n\r?\n/.exec(text);
  if (!m) return [text, ""];
  return [text.slice(0, m.index), text.slice(m.index + m[0].length)];
}

/**
 * Every response part of a batch answer, each tied to its request by its
 * `Content-ID` (Google may answer in any order). Throws on a part that names
 * no request we sent, a request answered twice, or one never answered —
 * `expected` is how many parts were sent.
 */
export function decodeBatch(
  contentType: string,
  body: string,
  expected: number,
): BatchResponsePart[] {
  const boundary = batchBoundaryOf(contentType);
  const delimiter = `--${boundary}`;
  const chunks = body.split(delimiter);
  // chunks[0] is the preamble; the last starts with "--" (the close delimiter).
  const out: BatchResponsePart[] = [];
  const seen = new Set<number>();
  for (const raw of chunks.slice(1)) {
    if (raw.startsWith("--")) break;
    const chunk = raw.replace(/^\r?\n/, "");
    const [partHead, http] = splitHead(chunk);
    const partHeaders = parseHeaders(partHead);
    const id = partHeaders["content-id"];
    const m = id ? /^<response-item-(\d+)>$/.exec(id) : null;
    if (!m)
      throw new GmailBatchFormatError(
        `a part with Content-ID ${id ?? "(none)"}`,
      );
    const index = Number(m[1]);
    if (index >= expected) {
      throw new GmailBatchFormatError(
        `a part for request ${index} of ${expected}`,
      );
    }
    if (seen.has(index))
      throw new GmailBatchFormatError(`request ${index} answered twice`);
    seen.add(index);
    const [responseHead, responseBody] = splitHead(http);
    const [statusLine, ...headerLines] = responseHead.split(/\r?\n/);
    const status = /^HTTP\/[\d.]+ (\d{3})/.exec(statusLine ?? "");
    if (!status)
      throw new GmailBatchFormatError(`a status line "${statusLine}"`);
    out.push({
      index,
      status: Number(status[1]),
      headers: parseHeaders(headerLines.join("\n")),
      body: responseBody.replace(/\r?\n$/, ""),
    });
  }
  if (out.length !== expected) {
    const missing = Array.from({ length: expected }, (_, i) => i).filter(
      (i) => !seen.has(i),
    );
    throw new GmailBatchFormatError(
      `no answer for request(s) ${missing.join(", ")}`,
    );
  }
  return out.sort((a, b) => a.index - b.index);
}
