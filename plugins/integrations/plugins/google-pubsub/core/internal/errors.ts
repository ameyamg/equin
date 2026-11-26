/**
 * Pub/Sub did not do what it was asked, in Google's words: the HTTP status,
 * Google's ErrorInfo reason or status (`NOT_FOUND`, `ALREADY_EXISTS`,
 * `PERMISSION_DENIED`, `SERVICE_DISABLED`, …) and its message — plus, when
 * the project has the Pub/Sub API turned off, the console link that turns it
 * on (`activationUrl`).
 */
export class PubSubApiError extends Error {
  constructor(
    /** What was asked, in words ("topics.create projects/p/topics/t"). */
    readonly what: string,
    readonly status: number,
    readonly reason: string | null,
    readonly detail: string,
    readonly activationUrl: string | null,
  ) {
    super(
      `Pub/Sub refused ${what} (HTTP ${status}${reason ? `, ${reason}` : ""}): ${detail}`,
    );
    this.name = "PubSubApiError";
  }

  /** The project has the Cloud Pub/Sub API turned off. */
  get serviceDisabled(): boolean {
    return this.reason === "SERVICE_DISABLED" || this.activationUrl !== null;
  }

  /** A Google-side failure or a rate refusal: worth trying again after a wait. */
  get transient(): boolean {
    return this.status === 429 || this.status >= 500;
  }
}

/** Pub/Sub could not be reached at all (DNS, offline, connection reset). */
export class PubSubUnreachableError extends Error {
  constructor(
    readonly what: string,
    cause: unknown,
  ) {
    super(
      `Could not reach Pub/Sub for ${what} (${cause instanceof Error ? cause.message : String(cause)})`,
      { cause },
    );
    this.name = "PubSubUnreachableError";
  }
}

/** A 2xx answer whose body is not the shape Pub/Sub documents. */
export class PubSubResponseShapeError extends Error {
  constructor(
    readonly what: string,
    detail: string,
  ) {
    super(`Pub/Sub answered ${what} with an unknown shape: ${detail}`);
    this.name = "PubSubResponseShapeError";
  }
}
