import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { PlainTextPlugin } from "@lexical/react/LexicalPlainTextPlugin";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { LinkPlugin } from "@lexical/react/LexicalLinkPlugin";
import { ClickableLinkPlugin } from "@lexical/react/LexicalClickableLinkPlugin";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { LinkNode } from "@lexical/link";
import {
  $addUpdateTag,
  COMMAND_PRIORITY_LOW,
  HISTORY_PUSH_TAG,
  KEY_DOWN_COMMAND,
  type LexicalEditor,
} from "lexical";
import type { ClassName } from "@plugins/primitives/plugins/css/plugins/ui-kit/core";
import { cn } from "@plugins/primitives/plugins/css/plugins/ui-kit/web";
import { localUndoProps } from "@plugins/primitives/plugins/undo-redo/web";
import { focusElement } from "@plugins/primitives/plugins/dom/plugins/scroll-reveal/web";
import { Pin } from "@plugins/primitives/plugins/css/plugins/pin/web";
import { Text } from "@plugins/primitives/plugins/css/plugins/text/web";
import { useLatestRef } from "@plugins/primitives/plugins/latest-ref/web";
import {
  BLOCK_TEXT_THEME,
  FormatShortcutsPlugin,
  FormatSourceProvider,
  FormatToolbarPlugin,
  InlineAutoformatPlugin,
  isValidLinkUrl,
  scheduleWithLexicalHistory,
} from "@plugins/page/plugins/editor/web";
import {
  parseDocument,
  serializeDocumentKeeping,
  type BlockPoint,
  type DocumentDialect,
} from "../../core";
import { $rootForest, $setRootForest } from "../internal/forest-lexical";
import {
  $markdownBlockSelection,
  $selectMarkdownBlocks,
  $setSourceText,
  $sourceText,
  markdownFormatSource,
  SourceCutPlugin,
} from "../internal/markdown-mode";
import { DOC_RICH_NODES } from "../internal/nodes";
import {
  $caretInCode,
  BlockShortcutsPlugin,
  MarkersPlugin,
  NormalizePlugin,
  RichKeysPlugin,
} from "../internal/rich-plugins";
import {
  $richBlockSelection,
  $selectRichBlocks,
} from "../internal/rich-selection";

/** Which face of the field is shown: the formatted text, or its markdown. */
export type DocumentFieldMode = "rich" | "markdown";

export interface DocumentFieldProps {
  /** The text the field opens with, in the dialect. Read ONCE, on mount. */
  initial: string;
  /** Every change of the text, in the dialect. */
  onChange(value: string): void;
  /** The face shown. Switching keeps the text, the caret and each face's undo. */
  mode: DocumentFieldMode;
  /** ⌘⇧M asks for the other face. Without it, the shortcut does nothing. */
  onModeChange?(mode: DocumentFieldMode): void;
  /** The text format: which blocks, how blank lines and breaks are spelled. */
  dialect: DocumentDialect;
  ariaLabel: string;
  placeholder?: string;
  className?: ClassName;
  /**
   * Shown, not edited (a reply's quoted original under the body): both faces
   * still switch with `mode`, with no toolbar, shortcuts or autoformat.
   */
  readOnly?: boolean;
  /** Takes the focus on mount, the caret at the text's end. */
  autoFocus?: boolean;
}

/** The update that seeds a face with text the other face wrote. */
const SEED_TAG = "document-field-seed";

/** One face's live state, shared by the field and the face's own plugin. */
class Face {
  editor: LexicalEditor | null = null;
  /** The value this face's content stands for — what it last wrote, or was seeded with. */
  holds: string;
  /**
   * What reading this face's content gave last. A change the face did not
   * make to its text (a transform registering, a re-cut) reads the same and is
   * not reported: only a new reading is an edit.
   */
  reads: string | null = null;
  focused = false;
  constructor(holds: string) {
    this.holds = holds;
  }
  attach(editor: LexicalEditor | null): void {
    this.editor = editor;
  }
  setFocused(focused: boolean): void {
    this.focused = focused;
  }
  hold(value: string): void {
    this.holds = value;
  }
  read(value: string | null): void {
    this.reads = value;
  }
}

type BlockSelection = { anchor: BlockPoint; focus: BlockPoint };

/**
 * One field holding a whole document — paragraphs, headings, lists, a quote,
 * code, dividers — read and written as Pages' text format (the dialect's
 * markdown, `**`, `<u>`, `<color value>` and all), shown either formatted
 * (`rich`) or as that markdown with its syntax dimmed (`markdown`). Both faces
 * are editable, with the page editor's selection toolbar and shortcuts; in
 * Markdown a format is written as the dialect spells it.
 *
 * - Rich is ONE Lexical editor whose root holds the blocks, read and written as
 *   Pages' block forest through `parseDocument` / `serializeDocument`.
 * - Markdown is a plain-text editor over the very string, cut for display by
 *   the same parser's reading (`sourceLines`), so the faces cannot disagree.
 *
 * Both faces stay mounted (the hidden one is `display: none`), each with its
 * own history: switching seeds the face being shown only when the text moved on
 * since it last held it — as one undo entry there — and carries the caret by
 * block and text offset.
 */
