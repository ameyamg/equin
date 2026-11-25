import type { ReactElement, RefObject } from "react";
import { useLive } from "@plugins/network/plugins/live/web";
import type { LiveWhereOf } from "@plugins/network/plugins/live/core";
import { foldResource } from "@plugins/network/plugins/live/plugins/live-state/web";
import { Sticky } from "@plugins/primitives/plugins/css/plugins/sticky/web";
import { Stack } from "@plugins/primitives/plugins/css/plugins/spacing/web";
import { Fill } from "@plugins/primitives/plugins/css/plugins/fill/web";
import { Text } from "@plugins/primitives/plugins/css/plugins/text/web";
import { Button } from "@plugins/primitives/plugins/css/plugins/ui-kit/web";
import { Kbd } from "@plugins/primitives/plugins/overlay/plugins/tooltip/web";
import {
  formatShortcutLabel,
  useSurfaceShortcuts,
} from "@plugins/primitives/plugins/shortcuts/web";
import type { TaskId } from "@plugins/tasks/plugins/task-ids/core";
import { useToast } from "@plugins/shell/plugins/notifications/web";
import { decisionAgent, decisionsList, type DecisionRow } from "../../core";
import {
  answerOf,
  isAnswerable,
  useDecisionDrafts,
  type DecisionDraft,
} from "../internal/drafts";

/** What the bar knows of the drafts it would send. */
interface Tally {
  /** The decisions Submit sends now: answerable, drafted. */
  ids: string[];
  /** How many of them are only kept (their agent finished, or "Got it"). */
  kept: number | null;
  /** How many the last Submit did not take. */
  refused: number;
}

/** "Got it" / close without a pick: nothing goes to the agent. */
const closesOnly = (d: DecisionDraft): boolean => d.close && d.pick === null;

/**
 * The one Submit for every drafted answer — sticky at the foot of a list of
 * decisions, ⌘↵ in its `region`. "N of M answered" (M: what needs the
 * user here — Needs you and FYI), and how many go to agents and how many are
 * only kept (their agent has finished); nothing while nothing is answered.
 * `taskId` scopes it to one agent's decisions (the conversation tray).
 *
 * ⌘↵ belongs to the bar's `region` — the panel whose drafts it sends — and
 * only by focus (shortcuts' `ShortcutRegion`): with two bars on one surface
 * (the inbox's and a task's, two page blocks) the one whose panel holds
 * focus sends, and with focus in neither nothing is sent; a bar alone on its
 * surface takes ⌘↵ wherever focus is.
 */
export function SubmitBar({
  taskId,
  region,
}: {
  taskId?: TaskId;
  /** The panel this bar submits for: the list or panel it sits at the foot of. */
  region: RefObject<Element | null>;
}): ReactElement {
  const { drafts, submit, unavailable } = useDecisionDrafts();
  const draftIds = Object.keys(drafts).filter((id) => {
    const d = drafts[id];
    return d !== undefined && answerOf(id, d) !== null;
  });
  const rows = useLive(decisionsList, { ids: draftIds });
  const where: LiveWhereOf<typeof decisionsList> | undefined =
    taskId === undefined ? undefined : { taskId };
  const groups = useLive(decisionsList, { groupBy: "tab", where });
  const answerable = foldResource(rows, {
    loading: () => null,
    error: () => null,
    ready: (data): DecisionRow[] =>
      data.filter(
        (r) => isAnswerable(r) && (taskId === undefined || r.taskId === taskId),
      ),
  });
  // Which of the drafts' agents have finished: one tuple per task.
  const tasks = [...new Set((answerable ?? []).map((r) => r.taskId))].sort();
  const finished = useLive(
    decisionAgent,
    tasks.map((t) => ({ taskId: t })),
  );
  // Not known (loading, failed, or no computer to ask): `null`.
  const reads = "status" in finished ? null : finished;
  const finishedOf = new Map<string, boolean | null>(
    tasks.map((t, i) => {
      const read = reads?.[i];
      return [
        t,
        read === undefined
          ? null
          : foldResource(read, {
              loading: (): boolean | null => null,
              error: () => null,
              ready: (agent) => agent?.finished === true,
            }),
      ];
    }),
  );
  const tally: Tally | null =
    answerable === null
      ? null
      : {
          ids: answerable.map((r) => r.id),
          kept: answerable.some((r) => finishedOf.get(r.taskId) === null)
            ? null
            : answerable.filter(
                (r) =>
                  finishedOf.get(r.taskId) === true ||
                  closesOnly(drafts[r.id]!),
              ).length,
          refused: answerable.filter((r) => drafts[r.id]?.refused != null)
            .length,
        };
  const outOf = foldResource(groups, {
    loading: () => null,
    error: () => null,
    ready: (data) =>
      data
        .filter((g) => g.value === "needs" || g.value === "fyi")
        .reduce((n, g) => n + g.count, 0),
  });

  const count = unavailable === null ? (tally?.ids.length ?? 0) : 0;
  const toast = useToast();
  // Answers recorded but not typed into their agent say so: the turn is
  // retried from the conversation.
  const send = async () => {
    const response = await submit(tally?.ids ?? []);
    for (const d of response.delivered)
      if (d.typingFailed !== null)
        toast({
          type: "task",
          category: "other",
          title: "Answers recorded, not typed into the agent",
          description: `${d.typingFailed} — retry the turn from the agent's conversation.`,
          variant: "error",
        });
  };
  useSurfaceShortcuts([
    {
      id: "decisions.submit",
      keys: "mod+enter",
      label: "Submit your answers",
      group: "Decisions",
      enableInInputs: true,
      region: { root: region, pointer: false },
      when: () => count > 0,
      // The button shows its own failure; the key's goes to a toast.
      handler: () =>
        void send().catch((err: unknown) =>
          toast({
            type: "task",
            category: "other",
            title: "Could not submit your answers",
            description: err instanceof Error ? err.message : String(err),
            variant: "error",
          }),
        ),
    },
  ]);

  const failed = rows.status === "error" ? rows.error : null;
  const hint =
    unavailable !== null
      ? unavailable
      : failed !== null
        ? `Could not read your drafted answers: ${failed.message}`
        : tally === null || count === 0
          ? null
          : [
              outOf === null || outOf < count
                ? `${count} answered`
                : `${count} of ${outOf} answered`,
              tally.kept !== null && tally.kept > 0
                ? `${count - tally.kept} to send, ${tally.kept} to keep`
                : null,
              tally.refused > 0 ? `${tally.refused} not taken last time` : null,
            ]
              .filter((s) => s !== null)
              .join(" · ");
  return (
    <Sticky edge="bottom" mask className="border-t border-border">
      <Stack
        direction="row"
        gap="sm"
        align="center"
        className="rail-follow py-sm"
      >
        <Fill>
          {hint === null ? null : (
            <Text
              variant="caption"
              tone={failed === null ? "muted" : "destructive"}
            >
              {hint}
            </Text>
          )}
        </Fill>
        <Button
          variant={count > 0 ? "default" : "secondary"}
          disabled={count === 0}
          onClick={send}
          data-testid="decisions-submit"
        >
          {count > 0 ? `Submit ${count}` : "Submit"}
          <Kbd>{formatShortcutLabel("mod+enter")}</Kbd>
        </Button>
      </Stack>
    </Sticky>
  );
}
