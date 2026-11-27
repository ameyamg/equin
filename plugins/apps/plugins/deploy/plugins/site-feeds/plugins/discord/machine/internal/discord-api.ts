import { z } from "zod";
import {
  formattedPlainText,
  type FormattedText,
} from "@plugins/fields/plugins/formatted-text/core";
import type { DiscordWebhook } from "../../core";

/** Discord's API root the calls are made on (whatever spelling the webhook URL had). */
export const DISCORD_API = "https://discord.com/api/v10";

/** The most characters a message's `content` holds. */
export const DISCORD_CONTENT_MAX = 2000;

/** The most files one message carries. */
export const DISCORD_FILES_MAX = 10;

/** `POST` here posts a message; `?wait=true` answers it (its id). */
export function executeWebhookUrl(hook: DiscordWebhook): string {
  return `${DISCORD_API}/webhooks/${hook.id}/${hook.token}?wait=true`;
}

/** `PATCH` edits the webhook's message, `DELETE` deletes it. */
export function webhookMessageUrl(
  hook: DiscordWebhook,
  messageId: string,
): string {
  return `${DISCORD_API}/webhooks/${hook.id}/${hook.token}/messages/${messageId}`;
}

/** `GET` here answers the webhook itself — its guild and channel (no auth beyond the token). */
export function webhookInfoUrl(hook: DiscordWebhook): string {
  return `${DISCORD_API}/webhooks/${hook.id}/${hook.token}`;
}

/** Where a person opens a message: `https://discord.com/channels/<guild>/<channel>/<message>`. */
export function discordMessageLink(
  guildId: string,
  channelId: string,
  messageId: string,
): string {
  return `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
}

const WebhookInfoSchema = z.object({
  guild_id: z.string().min(1).nullish(),
  channel_id: z.string().min(1).nullish(),
});

/**
 * The webhook's guild and channel from a `GET` of it — null when Discord did
 * not answer them (a non-2xx, or a webhook of no guild): the post then simply
 * carries no link.
 */
export function parseWebhookInfo(
  status: number,
  body: string,
): { guildId: string; channelId: string } | null {
  if (status < 200 || status >= 300) return null;
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch (err) {
    if (!(err instanceof SyntaxError)) throw err;
    return null;
  }
  const parsed = WebhookInfoSchema.safeParse(json);
  if (!parsed.success) return null;
  const { guild_id, channel_id } = parsed.data;
  return guild_id && channel_id
    ? { guildId: guild_id, channelId: channel_id }
    : null;
}

/** A web address in plain text: Discord links it as written, so it is never escaped. */
const BARE_URL = /https?:\/\/\S+/g;

/**
 * Plain text in a Discord message, read literally: every character Discord's
 * markdown reads inline (backslash, `* _ ~ | [ ]` and the backtick) escaped,
 * and the ones it reads at a line's start (a quote `>`, a heading `#`, a list
 * `-` or `1.`) too — except inside a bare web address, which Discord links
 * with any backslash in it (so `a_b` in a URL stays `a_b`).
 */
