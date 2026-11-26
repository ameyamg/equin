import type { AuthIdentity } from "./lib";

export interface GetAccessTokenArgs {
  providerId: string;
  accountId?: string;
  scopes?: string[];
  /**
   * The access token the provider just refused (HTTP 401). If the account
   * still holds exactly this one, it is refreshed instead of handed back; if
   * another caller refreshed it already, the newer token is returned. Never
   * a "force refresh" flag: a refusal names the token it refused, so a burst
   * of 401s costs one refresh.
   */
  refused?: string;
}

export interface TokenSuccess {
  ok: true;
  accessToken: string;
  expiresAt: number;
  scopes: string[];
  identity: AuthIdentity;
}

export interface TokenNeedsConsent {
  ok: false;
  needsConsent: true;
  reason: "no-account" | "needs-reconsent" | "missing-scopes";
  missingScopes?: string[];
  /** The provider's diagnosis of the refused refresh behind a needs-reconsent. */
  hint?: string;
}

export interface TokenFailure {
  ok: false;
  needsConsent?: false;
  message: string;
  code?: string;
}

export type TokenResponse = TokenSuccess | TokenNeedsConsent | TokenFailure;
