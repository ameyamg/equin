import { useMemo, useRef, useState, type ReactNode } from "react";
import { useToast } from "@plugins/shell/plugins/notifications/web";
import { transient } from "@plugins/primitives/plugins/kept-state/core";
import {
  Button,
  Input,
  cn,
} from "@plugins/primitives/plugins/css/plugins/ui-kit/web";
import { IconButton } from "@plugins/primitives/plugins/icon-button/web";
import { Line } from "@plugins/primitives/plugins/css/plugins/line/web";
import {
  Fill,
  fillClasses,
} from "@plugins/primitives/plugins/css/plugins/fill/web";
import { Inset } from "@plugins/primitives/plugins/css/plugins/spacing/web";
import { rigidClass } from "@plugins/primitives/plugins/css/plugins/rigid/web";
import { Stack } from "@plugins/primitives/plugins/css/plugins/spacing/web";
import { Text } from "@plugins/primitives/plugins/css/plugins/text/web";
import { Scroll } from "@plugins/primitives/plugins/css/plugins/scroll/web";
import { symbol } from "@plugins/ui/plugins/icons/core";
import { Icon } from "@plugins/ui/plugins/icons/web";
import { matchResource } from "@plugins/network/plugins/live/plugins/live-state/web";
import { Loading } from "@plugins/primitives/plugins/loading/web";
import {
  DocumentField,
  DocumentFieldModeSwitch,
  type DocumentFieldMode,
} from "@plugins/page/plugins/document-field/web";
import {
  bodySigned,
  MAIL_BODY_DIALECT,
  parseAddressList,
  quoteBody,
  type DraftContent,
} from "../../core";
import type { DraftEditor, SignatureRead } from "../internal/use-draft";
import type { ClassName } from "@plugins/primitives/plugins/css/plugins/ui-kit/core";

/** The editor view and its setter (`useEditorView`). */
export type EditorView = readonly [
  DocumentFieldMode,
  (mode: DocumentFieldMode) => void,
];

const sendIcon = symbol("send");
const attachIcon = symbol("attach-file");
const discardIcon = symbol("delete");
const removeIcon = symbol("close");
const signatureIcon = symbol("signature");
const moreIcon = symbol("more-horiz");

type Ready = DraftEditor;

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** One header row of the compose window (To, Cc, Subject): its label, then the field filling the rest. */
function FieldRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}): ReactNode {
  return (
    <Inset x="lg">
      <Line as="label" className="h-9 gap-smd border-t border-border">
        {/* As wide as its word (`.cf`): a fixed column cut "Subject". */}
        <Text variant="label" tone="faint" className={rigidClass()}>
          {label}
        </Text>
        {children}
      </Line>
    </Inset>
  );
}

/** A recipient field: as typed, flagged while a piece of it is not an address. */
function RecipientInput({
  value,
  onChange,
  autoFocus,
  name,
}: {
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
  name: string;
}): ReactNode {
  const parsed = parseAddressList(value);
  return (
    <Input
      bare
      name={name}
      aria-label={name}
      autoFocus={autoFocus}
      aria-invalid={parsed.kind === "invalid" ? true : undefined}
      className={cn(
        fillClasses("x"),
        "bg-transparent text-foreground outline-none",
        parsed.kind === "invalid" && "text-destructive",
      )}
      keep={transient("saved to the server's draft as it is typed")}
      value={value}
      onChange={(e) => onChange(e.currentTarget.value)}
    />
  );
}

/**
 * The compose window's header fields: To (with Cc / Bcc shown on demand or
 * when the draft has them) and Subject.
 */
export function HeaderFields({ editor }: { editor: Ready }): ReactNode {
  const { content, update } = editor;
  const [copies, setCopies] = useState(
    content.cc.trim() !== "" || content.bcc.trim() !== "",
  );
  return (
    <Stack gap="none">
      <FieldRow label="To">
        <RecipientInput
          name="To"
          value={content.to}
          onChange={(to) => update({ to })}
          autoFocus={content.to === ""}
        />
        {copies ? null : (
          <Button variant="ghost" onClick={() => setCopies(true)}>
            Cc Bcc
          </Button>
        )}
      </FieldRow>
      {copies ? (
        <>
          <FieldRow label="Cc">
            <RecipientInput
              name="Cc"
              value={content.cc}
              onChange={(cc) => update({ cc })}
            />
          </FieldRow>
          <FieldRow label="Bcc">
            <RecipientInput
              name="Bcc"
              value={content.bcc}
              onChange={(bcc) => update({ bcc })}
            />
          </FieldRow>
        </>
      ) : null}
      <FieldRow label="Subject">
        <Input
          bare
          name="Subject"
          aria-label="Subject"
          className={cn(
            fillClasses("x"),
            "bg-transparent text-foreground outline-none",
          )}
          keep={transient("saved to the server's draft as it is typed")}
          value={content.subject}
          onChange={(e) => update({ subject: e.currentTarget.value })}
        />
      </FieldRow>
    </Stack>
  );
}

