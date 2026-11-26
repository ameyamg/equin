import { useRef, useState, type ReactNode } from "react";
import { useToast } from "@plugins/shell/plugins/notifications/web";
import { transient } from "@plugins/primitives/plugins/kept-state/core";
import {
  Button,
  Input,
  Textarea,
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
import { symbol } from "@plugins/ui/plugins/icons/core";
import { Icon } from "@plugins/ui/plugins/icons/web";
import { parseAddressList, type DraftContent } from "../../core";
import type { DraftEditor } from "../internal/use-draft";

const sendIcon = symbol("send");
const attachIcon = symbol("attach-file");
const discardIcon = symbol("delete");
const removeIcon = symbol("close");

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

/** The body: a plain-text field (the message is sent as text). */
export function BodyField({
  editor,
  placeholder,
  className,
  autoFocus,
}: {
  editor: Ready;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
}): ReactNode {
  return (
    <Textarea
      bare
      aria-label="Message"
      placeholder={placeholder}
      autoFocus={autoFocus}
      className={cn(
        "block w-full resize-none bg-transparent px-lg py-smd text-foreground outline-none",
        className,
      )}
      keep={transient("saved to the server's draft as it is typed")}
      value={editor.content.body}
      onChange={(e) => editor.update({ body: e.currentTarget.value })}
    />
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
  onSent,
  onDiscarded,
}: {
  editor: Ready;
  onSent: () => void;
  onDiscarded: () => void;
}): ReactNode {
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
      <Fill />
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
