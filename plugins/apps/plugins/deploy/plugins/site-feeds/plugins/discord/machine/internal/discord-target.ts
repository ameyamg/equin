import { basename, extname } from "node:path";
import { transcodeToBudget } from "@plugins/media/plugins/ffmpeg/machine";
import type {
  SyndicatedPost,
  SyndicationFailure,
  SyndicationPostResult,
} from "@plugins/apps/plugins/deploy/plugins/site-feeds/plugins/syndication/core";
import {
  syndicationTarget,
  type SyndicationCallCtx,
} from "@plugins/apps/plugins/deploy/plugins/site-feeds/plugins/syndication/server";
import {
  discordTarget,
  parseDiscordWebhookUrl,
  type DiscordWebhook,
} from "../../core";
import {
  DISCORD_CONTENT_MAX,
  DISCORD_FILES_MAX,
  discordContent,
  discordMessageLink,
  parseWebhookInfo,
  webhookInfoUrl,
  discordForm,
  executeWebhookUrl,
  parseDiscordResponse,
  webhookMessageUrl,
  type DiscordAnswer,
} from "./discord-api";
import {
  MB,
  planUploads,
  requestOverheadBytes,
  sizeText,
  sizesText,
} from "./upload-plan";

type DiscordConfig = { webhookUrl: string; uploadLimitMb: number };

const refuse = (error: string): SyndicationFailure => ({
  ok: false,
  error,
  retryable: false,
});

function webhookOf(config: DiscordConfig): DiscordWebhook | SyndicationFailure {
  if (config.webhookUrl === "") {
    return refuse("Paste the channel's webhook URL first.");
  }
  return (
    parseDiscordWebhookUrl(config.webhookUrl) ??
    refuse(
      "That is not a Discord webhook URL (https://discord.com/api/webhooks/<id>/<token>).",
    )
  );
}

/** A message ready to send: its content and its files, each fitting the limit together. */
interface PreparedMessage {
  content: string;
  files: { filename: string; mime: string; path: string; size: number }[];
}

/**
 * Turn a post into one message that Discord will take, BEFORE anything is
 * sent: the text within 2000 characters, at most 10 files, and every file
 * together within the upload limit — a video over its share re-encoded into
 * the run's work dir. Anything that cannot fit is refused in words, sizes
 * and the limit named.
 */
async function prepare(
  post: SyndicatedPost,
  config: DiscordConfig,
  ctx: SyndicationCallCtx,
): Promise<PreparedMessage | SyndicationFailure> {
  const content = discordContent(post);
  if (content.length > DISCORD_CONTENT_MAX) {
    return refuse(
      `The text is ${content.length} characters; a Discord message holds ${DISCORD_CONTENT_MAX} at most.`,
    );
  }
  if (content === "" && post.media.length === 0) {
    return refuse("Nothing to post: the item has no text and no files.");
  }
  if (post.media.length > DISCORD_FILES_MAX) {
    return refuse(
      `The item has ${post.media.length} files; a Discord message carries ${DISCORD_FILES_MAX} at most.`,
    );
  }
  const limitBytes = config.uploadLimitMb * MB;
  const reserved = requestOverheadBytes(content.length, post.media.length);
  const plan = planUploads(post.media, limitBytes, reserved);
  if (plan.kind === "refused") return refuse(plan.message);

  const files: PreparedMessage["files"] = [];
  for (const step of plan.steps) {
    const media = post.media[step.index];
    if (media === undefined)
      throw new Error(`no file ${step.index} in the post`);
    if (step.action === "send") {
      files.push({ ...media });
      continue;
    }
    const encoded = await transcodeToBudget(media.path, step.budgetBytes, {
      signal: ctx.signal,
      outDir: ctx.workDir,
    });
    switch (encoded.kind) {
      case "too-long":
        return refuse(
          `${media.filename} (${sizeText(media.size)}, ${Math.round(encoded.durationMs / 1000)} s) is too long to fit ${sizeText(step.budgetBytes)} of Discord's ${sizeText(limitBytes)} limit at a watchable quality (${encoded.videoKbps} kbps, under ${encoded.minVideoKbps}) — shorten it, or post it in an item of its own.`,
        );
      case "over-budget":
        return refuse(
          `${media.filename} re-encoded to ${sizeText(encoded.size)}, still over its ${sizeText(encoded.budgetBytes)} share of Discord's ${sizeText(limitBytes)} limit.`,
        );
      case "fits":
        files.push({
          // The re-encode is an MP4 whatever the original was.
          filename: `${basename(media.filename, extname(media.filename))}.mp4`,
          mime: "video/mp4",
          path: encoded.path,
          size: encoded.size,
        });
    }
  }
  const total = files.reduce((n, f) => n + f.size, 0);
  if (total + reserved > limitBytes) {
    return refuse(
      `These files together are over Discord's ${sizeText(limitBytes)} upload limit for one message (${sizesText(files)}) — remove some, or post them in two items.`,
    );
  }
  return { content, files };
}

