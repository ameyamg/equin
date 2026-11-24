import { lintRuleCreator } from "@plugins/framework/plugins/tooling/plugins/lint/core";

const createRule = lintRuleCreator(import.meta.url);

/** The barrel `SingleLineProvider` is published from. */
const UI_KIT_BARREL = "@plugins/primitives/plugins/css/plugins/ui-kit/web";

/**
 * Bans importing `SingleLineProvider` outside the layout primitives that
 * implement a line or flow container (`Line`, `Row`, `Bar`, `Stack`,
 * `Column`, …; each declares a sanctioned exemption in its own
 * `exempt/index.ts`).
 *
 * The raw provider is a footgun: wrapped around a flow container (a column
 * `Stack`, a `Column`) it is a silent no-op, because that container resets the
 * single-line contract for its children — the code reads as truncating and
 * wraps. A `<Line>` is the provider AND the `region-line` box together, placed
 * where the line is, so it cannot be put on the wrong side of a reset.
 */
export default createRule({
  name: "no-raw-single-line-provider",
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow importing SingleLineProvider outside the layout primitives — wrap the line in <Line>.",
    },
    schema: [],
    messages: {
      rawProvider:
        "Wrap the text that must stay on one line in `<Line>` " +
        "(@plugins/primitives/plugins/css/plugins/line/web) instead of a raw " +
        "`SingleLineProvider`: around a flow container (a column Stack, a " +
        "Column) the provider is silently reset, so the text still wraps.",
    },
  },
  defaultOptions: [],
  create(context) {
    return {
      ImportDeclaration(node) {
        if (node.source.value !== UI_KIT_BARREL) return;
        for (const spec of node.specifiers) {
          if (
            spec.type === "ImportSpecifier" &&
            spec.imported.type === "Identifier" &&
            spec.imported.name === "SingleLineProvider"
          )
            context.report({ node: spec, messageId: "rawProvider" });
        }
      },
    };
  },
});
