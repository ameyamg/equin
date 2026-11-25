import { useState, type ReactElement } from "react";
import { transient } from "@plugins/primitives/plugins/kept-state/core";
import { Row } from "@plugins/primitives/plugins/css/plugins/row/web";
import { Stack } from "@plugins/primitives/plugins/css/plugins/spacing/web";
import { Scroll } from "@plugins/primitives/plugins/css/plugins/scroll/web";
import { Text } from "@plugins/primitives/plugins/css/plugins/text/web";
import { Placeholder } from "@plugins/primitives/plugins/css/plugins/placeholder/web";
import { Loading } from "@plugins/primitives/plugins/loading/web";
import { InlinePopover } from "@plugins/primitives/plugins/overlay/plugins/popover/web";
import { SearchInput } from "@plugins/primitives/plugins/search/web";
import { localUndoProps } from "@plugins/primitives/plugins/undo-redo/web";
import { useOpenPane } from "@plugins/primitives/plugins/pane/web";
import {
  foldResource,
  matchResource,
} from "@plugins/network/plugins/live/plugins/live-state/web";
import { useLive } from "@plugins/network/plugins/live/web";
import {
  useBlockActivate,
  type BlockRendererProps,
} from "@plugins/page/plugins/editor/web";
import { useTask } from "@plugins/tasks/web";
import { taskRows, type TaskRow } from "@plugins/tasks/plugins/tasks-core/core";
import { taskIdKind } from "@plugins/tasks/plugins/task-ids/core";
import { TaskDecisionsPanel } from "@plugins/tasks/plugins/decisions/web";
import { decisionsPane } from "@plugins/tasks/plugins/decisions/plugins/inbox/web";
import { Icon } from "@plugins/ui/plugins/icons/web";
import { TASK_DECISIONS_BLOCK_ICON, taskDecisionsBlock } from "../../core";

/** How many tasks the picker lists at once — the latest edited first. */
const PICKER_LIMIT = 30;

/**
 * A `<task-decisions>` block: one task's decisions, drawn as the
 * conversation tray draws them ({@link TaskDecisionsPanel}, always shown —
 * a page that embeds a task's decisions says so even while none is open),
 * answered in place with the same drafts and Submit as the inbox. A block
 * still asking which task it shows offers a task picker; a block whose task
 * was deleted says so.
 */
export function TaskDecisionsBlock({
  block,
  editor,
}: BlockRendererProps): ReactElement {
  const { taskId } = taskDecisionsBlock.parse(block.data);
  const [pickerOpen, setPickerOpen] = useState(false);
  // Enter on an unset block's caret opens the picker; a set one leaves Enter
  // to the host (a new paragraph below).
  useBlockActivate(taskId === "" ? () => setPickerOpen(true) : null);
  if (taskId === "")
    return (
      <div className="px-md py-xs">
        <TaskPicker
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          onSelect={(id) => editor.update({ taskId: id })}
          trigger={
            <Row
              className="text-muted-foreground"
              icon={<Icon icon={TASK_DECISIONS_BLOCK_ICON} />}
            >
              Select a task whose decisions to show…
            </Row>
          }
        />
      </div>
    );
  return <TaskDecisions taskId={taskId} />;
}

function TaskDecisions({ taskId }: { taskId: string }): ReactElement {
  const task = useTask(taskId);
  const openPane = useOpenPane();
  return (
    <div className="px-md py-xs" data-testid="task-decisions-block">
      {matchResource(task, {
        loading: () => <Loading variant="rows" count={2} />,
        ready: (row) =>
          row === null ? (
            <Row
              icon={
                <Icon
                  icon={TASK_DECISIONS_BLOCK_ICON}
                  className="text-muted-foreground"
                />
              }
            >
              <Placeholder>(task deleted)</Placeholder>
              <Text variant="caption" tone="muted">
                {taskId}
              </Text>
            </Row>
          ) : (
            <TaskDecisionsPanel
              taskId={taskIdKind.parse(taskId)}
              inboxLink={openPane.to(decisionsPane, {}, { mode: "root" })}
              whenSettled="show"
            />
          ),
      })}
    </div>
  );
}

function TaskPicker({
  trigger,
  onSelect,
  open,
  onOpenChange,
}: {
  trigger: ReactElement;
  onSelect: (taskId: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): ReactElement {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const q = query.trim();
  // Server-side search, the latest edited first: a picker never holds every task.
  const tasks = useLive(taskRows, {
    ...(q === "" ? {} : { where: { title: { contains: q } } }),
    orderBy: [["updatedAt", "desc"]],
    limit: PICKER_LIMIT,
  });
  const options = foldResource<typeof tasks, readonly TaskRow[]>(tasks, {
    loading: () => [],
    error: () => [],
    ready: (rows) => rows,
  });
  const commit = (task: TaskRow | undefined) => {
    if (task === undefined) return;
    onSelect(task.id);
    onOpenChange(false);
    setQuery("");
  };
  return (
    <InlinePopover
      resetOnClose
      trigger={trigger}
      open={open}
      onOpenChange={onOpenChange}
      width="lg"
      padding="sm"
      rows
    >
      <Stack gap="sm">
        <SearchInput
          appearance="menu"
          {...localUndoProps}
          autoFocus
          placeholder="Search tasks…"
          keep={transient(
            "a picker popover's filter: a reload does not reopen the popover, and it resets on close",
          )}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActiveIndex((i) => Math.min(i + 1, options.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActiveIndex((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              commit(options[activeIndex]);
            }
          }}
        />
        <Scroll className="max-h-64">
          {matchResource(tasks, {
            loading: () => <Loading variant="rows" />,
            ready: () =>
              options.length === 0 ? (
                <Placeholder>No tasks found</Placeholder>
              ) : (
                <Stack gap="none">
                  {/* eslint-disable-next-line data-view/no-adhoc-row-list -- task typeahead menu (transient chrome) */}
                  {options.map((task, i) => (
                    <Row
                      key={task.id}
                      selected={i === activeIndex}
                      icon={<Icon icon={TASK_DECISIONS_BLOCK_ICON} />}
                      onMouseEnter={() => setActiveIndex(i)}
                      onMouseDown={(e: React.MouseEvent) => {
                        e.preventDefault();
                        commit(task);
                      }}
                    >
                      <Text>{task.title}</Text>
                    </Row>
                  ))}
                </Stack>
              ),
          })}
        </Scroll>
      </Stack>
    </InlinePopover>
  );
}