async function send(
  method: "POST" | "PATCH" | "DELETE",
  url: string,
  message: PreparedMessage | null,
  signal: AbortSignal,
): Promise<DiscordAnswer> {
  const res = await fetch(url, {
    method,
    signal,
    ...(message === null
      ? {}
      : {
          body: discordForm(
            message.content,
            message.files.map((f) => ({
              filename: f.filename,
              mime: f.mime,
              blob: Bun.file(f.path, { type: f.mime }),
            })),
          ),
        }),
  });
  return parseDiscordResponse(
    res.status,
    await res.text(),
    method === "DELETE" ? "deleted" : "message",
  );
}

function asPostResult(answer: DiscordAnswer): SyndicationPostResult {
  switch (answer.kind) {
    case "message":
      return { ok: true, remoteId: answer.id };
    case "unknown-webhook":
      return refuse(answer.error);
    case "unknown-message":
      return refuse("Discord no longer has the message.");
    case "deleted":
      return refuse("Discord answered a post with no message.");
    case "failed":
      return { ok: false, error: answer.error, retryable: answer.retryable };
  }
}

/**
 * Post a new message, answering its link too. The webhook's guild and
 * channel (what a message link needs; a posted message carries no guild) are
 * read BEFORE posting: a failure there throws with nothing posted, so the
 * retry can never post twice.
 */
async function postMessage(
  hook: DiscordWebhook,
  message: PreparedMessage,
  signal: AbortSignal,
): Promise<SyndicationPostResult> {
  const infoRes = await fetch(webhookInfoUrl(hook), { signal });
  const info = parseWebhookInfo(infoRes.status, await infoRes.text());
  const result = asPostResult(
    await send("POST", executeWebhookUrl(hook), message, signal),
  );
  if (!result.ok || info === null) return result;
  return {
    ...result,
    url: discordMessageLink(info.guildId, info.channelId, result.remoteId),
  };
}

/** Discord through one channel webhook: post, edit (text and files replaced), delete. */
export const discordSyndicationTarget = syndicationTarget(discordTarget, {
  validate: (config) => {
    const hook = webhookOf(config);
    return "ok" in hook ? hook.error : null;
  },
  post: async (post, config, ctx) => {
    const hook = webhookOf(config);
    if ("ok" in hook) return hook;
    const message = await prepare(post, config, ctx);
    if ("ok" in message) return message;
    return postMessage(hook, message, ctx.signal);
  },
  edit: async (remoteId, post, config, ctx) => {
    const hook = webhookOf(config);
    if ("ok" in hook) return hook;
    const message = await prepare(post, config, ctx);
    if ("ok" in message) return message;
    const answer = await send(
      "PATCH",
      webhookMessageUrl(hook, remoteId),
      message,
      ctx.signal,
    );
    // Deleted in Discord since: post it anew (its new id replaces the old).
    if (answer.kind === "unknown-message") {
      return postMessage(hook, message, ctx.signal);
    }
    return asPostResult(answer);
  },
  remove: async (remoteId, config, ctx) => {
    const hook = webhookOf(config);
    if ("ok" in hook) return hook;
    const answer = await send(
      "DELETE",
      webhookMessageUrl(hook, remoteId),
      null,
      ctx.signal,
    );
    switch (answer.kind) {
      case "deleted":
      // Deleted in Discord already: done.
      case "unknown-message":
        return { ok: true };
      case "unknown-webhook":
        return refuse(answer.error);
      case "message":
        return { ok: true };
      case "failed":
        return { ok: false, error: answer.error, retryable: answer.retryable };
    }
  },
});
