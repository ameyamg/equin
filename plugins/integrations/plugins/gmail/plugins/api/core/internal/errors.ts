/** Reasons Google gives for a rate refusal (403 or 429 alike). */
const RATE_REASONS = new Set(["rateLimitExceeded", "userRateLimitExceeded"]);

/**
 * A Gmail call that did not do what it was asked, in Google's words: the
 * HTTP status, Google's first `reason` (`notFound`, `failedPrecondition`,
 * `userRateLimitExceeded`, …) and its message.
 */
export class GmailApiError extends Error {
  constructor(
    /** What was asked, in words ("threads.get abc"). */
    readonly what: string,
    readonly status: number,
    readonly reason: string | null,
    readonly detail: string,
  ) {
    super(
      `Gmail refused ${what} (HTTP ${status}${reason ? `, ${reason}` : ""}): ${detail}`,
    );
    this.name = "GmailApiError";
  }

  /** Google asked us to slow down: pause every caller, then retry. */
  get rateLimited(): boolean {
    return (
      this.status === 429 ||
      (this.status === 403 &&
        this.reason !== null &&
        RATE_REASONS.has(this.reason))
    );
  }

  /** Worth trying again after a backoff: a rate refusal or a Google-side failure. */
  get transient(): boolean {
    return (
      this.rateLimited ||
      this.status === 500 ||
      this.status === 502 ||
      this.status === 503 ||
      this.status === 504
    );
  }
}

/** Google could not be reached at all (DNS, offline, connection reset). */
export class GmailUnreachableError extends Error {
  constructor(
    readonly what: string,
    cause: unknown,
  ) {
    super(
      `Could not reach Gmail's API for ${what} (${cause instanceof Error ? cause.message : String(cause)})`,
      { cause },
    );
    this.name = "GmailUnreachableError";
  }
}

/** A 2xx answer whose body is not the shape Gmail documents. */
export class GmailResponseShapeError extends Error {
  constructor(
    readonly what: string,
    detail: string,
  ) {
    super(`Gmail answered ${what} with an unknown shape: ${detail}`);
    this.name = "GmailResponseShapeError";
  }
}

/**
 * A call that must not run twice (a send, a create) failed in a way that
 * leaves it unknown whether Google did it: the connection dropped, or Google
 * answered 5xx. It is never retried — a retry could send the mail twice. The
 * caller reconciles (the Sent folder, history) before deciding to try again.
 */
export class GmailOutcomeUnknownError extends Error {
  constructor(
    readonly what: string,
    cause: GmailApiError | GmailUnreachableError,
  ) {
    super(`Gmail may or may not have done ${what}: ${cause.message}`, {
      cause,
    });
    this.name = "GmailOutcomeUnknownError";
  }
}