export function DocumentField({
  initial,
  onChange,
  mode,
  onModeChange,
  dialect,
  ariaLabel,
  placeholder,
  className,
  readOnly = false,
  autoFocus = false,
}: DocumentFieldProps) {
  const value = useRef(initial);
  // A change a face could not write as text (the inline serializer refused
  // it): the value stays the last one written, and the field says so.
  const [unwritable, setUnwritable] = useState<Error | null>(null);
  const onChangeRef = useLatestRef(onChange);
  const [faces] = useState<Record<DocumentFieldMode, Face>>(() => ({
    rich: new Face(initial),
    markdown: new Face(initial),
  }));
  const report = useCallback(
    (face: Face, next: string) => {
      setUnwritable(null);
      face.hold(next);
      if (next === value.current) return;
      value.current = next;
      onChangeRef.current(next);
    },
    [onChangeRef],
  );

  const shown = useRef(mode);
  useLayoutEffect(() => {
    const from = shown.current;
    if (from === mode) return;
    shown.current = mode;
    const source = faces[from];
    const target = faces[mode];
    if (!source.editor || !target.editor)
      throw new Error("DocumentField: a mode switch before both faces mounted");
    const root = source.editor.getRootElement();
    const focused =
      source.focused ||
      (root !== null && root.contains(document.activeElement));
    const selection: BlockSelection | null = source.editor
      .getEditorState()
      .read(() =>
        from === "rich"
          ? $richBlockSelection()
          : $markdownBlockSelection(dialect),
      );
    const seed = target.holds !== value.current;
    const targetRoot = target.editor.getRootElement();
    // The caret moves with the user's own switch: keep it in view.
    if (focused && targetRoot) focusElement(targetRoot, { reveal: true });
    target.editor.update(
      () => {
        if (seed) {
          $addUpdateTag(SEED_TAG);
          $addUpdateTag(HISTORY_PUSH_TAG);
          if (mode === "rich")
            $setRootForest(parseDocument(value.current, dialect));
          else $setSourceText(value.current);
        }
        if (focused && selection) {
          if (mode === "rich") $selectRichBlocks(selection);
          else $selectMarkdownBlocks(selection, dialect);
        }
      },
      { discrete: true },
    );
    if (seed) target.hold(value.current);
  }, [mode, dialect, faces]);

  // Each face's editor is attached by its own plugin's effect, which runs
  // before this one.
  const autoFocusRef = useRef(autoFocus);
  useEffect(() => {
    if (!autoFocusRef.current) return;
    const editor = faces[shown.current].editor;
    if (!editor)
      throw new Error("DocumentField: autoFocus before the face mounted");
    editor.focus(undefined, { defaultSelection: "rootEnd" });
  }, [faces]);

  const toggleMode = useMemo(
    () =>
      onModeChange
        ? () => onModeChange(shown.current === "rich" ? "markdown" : "rich")
        : null,
    [onModeChange],
  );

  const mdSource = useMemo(() => markdownFormatSource(dialect), [dialect]);
  const editable = cn("min-h-[1.5em] outline-none", className);
  const placeholderNode =
    placeholder && !readOnly ? (
      // `base`: it shares its box with the caret and must not paint over it.
      <Pin
        to="top-left"
        layer="base"
        decorative
        aria-hidden
        className="text-body text-muted-foreground"
      >
        {placeholder}
      </Pin>
    ) : null;

  return (
    <div className="relative">
      <div className="relative" hidden={mode !== "rich"}>
        <LexicalComposer
          initialConfig={{
            namespace: "document-field-rich",
            theme: BLOCK_TEXT_THEME,
            editable: !readOnly,
            nodes: [LinkNode, ...DOC_RICH_NODES],
            onError: (error: Error) => {
              throw error;
            },
            editorState: () => $setRootForest(parseDocument(initial, dialect)),
          }}
        >
          <RichTextPlugin
            contentEditable={
              <ContentEditable
                {...localUndoProps}
                aria-label={ariaLabel}
                className={cn(editable, "[--lexical-indent-base-value:1.5rem]")}
              />
            }
            placeholder={placeholderNode}
            ErrorBoundary={LexicalErrorBoundary}
          />
          <HistoryPlugin />
          <LinkPlugin validateUrl={isValidLinkUrl} />
          <ClickableLinkPlugin newTab />
          {readOnly ? null : (
            <>
              <FormatShortcutsPlugin />
              <FormatToolbarPlugin />
              <InlineAutoformatPlugin
                schedule={scheduleWithLexicalHistory}
                $skip={$caretInCode}
              />
              <RichKeysPlugin dialect={dialect} />
              <BlockShortcutsPlugin dialect={dialect} />
            </>
          )}
          <NormalizePlugin />
          <MarkersPlugin />
          <FacePlugin
            face={faces.rich}
            // Only the lines an edit touched are respelled: the rest keep the
            // spelling the text has (`- `, `_x_`), whoever wrote it.
            read={() =>
              serializeDocumentKeeping($rootForest(), value.current, dialect)
            }
            report={report}
            unwritable={setUnwritable}
            toggleMode={toggleMode}
          />
        </LexicalComposer>
      </div>
      <div className="relative" hidden={mode !== "markdown"}>
        <LexicalComposer
          initialConfig={{
            namespace: "document-field-markdown",
            theme: BLOCK_TEXT_THEME,
            editable: !readOnly,
            onError: (error: Error) => {
              throw error;
            },
            editorState: () => $setSourceText(initial),
          }}
        >
          <PlainTextPlugin
            contentEditable={
              <ContentEditable
                {...localUndoProps}
                aria-label={ariaLabel}
                className={cn(editable, "whitespace-pre-wrap text-body")}
              />
            }
            placeholder={placeholderNode}
            ErrorBoundary={LexicalErrorBoundary}
          />
          <HistoryPlugin />
          {readOnly ? null : (
            <FormatSourceProvider value={mdSource}>
              <FormatShortcutsPlugin />
              <FormatToolbarPlugin />
            </FormatSourceProvider>
          )}
          <SourceCutPlugin dialect={dialect} />
          <FacePlugin
            face={faces.markdown}
            read={$sourceText}
            report={report}
            unwritable={setUnwritable}
            toggleMode={toggleMode}
          />
        </LexicalComposer>
      </div>
      {unwritable ? (
        <Text as="p" role="alert" variant="caption" tone="destructive">
          Your last change can't be written as text, so it isn't saved (
          {unwritable.message}). Undo it (⌘Z) to go on.
        </Text>
      ) : null}
    </div>
  );
}