/**
 * The body: one document field over the draft's text in Mail's dialect —
 * paragraphs, headings, lists, a quote, code, dividers, and the page editor's
 * marks — shown as Markdown or Rich (`view`). Sent as HTML with a text/plain
 * alternative.
 */
export function BodyField({
  editor,
  view,
  placeholder,
  className,
  autoFocus,
}: {
  editor: Ready;
  view: EditorView;
  placeholder?: string;
  className?: ClassName;
  autoFocus?: boolean;
}): ReactNode {
  const [mode, setMode] = view;
  return (
    <Inset x="lg" y="smd">
      <DocumentField
        initial={editor.content.body}
        onChange={(body) => editor.update({ body })}
        mode={mode}
        onModeChange={setMode}
        dialect={MAIL_BODY_DIALECT}
        ariaLabel="Message"
        placeholder={placeholder}
        autoFocus={autoFocus}
        className={cn("text-foreground", className)}
      />
    </Inset>
  );
}

/**
 * The quote of what a reply answers, under the body and signature: folded
 * behind "…" (Show quoted text) as the prototype does, shown when opened in the
 * editor's view — its header line, then the original as one quote. Read-only:
 * the send appends it as it was answered.
 */
export function QuoteBlock({
  editor,
  view,
}: {
  editor: Ready;
  view: EditorView;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const quote = editor.draft.quote;
  const body = useMemo(
    () => (quote === null ? null : quoteBody(quote)),
    [quote],
  );
  if (body === null) return null;
  if (!open) {
    return (
      <Inset x="lg" b="xsm">
        <IconButton
          icon={moreIcon}
          label="Show quoted text"
          onClick={() => setOpen(true)}
        />
      </Inset>
    );
  }
  return (
    <Inset x="lg" b="xsm">
      <DocumentField
        initial={body}
        onChange={() => {}}
        readOnly
        mode={view[0]}
        dialect={MAIL_BODY_DIALECT}
        ariaLabel="Quoted text"
        className={cn("text-muted-foreground")}
      />
    </Inset>
  );
}

/**
 * The account's signature under the body, as the message will carry it (under
 * the delimiter, drawn `--`; the message's is `-- `) — a block of its own, never body text,
 * so an untouched compose stays empty. Its remove drops it from this message
 * only (saved with the draft; the footer's Add signature puts it back). None
 * when the body is signed already (`bodySigned`: a draft adopted from the
 * provider's editor) or the account has no signature.
 */
export function SignatureBlock({
  editor,
  signature,
}: {
  editor: Ready;
  signature: SignatureRead;
}): ReactNode {
  if (!editor.content.signature || bodySigned(editor.content.body)) return null;
  return matchResource(signature, {
    loading: () => (
      <Inset x="lg" b="xsm">
        <Loading label="Reading your signature…" />
      </Inset>
    ),
    // Not read: the send reads it again and signs, so the remove stays offered.
    error: (err) => (
      <Inset l="lg" r="xsm" b="xsm">
        <Line className="gap-xsm">
          <Fill>
            <Text variant="caption" tone="destructive">
              Your signature could not be read: {err.message}
            </Text>
          </Fill>
          <IconButton
            icon={removeIcon}
            label="Remove signature from this message"
            onClick={() => editor.update({ signature: false })}
          />
        </Line>
      </Inset>
    ),
    ready: ({ text }) =>
      text === null ? null : (
        <Inset l="lg" r="xsm" b="xsm">
          <Stack direction="row" gap="xsm">
            <Fill>
              <Text
                as="div"
                variant="body"
                tone="muted"
                aria-label="Signature"
                className="whitespace-pre-wrap"
              >
                {`--\n${text}`}
              </Text>
            </Fill>
            <IconButton
              icon={removeIcon}
              label="Remove signature from this message"
              onClick={() => editor.update({ signature: false })}
            />
          </Stack>
        </Inset>
      ),
  });
}

/**
 * What an editor writes, in one scroll area (the prototype's): the body, the
 * signature under it, then the quote of what a reply answers.
 */
export function EditorBody({
  editor,
  signature,
  view,
  placeholder,
  autoFocus,
  className,
  bodyClassName,
}: {
  editor: Ready;
  signature: SignatureRead;
  view: EditorView;
  placeholder?: string;
  autoFocus?: boolean;
  /** The scroll area's box (its height, its border). */
  className?: ClassName;
  /** The body field's own box (its least height). */
  bodyClassName?: ClassName;
}): ReactNode {
  return (
    <Scroll className={className}>
      <BodyField
        editor={editor}
        view={view}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className={bodyClassName}
      />
      <SignatureBlock editor={editor} signature={signature} />
      <QuoteBlock editor={editor} view={view} />
    </Scroll>
  );
}

/** The draft's files, each with its size and a remove. */
export function AttachmentList({ editor }: { editor: Ready }): ReactNode {
  const files = editor.content.attachments;
  if (files.length === 0) return null;
  return (
    <Line wrap className="gap-xsm px-lg pb-xsm">
      {files.map((a: DraftContent["attachments"][number], i) => (
        <Line
          key={`${i}:${a.filename}`}
          className="gap-2xs rounded-control border border-border py-2xs pr-2xs pl-smd"
        >
          <Icon icon={attachIcon} className="size-3.5 text-muted-foreground" />
          <Text variant="caption" className="max-w-48 truncate">
            {a.filename}
          </Text>
          <Text variant="caption" tone="faint">
            {formatSize(a.size)}
          </Text>
          <IconButton
            icon={removeIcon}
            label={`Remove ${a.filename}`}
            onClick={() => editor.removeAttachment(i)}
          />
        </Line>
      ))}
    </Line>
  );
}

/** Why the last send did not go, above the footer, while the draft says so. */
export function SendError({ editor }: { editor: Ready }): ReactNode {
  if (editor.draft.sendError === null) return null;
  return (
    <Text variant="caption" tone="destructive" className="px-lg pb-xsm">
      {editor.draft.sendError}
    </Text>
  );
}

/**
 * The footer every editor shares: Send, Attach (a file picker; files go up at
 * once and are kept with the draft), and Discard at the far end.
 */
export function EditorFooter({
  editor,
  signature,
  view,
  onSent,
  onDiscarded,
}: {
  editor: Ready;
  /** The editor view: its Markdown | Rich switch sits before Discard. */
  view: EditorView;
  /** The account's signature: Add signature shows while it was removed from this message. */
  signature: SignatureRead;
  onSent: () => void;
  onDiscarded: () => void;
}): ReactNode {
  const canSign =
    !editor.content.signature &&
    !bodySigned(editor.content.body) &&
    signature.status === "ready" &&
    signature.data.text !== null;
  const toast = useToast();
  const picker = useRef<HTMLInputElement>(null);
  const fail = (what: string) => (err: unknown) => {
    toast({
      type: "mail-compose-failed",
      title: what,
      description: err instanceof Error ? err.message : String(err),
      category: "other",
      variant: "error",
    });
  };
  return (
    <Line className="gap-2xs px-smd pt-xsm pb-smd">
      <Button
        onClick={async () => {
          try {
            await editor.send();
            onSent();
          } catch (err) {
            fail("Not sent")(err);
          }
        }}
      >
        <Icon icon={sendIcon} />
        Send
      </Button>
      <input
        ref={picker}
        type="file"
        multiple
        hidden
        aria-hidden
        onChange={(e) => {
          const files = [...(e.currentTarget.files ?? [])];
          e.currentTarget.value = "";
          if (files.length > 0) {
            editor.addFiles(files).catch(fail("Could not attach the file"));
          }
        }}
      />
      <IconButton
        icon={attachIcon}
        label="Attach files"
        onClick={() => picker.current?.click()}
      />
      {canSign ? (
        <IconButton
          icon={signatureIcon}
          label="Add signature"
          onClick={() => editor.update({ signature: true })}
        />
      ) : null}
      <Fill />
      <DocumentFieldModeSwitch mode={view[0]} onModeChange={view[1]} />
      <IconButton
        icon={discardIcon}
        label="Discard draft"
        onClick={async () => {
          try {
            await editor.discard();
            onDiscarded();
            toast({
              type: "mail-draft-discarded",
              title: "Draft discarded",
              description: "",
              category: "confirmations",
            });
          } catch (err) {
            fail("Could not discard the draft")(err);
          }
        }}
      />
    </Line>
  );
}
