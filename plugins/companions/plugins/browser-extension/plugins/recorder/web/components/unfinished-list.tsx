import { createContext, useContext, type ReactElement } from "react";
import {
  DataView,
  defineDataView,
  defineItemActions,
  type FieldDef,
  type ItemActionProps,
} from "@plugins/primitives/plugins/data-view/web";
import { useLive } from "@plugins/network/plugins/live/web";
import { useEndpointMutation } from "@plugins/infra/plugins/endpoints/web";
import { IconButton } from "@plugins/primitives/plugins/icon-button/web";
import { Stack } from "@plugins/primitives/plugins/css/plugins/spacing/web";
import { Text } from "@plugins/primitives/plugins/css/plugins/text/web";
import { symbol } from "@plugins/ui/plugins/icons/core";
import {
  discardTabRecording,
  finishTabRecording,
  unfinishedTabRecordings,
  type UnfinishedRecording,
} from "../../core";
import { sizeText } from "../internal/use-recorder";

const UNFINISHED_VIEW = defineDataView("recorder.unfinished");

const icons = { save: symbol("save"), discard: symbol("delete-forever") };

const fields: FieldDef<UnfinishedRecording>[] = [
  {
    id: "name",
    label: "Name",
    type: "text",
    primary: true,
    value: (r) => r.name,
    sortable: false,
    filterable: false,
  },
  {
    id: "bytes",
    label: "Size",
    type: "text",
    value: (r) => sizeText(r.bytes),
    sortable: false,
    filterable: false,
  },
];

/** Row actions of the unfinished recordings. */
export const UnfinishedItemActions = defineItemActions<UnfinishedRecording>();

/** How a row action says what came of it: the section's note under its row. */
const RunContext = createContext<
  ((work: () => Promise<void>, done?: string) => void) | null
>(null);

function useRun() {
  const run = useContext(RunContext);
  if (run === null)
    throw new Error("an unfinished recording's action outside its list");
  return run;
}

/** Save — remuxed and named like any recording, the pointer track lost. */
export function SaveUnfinishedAction({
  row,
}: ItemActionProps<UnfinishedRecording>): ReactElement | null {
  const run = useRun();
  const finish = useEndpointMutation(finishTabRecording);
  if (finish.kind === "unavailable" || row.bytes === 0) return null;
  return (
    <IconButton
      icon={icons.save}
      label="Save as a video"
      onClick={(e) => {
        e.stopPropagation();
        run(async () => {
          await finish.mutateAsync({
            params: { id: row.id },
            body: { durationMs: 0, pointer: null },
          });
        }, `Saved ${row.name}`);
      }}
    />
  );
}

/** Delete — the partial removed for good (it is no video yet: no Trash). */
export function DiscardUnfinishedAction({
  row,
}: ItemActionProps<UnfinishedRecording>): ReactElement | null {
  const run = useRun();
  const discard = useEndpointMutation(discardTabRecording);
  if (discard.kind === "unavailable") return null;
  return (
    <IconButton
      icon={icons.discard}
      label="Delete (cannot be undone)"
      variant="destructive"
      onClick={(e) => {
        e.stopPropagation();
        run(async () => {
          await discard.mutateAsync({ params: { id: row.id } });
        }, `Deleted ${row.name}`);
      }}
    />
  );
}

/**
 * The Recordings folder's recordings whose finish never came (the browser
 * closed mid-recording, a finish failed): each can still be saved as a video
 * or deleted. Shown only while nothing records — the one being recorded is
 * in the folder's list too. Absent while there is none.
 */
export function UnfinishedList({
  run,
}: {
  run: (work: () => Promise<void>, done?: string) => void;
}) {
  const read = useLive(unfinishedTabRecordings);
  switch (read.status) {
    // Nothing known yet, or no computer to hold recordings: nothing to offer.
    case "loading":
    case "unavailable":
      return null;
    // A failed read is loud: the section's error boundary says it.
    case "error":
      throw read.error;
    case "ready":
      break;
  }
  if (read.data.recordings.length === 0) return null;
  return (
    <Stack gap="xs">
      <Text variant="caption" tone="muted">
        Unfinished recordings
      </Text>
      <RunContext.Provider value={run}>
        <DataView<UnfinishedRecording>
          storageKey={UNFINISHED_VIEW}
          rows={read.data.recordings}
          readiness={read}
          rowKey={(r) => r.id}
          searchAccessor={(r) => r.name}
          fields={fields}
          views={["list"]}
          itemActions={UnfinishedItemActions}
        />
      </RunContext.Provider>
    </Stack>
  );
}
