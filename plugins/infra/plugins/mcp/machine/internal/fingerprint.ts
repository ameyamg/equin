import { createHash } from "node:crypto";
import { z } from "zod";
import type { McpTool } from "../../server";

/**
 * What a tool hands a client at `tools/list`, as one digest: its name, fixed
 * description and input schema (as JSON Schema). A client keeps them for the
 * session, so a change to any of them — not only a tool appearing or going —
 * leaves it with stale instructions or a schema the server now refuses
 * (dbf4fa023a reworded `turn_for` and added a field; sessions connected before
 * it kept the old text). The live description section is left out: it is by
 * definition the data as of the listing, and rendering it on every call to
 * compare would make every call pay for it. Memoized per tool object — a tool
 * is fixed once registered.
 */
const toolDigests = new WeakMap<McpTool, string>();

function toolDigest(tool: McpTool): string {
  const known = toolDigests.get(tool);
  if (known !== undefined) return known;
  const schema = z.toJSONSchema(z.object(tool.inputSchema), {
    io: "input",
    unrepresentable: "any",
  });
  const digest = sha256(JSON.stringify([tool.name, tool.description, schema]));
  toolDigests.set(tool, digest);
  return digest;
}

/**
 * The fingerprint of a set of tools as a listing hands them: their digests in
 * name order, so the order they were mounted in is no change.
 */
export function listingFingerprint(tools: readonly McpTool[]): string {
  return sha256(
    [...tools]
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      .map(toolDigest)
      .join("\n"),
  );
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
