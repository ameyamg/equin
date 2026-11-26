import { lintRuleCreator } from "@plugins/framework/plugins/tooling/plugins/lint/core";

/**
 * no-raw-content-disposition
 *
 * A `Content-Disposition` header carries a filename, and a header value must
 * be a latin-1 ByteString: a name with an em dash, an accent or an emoji
 * written into it raw makes `new Response` throw (report-1795700584-vvbscp,
 * every tab recording's attachment answered 500). `contentDisposition(type,
 * filename)` from `@plugins/infra/plugins/endpoints/core` spells the header —
 * key and value — with an ASCII fallback and the RFC 8187 `filename*`, so a
 * caller passes a filename and never writes the header.
 *
 * Flags any string literal or template naming the header (case-insensitive) —
 * an object key, a `headers.set(…)` / `.get(…)` argument — outside the
 * builder's own file and this rule's (sanctioned in endpoints' exempt/index.ts).
 *
 * No flaw: the platform's `Headers` / `ResponseInit` take any string as a
 * header name, so the builder cannot be the only way to spell it; this rule
 * routes the one header whose value needs encoding through it.
 */

const createRule = lintRuleCreator(import.meta.url);

const HEADER = "content-disposition";

export default createRule({
  name: "no-raw-content-disposition",
  meta: {
    type: "problem",
    docs: {
      description:
        "Spell the Content-Disposition header only through contentDisposition(type, filename), which encodes a non-ASCII filename.",
    },
    schema: [],
    messages: {
      raw:
        "Do not spell the Content-Disposition header name by hand: to send " +
        "it, spread " +
        '`...contentDisposition("inline" | "attachment", filename)` from ' +
        "`@plugins/infra/plugins/endpoints/core`. A raw filename with a " +
        "non-ASCII character (an em dash, an accent, an emoji) is not a " +
        "valid header value and makes `new Response` throw. A file that " +
        "must read the header (a download or multipart parser) declares a " +
        "sanctioned exemption in its plugin's exempt/index.ts.",
    },
  },
  defaultOptions: [],
  create(context) {
    return {
      Literal(node) {
        if (
          typeof node.value === "string" &&
          node.value.trim().toLowerCase() === HEADER
        )
          context.report({ node, messageId: "raw" });
      },
      TemplateLiteral(node) {
        if (
          node.expressions.length === 0 &&
          node.quasis[0]?.value.cooked?.trim().toLowerCase() === HEADER
        )
          context.report({ node, messageId: "raw" });
      },
    };
  },
});
