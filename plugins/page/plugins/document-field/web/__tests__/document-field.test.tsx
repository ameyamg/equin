/**
 * The document field against real Lexical editors (jsdom): its two faces read
 * and write one text, the format toolbar's source acts on each face in its own
 * spelling, and typing autoformats in Rich.
 *
 * Typing is driven through the model (`insertText` one character per update) —
 * jsdom has no `beforeinput` — which is the same per-keystroke update the
 * autoformat and block-shortcut listeners see from a real key.
 */

import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { useState } from "react";
import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  INSERT_LINE_BREAK_COMMAND,
  KEY_DOWN_COMMAND,
  type LexicalEditor,
} from "lexical";
import {
  DOCUMENT_BLOCK_TYPES,
  serializeDocument,
  type DocumentDialect,
} from "../../core";
import {
  DocumentField,
  type DocumentFieldMode,
} from "../components/document-field";
import { $rootForest } from "../internal/forest-lexical";
import {
  $selectSource,
  $sourceText,
  markdownFormatSource,
} from "../internal/markdown-mode";
import { $leafBlocks } from "../internal/forest-lexical";
import { $pointWithin, $selectPoints } from "../internal/lexical-offsets";

afterEach(cleanup);

// jsdom has no layout: the format toolbar's placement reads range rects.
beforeAll(() => {
  const empty = () => [] as unknown as DOMRectList;
  Range.prototype.getClientRects ??= empty;
  Range.prototype.getBoundingClientRect ??= () => new DOMRect();
});

/** ⌘B, as the keyboard sends it — through the field's own shortcut plugin. */
function pressModB(editor: LexicalEditor) {
  editor.dispatchCommand(
    KEY_DOWN_COMMAND,
    new KeyboardEvent("keydown", { key: "b", metaKey: true }),
  );
}

const MAIL: DocumentDialect = {
  blocks: DOCUMENT_BLOCK_TYPES,
  blankLines: "empty-block",
  emptyBlocks: "blank-line",
  softBreaks: "newline",
};

const BODY = [
  "Hi Maya,",
  "",
  "Agreed on **Q2**, could you:",
  "* name an owner for [signing](https://docs.example.com/s)",
  "* say *plainly* what slips, and <u>why</u>",
  "  * nested ~~one~~",
  "1. first `code`",
  "2. second",
  "## A heading",
  "---",
  "```ts",
  "const x = 1;",
  "```",
  "<quote>",
  '  Before the <color value="red">freeze</color>?',
  "</quote>",
].join("\n");

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

function editorsIn(container: HTMLElement): {
  rich: LexicalEditor;
  markdown: LexicalEditor;
} {
  const roots = [
    ...container.querySelectorAll<HTMLElement>("[contenteditable]"),
  ];
  const editorOf = (el: HTMLElement) =>
    (el as unknown as { __lexicalEditor: LexicalEditor }).__lexicalEditor;
  return { rich: editorOf(roots[0]!), markdown: editorOf(roots[1]!) };
}

function mount(initial = BODY) {
  const changes: string[] = [];
  let setMode: (m: DocumentFieldMode) => void = () => {};
  function Host() {
    const [mode, set] = useState<DocumentFieldMode>("rich");
    setMode = set;
    return (
      <DocumentField
        initial={initial}
        onChange={(v) => changes.push(v)}
        mode={mode}
        onModeChange={set}
        dialect={MAIL}
        ariaLabel="Message"
      />
    );
  }
  const { container } = render(<Host />);
  return {
    container,
    changes,
    switchTo: (m: DocumentFieldMode) => act(() => setMode(m)),
    ...editorsIn(container),
  };
}

function typeInto(editor: LexicalEditor, text: string) {
  for (const ch of text) {
    editor.update(
      () => {
        const s = $getSelection();
        if (!$isRangeSelection(s)) throw new Error("no caret to type at");
        s.insertText(ch);
      },
      { discrete: true },
    );
  }
}

describe("one text, two faces", () => {
  it("the rich face reads the text back exactly", () => {
    const { rich, markdown } = mount();
    expect(
      rich.getEditorState().read(() => serializeDocument($rootForest(), MAIL)),
    ).toBe(BODY);
    expect(markdown.getEditorState().read($sourceText)).toBe(BODY);
  });

  it("an edit in Markdown reaches Rich, and back, through the text", async () => {
    const { markdown, rich, changes, switchTo } = mount();
    switchTo("markdown");
    act(() => {
      markdown.update(() => $selectSource(BODY.length, BODY.length), {
        discrete: true,
      });
      typeInto(markdown, "\n**late**");
    });
    await act(flush);
    expect(changes.at(-1)).toBe(BODY + "\n**late**");
    switchTo("rich");
    const text = rich
      .getEditorState()
      .read(() => $leafBlocks().at(-1)!.getTextContent());
    expect(text).toBe("late");
    // An untouched switch back holds the text it had: nothing is rewritten.
    switchTo("markdown");
    expect(markdown.getEditorState().read($sourceText)).toBe(
      BODY + "\n**late**",
    );
  });

  it("Markdown draws marks on their own text and keeps the text whole", () => {
    const { markdown } = mount("say **bold** now");
    const nodes = markdown.getEditorState().read(() =>
      $getRoot()
        .getAllTextNodes()
        .map((n) => [
          n.getTextContent(),
          n.hasFormat("bold"),
          n.getStyle() !== "",
        ]),
    );
    expect(nodes).toEqual([
      ["say ", false, false],
      ["**", false, true],
      ["bold", true, false],
      ["**", false, true],
      [" now", false, false],
    ]);
  });
});

