import { describe, expect, it } from "bun:test";
import { parseDiscordWebhookUrl } from "../../core";
import {
  discordContent,
  discordForm,
  discordPayload,
  executeWebhookUrl,
  parseDiscordResponse,
  webhookMessageUrl,
} from "./discord-api";

const TOKEN = "abcdefghijklmnopqrstuvwxyz_ABCDEFG-0123456789";

describe("parseDiscordWebhookUrl", () => {
  it("reads the spellings Discord hands out", () => {
    for (const host of [
      "discord.com",
      "discordapp.com",
      "ptb.discord.com",
      "canary.discord.com",
    ]) {
      expect(
        parseDiscordWebhookUrl(
          `https://${host}/api/webhooks/123456789012345678/${TOKEN}`,
        ),
      ).toEqual({ id: "123456789012345678", token: TOKEN });
    }
    expect(
      parseDiscordWebhookUrl(
        `https://discord.com/api/v10/webhooks/123456789012345678/${TOKEN}/`,
      ),
    ).toEqual({ id: "123456789012345678", token: TOKEN });
  });

  it("refuses anything else", () => {
    expect(parseDiscordWebhookUrl("")).toBeNull();
    expect(
      parseDiscordWebhookUrl(
        `http://discord.com/api/webhooks/123456789012345678/${TOKEN}`,
      ),
    ).toBeNull();
    expect(
      parseDiscordWebhookUrl(
        `https://evil.com/api/webhooks/123456789012345678/${TOKEN}`,
      ),
    ).toBeNull();
    expect(
      parseDiscordWebhookUrl(
        `https://discord.com.evil.com/api/webhooks/123456789012345678/${TOKEN}`,
      ),
    ).toBeNull();
    expect(
      parseDiscordWebhookUrl("https://discord.com/api/webhooks/abc/def"),
    ).toBeNull();
  });
});

describe("request builder", () => {
  const hook = { id: "42", token: "t0k" };

  it("targets discord.com's v10 API, waiting for the message", () => {
    expect(executeWebhookUrl(hook)).toBe(
      "https://discord.com/api/v10/webhooks/42/t0k?wait=true",
    );
    expect(webhookMessageUrl(hook, "99")).toBe(
      "https://discord.com/api/v10/webhooks/42/t0k/messages/99",
    );
  });

  it("bolds the title, escaping its asterisks, and joins paragraphs with blank lines", () => {
    expect(
      discordContent({
        title: "Use *two* panes",
        paragraphs: ["One.", "Two."],
      }),
    ).toBe("**Use \\*two\\* panes**\n\nOne.\n\nTwo.");
    expect(discordContent({ title: null, paragraphs: ["Only text"] })).toBe(
      "Only text",
    );
  });

  it("lists each file as an attachment by index, and parses no mentions", () => {
    expect(discordPayload("hi", ["a.png", "b.mp4"])).toEqual({
      content: "hi",
      allowed_mentions: { parse: [] },
      attachments: [
        { id: 0, filename: "a.png" },
        { id: 1, filename: "b.mp4" },
      ],
    });
  });

  it("builds the multipart: payload_json, then files[i] named as attached", async () => {
    const form = discordForm("hi", [
      { filename: "a.png", mime: "image/png", blob: new Blob(["png"]) },
      { filename: "b.mp4", mime: "video/mp4", blob: new Blob(["mp4!"]) },
    ]);
    expect(JSON.parse(String(form.get("payload_json")))).toEqual(
      discordPayload("hi", ["a.png", "b.mp4"]),
    );
    const a = form.get("files[0]") as File;
    const b = form.get("files[1]") as File;
    expect(a.name).toBe("a.png");
    expect(a.type).toBe("image/png");
    expect(await b.text()).toBe("mp4!");
  });
});

describe("parseDiscordResponse", () => {
  it("reads a posted message's id", () => {
    expect(
      parseDiscordResponse(
        200,
        JSON.stringify({ id: "111", content: "x" }),
        "message",
      ),
    ).toEqual({ kind: "message", id: "111" });
  });

  it("refuses a 2xx without an id", () => {
    const a = parseDiscordResponse(200, "{}", "message");
    expect(a.kind).toBe("failed");
    expect(a.kind === "failed" && a.retryable).toBe(false);
  });

  it("reads a delete's 204", () => {
    expect(parseDiscordResponse(204, "", "deleted")).toEqual({
      kind: "deleted",
    });
  });

  it("tells a deleted message from a deleted webhook", () => {
    expect(
      parseDiscordResponse(
        404,
        JSON.stringify({ message: "Unknown Message", code: 10008 }),
        "message",
      ),
    ).toEqual({ kind: "unknown-message" });
    expect(
      parseDiscordResponse(
        404,
        JSON.stringify({ message: "Unknown Webhook", code: 10015 }),
        "deleted",
      ).kind,
    ).toBe("unknown-webhook");
  });

  it("retries a rate limit, keeping retry_after", () => {
    const a = parseDiscordResponse(
      429,
      JSON.stringify({
        message: "You are being rate limited.",
        retry_after: 1.25,
        global: false,
      }),
      "message",
    );
    expect(a).toMatchObject({
      kind: "failed",
      retryable: true,
      retryAfterMs: 1250,
    });
  });

  it("retries a 5xx, not a 4xx", () => {
    expect(parseDiscordResponse(502, "Bad gateway", "message")).toMatchObject({
      kind: "failed",
      retryable: true,
    });
    expect(
      parseDiscordResponse(
        400,
        JSON.stringify({ message: "Invalid Form Body", code: 50035 }),
        "message",
      ),
    ).toMatchObject({
      kind: "failed",
      retryable: false,
      error: expect.stringContaining("Invalid Form Body"),
    });
    expect(parseDiscordResponse(413, "", "message")).toMatchObject({
      kind: "failed",
      retryable: false,
    });
  });
});
