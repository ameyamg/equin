import { describe, expect, it } from "bun:test";
import {
  DOCUMENT_BLOCK_TYPES,
  parseDocument,
  serializeDocument,
  type DocumentDialect,
} from "./dialect";
import { serializeDocumentKeeping } from "./keep-spelling";

const MAIL: DocumentDialect = {
  blocks: DOCUMENT_BLOCK_TYPES,
  blankLines: "empty-block",
  emptyBlocks: "blank-line",
  softBreaks: "newline",
};

describe("serializeDocumentKeeping", () => {
  const edit = (previous: string, change: (src: string) => string) => {
    // A rich edit: the forest of the previous text, changed.
    const forest = parseDocument(change(previous), MAIL);
    return serializeDocumentKeeping(forest, previous, MAIL);
  };

  it("keeps the spelling of every line the edit did not touch", () => {
    const previous = ["- one", "say _plainly_", "- two"].join("\n");
    expect(edit(previous, (s) => s.replace("two", "two!"))).toBe(
      ["- one", "say _plainly_", "* two!"].join("\n"),
    );
  });

  it("keeps the spelling around inserted and removed lines", () => {
    const previous = ["_a_", "- b", "_c_"].join("\n");
    expect(edit(previous, () => "_a_\n\nnew\n_c_")).toBe(
      ["_a_", "", "new", "_c_"].join("\n"),
    );
  });

  it("answers the previous text unchanged when the forest is unchanged", () => {
    const previous = "- x\n_y_ and __z__";
    expect(edit(previous, (s) => s)).toBe(previous);
  });

  it("writes canonically where lines don't map one to one", () => {
    const previous = "<quote>one</quote>\n_x_";
    const out = edit(previous, (s) => s.replace("_x_", "_x2_"));
    expect(serializeDocument(parseDocument(out, MAIL), MAIL)).toBe(
      serializeDocument(
        parseDocument(previous.replace("_x_", "_x2_"), MAIL),
        MAIL,
      ),
    );
  });
});
