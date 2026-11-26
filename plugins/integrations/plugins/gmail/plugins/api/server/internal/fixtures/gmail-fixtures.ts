// Gmail answers in the exact wire shape Google sends (JSON field spellings,
// int64s as strings, the batch multipart with CRLF, `response-` Content-IDs,
// per-part status lines and headers), with made-up content: no real mailbox
// is ever checked in. The shapes follow Gmail's REST reference and batch
// guide; `scripts/probe.ts` runs the same zod parse on a live account's
// answers, so a drift between these and Google shows there first.

export const THREAD_LIST = {
  threads: [
    { id: "18c0000000000001", snippet: "Lunch on Friday?", historyId: "9001" },
    { id: "18c0000000000002", snippet: "Your receipt", historyId: "8990" },
    { id: "18c0000000000003", snippet: "Minutes", historyId: "8950" },
  ],
  nextPageToken: "07263471963530520373",
  resultSizeEstimate: 201,
};

export function metadataThread(id: string, historyId: string) {
  return {
    id,
    historyId,
    messages: [
      {
        id,
        threadId: id,
        labelIds: ["UNREAD", "CATEGORY_PERSONAL", "INBOX"],
        snippet: "Lunch on Friday?",
        historyId,
        internalDate: "1764150000000",
        sizeEstimate: 5123,
        payload: {
          partId: "",
          mimeType: "multipart/alternative",
          filename: "",
          headers: [
            { name: "From", value: "Ana <ana@example.com>" },
            { name: "Subject", value: "Lunch" },
          ],
          body: { size: 0 },
        },
      },
    ],
  };
}

const CRLF = "\r\n";

/** A batch answer, parts in the order given (Google may reorder). */
export function batchAnswer(
  boundary: string,
  parts: {
    index: number;
    status: number;
    statusText: string;
    body: unknown;
    headers?: Record<string, string>;
  }[],
): string {
  let out = "";
  for (const p of parts) {
    out += `--${boundary}${CRLF}Content-Type: application/http${CRLF}Content-ID: <response-item-${p.index}>${CRLF}${CRLF}`;
    out += `HTTP/1.1 ${p.status} ${p.statusText}${CRLF}Content-Type: application/json; charset=UTF-8${CRLF}Vary: Origin${CRLF}Vary: X-Origin${CRLF}`;
    for (const [k, v] of Object.entries(p.headers ?? {}))
      out += `${k}: ${v}${CRLF}`;
    out += CRLF + JSON.stringify(p.body, null, 2) + CRLF;
  }
  return `${out}--${boundary}--${CRLF}`;
}

export const NOT_FOUND = {
  error: {
    code: 404,
    message: "Requested entity was not found.",
    errors: [
      {
        message: "Requested entity was not found.",
        domain: "global",
        reason: "notFound",
      },
    ],
    status: "NOT_FOUND",
  },
};

export const RATE_LIMITED = {
  error: {
    code: 429,
    message: "Too many concurrent requests for user",
    errors: [
      {
        message: "Too many concurrent requests for user",
        domain: "global",
        reason: "rateLimitExceeded",
      },
    ],
    status: "RESOURCE_EXHAUSTED",
  },
};

export const USER_RATE_LIMITED_403 = {
  error: {
    code: 403,
    message: "User-rate limit exceeded.  Retry after 2026-11-26T10:00:05.000Z",
    errors: [
      {
        message: "User-rate limit exceeded.",
        domain: "usageLimits",
        reason: "userRateLimitExceeded",
      },
    ],
    status: "PERMISSION_DENIED",
  },
};

export const HISTORY_PAGE = {
  history: [
    {
      id: "9002",
      messages: [{ id: "18c0000000000009", threadId: "18c0000000000001" }],
      messagesAdded: [
        {
          message: {
            id: "18c0000000000009",
            threadId: "18c0000000000001",
            labelIds: ["UNREAD", "INBOX"],
          },
        },
      ],
    },
    {
      id: "9003",
      messages: [{ id: "18c0000000000002", threadId: "18c0000000000002" }],
      labelsRemoved: [
        {
          message: {
            id: "18c0000000000002",
            threadId: "18c0000000000002",
            labelIds: [],
          },
          labelIds: ["INBOX"],
        },
      ],
    },
  ],
  historyId: "9010",
};