describe("the toolbar's format source", () => {
  it("in Rich, ⌘B makes the selected text bold (a format bit)", async () => {
    const { rich } = mount("say plainly");
    await act(async () => {
      rich.update(
        () => {
          const line = $leafBlocks()[0]!;
          if (!("getChildren" in line)) throw new Error("not a line");
          $selectPoints($pointWithin(line, 4), $pointWithin(line, 11));
        },
        { discrete: true },
      );
      pressModB(rich);
      await flush();
    });
    const forest = rich.getEditorState().read($rootForest);
    expect((forest[0]!.data as { text: unknown }).text).toEqual([
      { text: "say " },
      { text: "plainly", marks: ["bold"] },
    ]);
  });

  it("in Markdown, bold, underline and colour are written in the dialect", async () => {
    const { markdown, changes } = mount("say plainly");
    const source = markdownFormatSource(MAIL);
    // ⌘B through the shortcut plugin: the same source the toolbar uses.
    await act(async () => {
      markdown.update(() => $selectSource(4, 11), { discrete: true });
      pressModB(markdown);
      await flush();
    });
    expect(changes.at(-1)).toBe("say **plainly**");
    // The selection stayed on the words, so the snapshot reads bold.
    expect(
      markdown.getEditorState().read(() => source.$read().active.bold),
    ).toBe(true);
    act(() => {
      markdown.update(
        () => {
          $selectSource(0, 3);
          source.$toggleMark("underline");
        },
        { discrete: true },
      );
    });
    expect(markdown.getEditorState().read($sourceText)).toBe(
      "<u>say</u> **plainly**",
    );
    act(() => {
      markdown.update(
        () => {
          const t = $sourceText();
          $selectSource(t.indexOf("say"), t.indexOf("say") + 3);
          source.$setColor("red");
        },
        { discrete: true },
      );
    });
    expect(markdown.getEditorState().read($sourceText)).toMatch(
      /^<color value="red"><u>say<\/u><\/color> |^<u><color value="red">say<\/color><\/u> /,
    );
  });
});

describe("typing in Rich", () => {
  it("closing `**x**` bolds x", async () => {
    const { rich, changes } = mount("");
    const caretAtEnd = () =>
      rich.update(() => $getRoot().selectEnd(), { discrete: true });
    await act(async () => {
      caretAtEnd();
      typeInto(rich, "a **b**");
      await flush();
    });
    expect(changes.at(-1)).toBe("a **b**");
    const marks = rich.getEditorState().read(() =>
      $getRoot()
        .getAllTextNodes()
        .filter($isTextNode)
        .map((n) => [n.getTextContent(), n.hasFormat("bold")]),
    );
    expect(marks).toEqual([
      ["a ", false],
      ["b", true],
    ]);
  });

  it.each([
    ["- ", "item", "* item"],
    ["1. ", "first", "1. first"],
    ["## ", "Title", "## Title"],
    ["| ", "quoted", "<quote>\n  quoted\n</quote>"],
  ])(
    "typing `%s` at a line's start makes that block",
    async (prefix, words, text) => {
      const { rich, changes } = mount("");
      await act(async () => {
        rich.update(() => $getRoot().selectEnd(), { discrete: true });
        typeInto(rich, prefix);
        await flush();
        typeInto(rich, words);
        await flush();
      });
      expect(changes.at(-1)).toBe(text);
    },
  );
});

describe("review fixes", () => {
  it("Markdown re-cuts a line as it is typed", () => {
    const { markdown, switchTo } = mount("say ");
    switchTo("markdown");
    act(() => {
      markdown.update(() => $selectSource(4, 4), { discrete: true });
      typeInto(markdown, "**x**");
    });
    const bold = markdown.getEditorState().read(() =>
      $getRoot()
        .getAllTextNodes()
        .filter((n) => n.hasFormat("bold"))
        .map((n) => n.getTextContent()),
    );
    expect(bold).toEqual(["x"]);
  });

  it("Shift+Enter in Rich starts a new block when the dialect spells breaks as newlines", async () => {
    const { rich, changes } = mount("* a");
    await act(async () => {
      rich.update(() => $getRoot().selectEnd(), { discrete: true });
      rich.dispatchCommand(INSERT_LINE_BREAK_COMMAND, false);
      await flush();
      typeInto(rich, "b");
      await flush();
    });
    expect(changes.at(-1)).toBe("* a\n* b");
  });
});
