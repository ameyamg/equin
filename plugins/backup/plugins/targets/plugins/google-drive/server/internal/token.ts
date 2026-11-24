import type { TokenFailure, TokenNeedsConsent } from "@plugins/auth/server";

/**
 * How every Drive API call gets its credential: it asks for one, at the moment
 * it sends. There is no `accessToken: string` parameter anywhere in this
 * plugin, so no call can hold on to a token fetched hours earlier.
 *
 * A Google access token lives one hour. Until 2026-11-24 the target fetched one
 * token when the run started and passed the string to the folder lookup, the
 * upload and the retention pass. The run of 11-24 took 5 h 23 min (the Mac
 * slept through most of it); the resumable upload's chunk PUTs carry no
 * Authorization header (the session URI is their credential), so the archive
 * still landed, but the retention listing after it sent the 03:04 token at
 * ~08:02 and Drive answered 401 (report-1794884443-cyv4ww). Central refreshes a
 * token that is within a minute of expiring when it is asked for one, so asking
 * per call is all it takes; it hands back its cached token otherwise, so a call
 * costs a local round-trip, not a Google one.
 */
export type DriveToken = () => Promise<string>;

/**
 * Central could not hand out a Drive token mid-run (the grant was revoked…).
 * Carries central's answer, so a refusal still becomes the target's
 * needs-consent result (the run card's Grant access), not a bare error.
 */
export class DriveTokenError extends Error {
  override name = "DriveTokenError";
  constructor(readonly failure: TokenNeedsConsent | TokenFailure) {
    super(
      failure.needsConsent
        ? `Google Drive token refused (${failure.reason})` +
            (failure.hint !== undefined ? `. ${failure.hint}` : "")
        : `Google Drive token unavailable: ${failure.message}`,
    );
  }
}

export function authHeader(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}