export function discordEscape(text: string): string {
  let out = "";
  let at = 0;
  for (const m of text.matchAll(BARE_URL)) {
    out += escapeInline(text.slice(at, m.index)) + m[0];
    at = m.index + m[0].length;
  }
  out += escapeInline(text.slice(at));
  return out.replace(
    /^([ \t]*)([>#-]|\d+(?=\.))/gm,
    (_, pad: string, mark: string) =>
      /^\d/.test(mark) ? `${pad}${mark}\\` : `${pad}\\${mark}`,
  );
}

function escapeInline(text: string): string {
  return text.replace(/[\\*_~`|[\]]/g, "\\$&");
}

/**
 * A key cap as inline code, fenced by one more backtick than the longest run
 * of backticks in it (padded with spaces when it holds any), so no key closes
 * its own fence.
 */
function discordKey(key: string): string {
  const longest = Math.max(0, ...(key.match(/`+/g) ?? []).map((r) => r.length));
  const fence = "`".repeat(longest + 1);
  return longest === 0 ? `${fence}${key}${fence}` : `${fence} ${key} ${fence}`;
}

/**
 * A formatted text as Discord markdown: bold stays bold, a key cap becomes
 * inline code, a web link a masked link (`[text](<url>)`, no preview card) —
 * a site path resolved against `base` (the post's page), or its text alone
 * with no page to resolve it against. Discord masks web links only, so a mail
 * link is its text and the address after it.
 */
export function discordFormatted(
  text: FormattedText,
  base: string | null = null,
): string {
  return text
    .map((n) => {
      switch (n.kind) {
        case "text":
          return discordEscape(n.text);
        case "key":
          return discordKey(n.text);
        case "strong":
          return `**${discordFormatted(n.children, base)}**`;
        case "link": {
          const label = discordFormatted(n.children, base);
          if (n.href.startsWith("mailto:")) {
            const address = n.href.slice("mailto:".length);
            return formattedPlainText(n.children) === address
              ? discordEscape(address)
              : `${label} (${discordEscape(address)})`;
          }
          if (!n.href.startsWith("/")) return `[${label}](<${n.href}>)`;
          return base === null
            ? label
            : `[${label}](<${new URL(n.href, base).href}>)`;
        }
      }
    })
    .join("");
}

/**
 * A post's text as one message: the title in bold (escaped, so it cannot
 * close the bold early or format), then each paragraph in Discord markdown
 * (`discordFormatted`), blank lines between, then the link to the feed's page
 * on the site — in angle brackets, so Discord shows no preview card over the
 * attached files.
 */
export function discordContent(text: {
  title: string | null;
  paragraphs: readonly FormattedText[];
  url?: string | null;
}): string {
  const url = text.url ?? null;
  const parts: string[] = [];
  if (text.title !== null) parts.push(`**${discordEscape(text.title)}**`);
  parts.push(...text.paragraphs.map((p) => discordFormatted(p, url)));
  if (url !== null) parts.push(`<${url}>`);
  return parts.join("\n\n");
}

/**
 * The message's JSON part (`payload_json`): its content, no mentions parsed
 * (a tip's text never pings anyone), and one attachment per file, by its
 * index in the multipart (`files[i]`). On an edit, the attachments listed are
 * the message's whole set: the old ones go.
 */
export function discordPayload(
  content: string,
  filenames: readonly string[],
): Record<string, unknown> {
  return {
    content,
    allowed_mentions: { parse: [] },
    attachments: filenames.map((filename, id) => ({ id, filename })),
  };
}

/** The multipart body of a post or an edit: `payload_json`, then `files[i]`. */
export function discordForm(
  content: string,
  files: readonly { filename: string; mime: string; blob: Blob }[],
): FormData {
  const form = new FormData();
  form.append(
    "payload_json",
    JSON.stringify(
      discordPayload(
        content,
        files.map((f) => f.filename),
      ),
    ),
  );
  files.forEach((f, i) => {
    form.append(
      `files[${i}]`,
      new File([f.blob], f.filename, { type: f.mime }),
      f.filename,
    );
  });
  return form;
}

/** How Discord answered one call. */
export type DiscordAnswer =
  | { kind: "message"; id: string }
  | { kind: "deleted" }
  /** The message (or the webhook itself) no longer exists. */
  | { kind: "unknown-message" }
  | { kind: "unknown-webhook"; error: string }
  | {
      kind: "failed";
      status: number;
      error: string;
      retryable: boolean;
      /** A rate limit's wait, from `retry_after` (seconds in the body). */
      retryAfterMs?: number;
    };

const MessageSchema = z.object({ id: z.string().min(1) });
const ErrorSchema = z.object({
  message: z.string(),
  code: z.number().optional(),
  retry_after: z.number().optional(),
});

/** Discord's JSON error codes this client acts on. */
const UNKNOWN_MESSAGE = 10008;
const UNKNOWN_WEBHOOK = 10015;

const BODY_HEAD_CHARS = 300;

/**
 * Read one answer. A 2xx without a message id (when one was asked for) is a
 * failure, so nothing reads as posted unless Discord said so. 429 and 5xx are
 * retryable (a 429's `retry_after` kept); every other refusal is for good.
 */
export function parseDiscordResponse(
  status: number,
  body: string,
  expect: "message" | "deleted",
): DiscordAnswer {
  if (status === 204 && expect === "deleted") return { kind: "deleted" };
  let json: unknown;
  try {
    json = body === "" ? null : JSON.parse(body);
  } catch (err) {
    if (!(err instanceof SyntaxError)) throw err;
    json = undefined;
  }
  if (status >= 200 && status < 300) {
    if (expect === "deleted") return { kind: "deleted" };
    const msg = MessageSchema.safeParse(json);
    return msg.success
      ? { kind: "message", id: msg.data.id }
      : {
          kind: "failed",
          status,
          error: `Discord answered ${status} without a message id: ${body.slice(0, BODY_HEAD_CHARS)}`,
          retryable: false,
        };
  }
  const parsed = ErrorSchema.safeParse(json);
  const words = parsed.success
    ? parsed.data.message
    : body.slice(0, BODY_HEAD_CHARS) || `HTTP ${status}`;
  if (status === 404 && parsed.success) {
    if (parsed.data.code === UNKNOWN_MESSAGE)
      return { kind: "unknown-message" };
    if (parsed.data.code === UNKNOWN_WEBHOOK) {
      return {
        kind: "unknown-webhook",
        error:
          "Discord no longer knows this webhook (deleted from the channel?) — paste a new webhook URL.",
      };
    }
  }
  if (status === 429) {
    const retryAfterMs =
      parsed.success && parsed.data.retry_after !== undefined
        ? Math.ceil(parsed.data.retry_after * 1000)
        : undefined;
    return {
      kind: "failed",
      status,
      error: `Discord is rate limiting this webhook${retryAfterMs !== undefined ? ` (retry after ${(retryAfterMs / 1000).toFixed(1)} s)` : ""}: ${words}`,
      retryable: true,
      ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
    };
  }
  if (status >= 500) {
    return {
      kind: "failed",
      status,
      error: `Discord failed (${status}): ${words}`,
      retryable: true,
    };
  }
  if (status === 413) {
    return {
      kind: "failed",
      status,
      error: `Discord refused the files as too large (413) — lower the upload limit setting to the server's: ${words}`,
      retryable: false,
    };
  }
  return {
    kind: "failed",
    status,
    error: `Discord refused the message (${status}): ${words}`,
    retryable: false,
  };
}
