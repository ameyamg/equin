/** A Discord webhook: the id and token its URL carries. */
export interface DiscordWebhook {
  id: string;
  token: string;
}

const WEBHOOK_URL_RE =
  /^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/api(?:\/v\d+)?\/webhooks\/(\d{5,25})\/([A-Za-z0-9_-]{20,200})\/?$/;

/**
 * Read a webhook URL as Discord hands it out (`https://discord.com/api/webhooks/<id>/<token>`,
 * also `discordapp.com`, `ptb.` / `canary.`, a `/v<n>` API version) — or null.
 */
export function parseDiscordWebhookUrl(url: string): DiscordWebhook | null {
  const m = WEBHOOK_URL_RE.exec(url.trim());
  if (m === null) return null;
  const [, id, token] = m;
  return id !== undefined && token !== undefined ? { id, token } : null;
}
