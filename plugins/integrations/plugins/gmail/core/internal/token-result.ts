/** Gmail-owned result of a token request. Deliberately NOT a re-export of auth's
 *  TokenResponse — the integration speaks its own vocabulary so consumers never
 *  import @plugins/auth. */
export type GmailTokenResult =
  | {
      ok: true;
      accessToken: string;
      expiresAt: number;
      scopes: string[];
      /** Connected Google account email (from the OAuth identity), available
       *  without a Gmail API call. `null` if the connection surfaced none. */
      email: string | null;
      /** The Google account's own name (the OAuth identity's), what Gmail
       *  writes as when the primary address sets no display name. `null` if
       *  the connection surfaced none. */
      name: string | null;
    }
  | { ok: false; needsConsent: boolean; message: string };