/** Wires one face to the field: its editor, its focus, its value, ⌘⇧M. */
function FacePlugin({
  face,
  read,
  report,
  unwritable,
  toggleMode,
}: {
  face: Face;
  read: () => string;
  report: (face: Face, value: string) => void;
  /** A change this face's content could not be read as text for. */
  unwritable: (error: Error) => void;
  toggleMode: (() => void) | null;
}) {
  const [editor] = useLexicalComposerContext();
  const readRef = useLatestRef(read);
  const reportRef = useLatestRef(report);
  const unwritableRef = useLatestRef(unwritable);
  const toggleRef = useLatestRef(toggleMode);

  useEffect(() => {
    face.attach(editor);
    face.read(editor.getEditorState().read(readRef.current));
    return () => face.attach(null);
  }, [editor, face, readRef]);

  useEffect(() => {
    const onFocus = () => face.setFocused(true);
    const onBlur = () => face.setFocused(false);
    let current: HTMLElement | null = null;
    const off = editor.registerRootListener((root, prev) => {
      prev?.removeEventListener("focus", onFocus);
      prev?.removeEventListener("blur", onBlur);
      root?.addEventListener("focus", onFocus);
      root?.addEventListener("blur", onBlur);
      current = root;
    });
    return () => {
      off();
      current?.removeEventListener("focus", onFocus);
      current?.removeEventListener("blur", onBlur);
    };
  }, [editor, face]);

  useEffect(
    () =>
      editor.registerUpdateListener(
        ({ tags, dirtyElements, dirtyLeaves, editorState }) => {
          // A selection-only update changed no text; a seed is the field's own.
          if (dirtyElements.size === 0 && dirtyLeaves.size === 0) return;
          let next: string;
          try {
            next = editorState.read(readRef.current);
          } catch (err) {
            // Shown in the field (the text stays in the editor, the value
            // the last written): never a change silently lost.
            if (!(err instanceof Error)) throw err;
            // Nothing read: the next reading, whatever it is, is reported
            // (and clears the error).
            face.read(null);
            unwritableRef.current(err);
            return;
          }
          const unchanged = next === face.reads;
          face.read(next);
          if (unchanged || tags.has(SEED_TAG)) return;
          reportRef.current(face, next);
        },
      ),
    [editor, face, readRef, reportRef, unwritableRef],
  );

  useEffect(
    () =>
      editor.registerCommand(
        KEY_DOWN_COMMAND,
        (e: KeyboardEvent) => {
          const toggle = toggleRef.current;
          if (!toggle) return false;
          if (!(e.metaKey || e.ctrlKey) || !e.shiftKey || e.altKey)
            return false;
          if (e.key.toLowerCase() !== "m") return false;
          e.preventDefault();
          toggle();
          return true;
        },
        COMMAND_PRIORITY_LOW,
      ),
    [editor, toggleRef],
  );
  return null;
}
