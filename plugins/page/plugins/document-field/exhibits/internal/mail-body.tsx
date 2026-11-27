import { useState } from "react";
import { Stack } from "@plugins/primitives/plugins/css/plugins/spacing/web";
import { DOCUMENT_BLOCK_TYPES, type DocumentDialect } from "../../core";
import {
  DocumentField,
  type DocumentFieldMode,
} from "../../web/components/document-field";
import { DocumentFieldModeSwitch } from "../../web/components/mode-switch";

const MAIL: DocumentDialect = {
  blocks: DOCUMENT_BLOCK_TYPES,
  blankLines: "empty-block",
  emptyBlocks: "blank-line",
  softBreaks: "newline",
};

const BODY = [
  "Hi Maya,",
  "",
  "Agreed on moving the marketplace to **Q2**. Before Tuesday, could you:",
  "* name an owner for [plugin signing](https://docs.example.com/plugin-signing)",
  "* say *plainly* what slips, and <u>why</u>",
  '* move the `marketplace` milestone — <color value="red">it\'s late</color>',
  "",
  "<quote>",
  "  Can we ship before the freeze?",
  "</quote>",
].join("\n");

export default function MailBody() {
  const [mode, setMode] = useState<DocumentFieldMode>("rich");
  return (
    <Stack gap="sm" className="p-md">
      <Stack direction="row" gap="xs" justify="end">
        <DocumentFieldModeSwitch mode={mode} onModeChange={setMode} />
      </Stack>
      <DocumentField
        initial={BODY}
        onChange={() => {}}
        mode={mode}
        onModeChange={setMode}
        dialect={MAIL}
        ariaLabel="Message"
        placeholder="Write your message"
      />
    </Stack>
  );
}
