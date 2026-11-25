import { z } from "zod";
import {
  defineAuthProvider,
  type AuthIdentity,
  type AuthProviderDescriptor,
} from "@plugins/auth/core";
import {
  CLOUDFLARE_PROVIDER_ID,
  CLOUDFLARE_TOKEN_PERMISSIONS,
  CLOUDFLARE_TOKEN_VERIFY_URL,
} from "../../core";

/** `GET /user/tokens/verify`'s answer: the v4 envelope around the token's status. */
const VerifySchema = z.object({
  success: z.boolean(),
  errors: z.array(z.object({ message: z.string() })),
  result: z.object({ status: z.string() }).nullable().optional(),
});

/**
 * Accept the token only once Cloudflare says it is a live token
 * (`status: "active"`). Without this, `setApiKey` stores any string as
 * Connected. What it may do on which zone is checked where it is used: a
 * `cloudflare` deploy reads the hostnames' zones and probes a purge on each
 * before it touches the host (`framework/cli/deploy`, `edge-purge.ts`).
 */
async function verifyCloudflareToken(token: string): Promise<AuthIdentity> {
  const res = await fetch(CLOUDFLARE_TOKEN_VERIFY_URL, {
    headers: { Authorization: `Bearer ${token}` },
  }).catch((err: unknown) => {
    throw new Error(
      `Could not reach Cloudflare to verify the token — check this machine's internet connection. (${
        err instanceof Error ? err.message : String(err)
      })`,
    );
  });
  const raw = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch (err) {
    if (!(err instanceof SyntaxError)) throw err;
    throw new Error(
      `Cloudflare's token check answered HTTP ${res.status}, not JSON: ${raw.slice(0, 300)}`,
    );
  }
  const parsed = VerifySchema.safeParse(body);
  if (!parsed.success) {
    throw new Error(
      `Cloudflare's token check answered an unknown shape (HTTP ${res.status}): ${raw.slice(0, 300)}`,
    );
  }
  const { success, errors, result } = parsed.data;
  if (!res.ok || !success) {
    throw new Error(
      `Cloudflare rejected this token (HTTP ${res.status}): ${
        errors.map((e) => e.message).join("; ") || "no reason given"
      }. Create it under My Profile → API Tokens with ${CLOUDFLARE_TOKEN_PERMISSIONS.join(" and ")}.`,
    );
  }
  if (result?.status !== "active") {
    throw new Error(
      `This Cloudflare token is ${result?.status ?? "of unknown status"}, not active.`,
    );
  }
  return { accountId: "primary", displayName: "Cloudflare API token" };
}

export const cloudflareDescriptor: AuthProviderDescriptor = defineAuthProvider({
  id: CLOUDFLARE_PROVIDER_ID,
  name: "Cloudflare",
  kind: "apikey",
  apiKey: {
    help: `Create a Custom Token in Cloudflare → My Profile → API Tokens with ${CLOUDFLARE_TOKEN_PERMISSIONS.join(" and ")}, scoped to your site's zone.`,
    verify: verifyCloudflareToken,
  },
});
