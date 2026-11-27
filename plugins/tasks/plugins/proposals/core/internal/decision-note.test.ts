/**
 * A decision's note is the prompt editor's markdown (`PromptMarkdown`): the
 * body has no spelling that takes a plain field's string, so the review's
 * Request changes cannot be a ui-kit `Textarea` again (the `@ts-expect-error`
 * is checked by type-check).
 *
 * Run: `./equin test plugins/tasks/plugins/proposals`.
 */
import { describe, expect, test } from "bun:test";
import { PromptMarkdownSchema } from "@plugins/primitives/plugins/text-editor/core";
import { DecideProposalBodySchema, type DecideProposalBody } from "./endpoints";

describe("proposals: a decision's note", () => {
  test("a plain string does not compile as the note", () => {
    const typed: string = "make it shorter";
    const plain: DecideProposalBody = {
      decision: "request-changes",
      // @ts-expect-error — a Textarea's text is a `string`, not `PromptMarkdown`
      note: typed,
    };
    expect(plain.decision).toBe("request-changes");
  });

  test("the editor's markdown, attachment refs and all, is taken", () => {
    const note = PromptMarkdownSchema.parse(
      "like this ![shot](/api/attachments/att-1)",
    );
    const body: DecideProposalBody = { decision: "request-changes", note };
    expect(DecideProposalBodySchema.parse(body)).toEqual(body);
  });

  test("an empty change request is refused", () => {
    expect(
      DecideProposalBodySchema.safeParse({
        decision: "request-changes",
        note: "",
      }).success,
    ).toBe(false);
  });
});
