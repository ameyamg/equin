// Gmail access: read, labels, archive, trash, drafts, send and users.watch
// (Pub/Sub push) — everything Mail does. The narrowest scope that covers it, as
// Google's scope-minimization review asks; the full `https://mail.google.com/`
// is needed only for permanent delete (bypassing Trash), which nothing here
// does. An account granted the full scope before still satisfies this (auth's
// scope coverage), so no one is asked to reconnect. Requested only when the
// user enables Gmail access in Settings; Google's `include_granted_scopes=true`
// (set in the Google provider descriptor) keeps previously granted scopes
// (e.g. Drive).
export const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
] as const;

// The auth provider the Gmail scope is granted on. Named once here so this
// plugin's scope requirement, its access hook, and its access action can never
// drift onto different providers.
export const GOOGLE_PROVIDER_ID = "google";
