import { useCallback, useRef } from "react";
import { z } from "zod";
import { cappedRecord } from "@plugins/packages/plugins/list-bound/core";
import {
  defineKept,
  useKept,
} from "@plugins/primitives/plugins/kept-state/web";
import {
  keptEntry,
  type KeptPart,
} from "@plugins/primitives/plugins/kept-state/core";
import { useEndpointMutation } from "@plugins/infra/plugins/endpoints/web";
import {
  ANSWERS_PER_SUBMIT_MAX,
  submitDecisionAnswersEndpoint,
  type DecisionAnswer,
  type DecisionRow,
  type SubmitAnswersResponse,
} from "../../core";

/**
 * One decision's drafted answer — made by the user, not sent yet:
 *
 * - `pick` — the option chosen (toggled off by picking it again);
 * - `note` — the note going with the pick, or a question without one;
 * - `close` — settle it without telling the agent ("Got it" on an FYI, or a
 *   decision whose agent has finished);
 * - `refused` — why the last Submit did not take it (until the next Submit
 *   of it; a draft emptied of its work is dropped with it).
 */
export const DecisionDraftSchema = z.object({
  pick: z.string().nullable(),
  note: z.string(),
  close: z.boolean(),
  refused: z.string().nullable(),
});
export type DecisionDraft = z.infer<typeof DecisionDraftSchema>;

export const EMPTY_DRAFT: DecisionDraft = {
  pick: null,
  note: "",
  close: false,
  refused: null,
};

/** A draft holding nothing to send (a refusal alone is no work). */
export function isDraftEmpty(d: DecisionDraft): boolean {
  return d.pick === null && d.note.trim() === "" && !d.close;
}

/**
 * Every drafted answer, in ONE work entry keyed by decision (subject
 * `answers`): the inbox, the conversation tray and the page block read and
 * write the same drafts, which survive navigation and reloads, browser-only.
 */
export const decisionDrafts = defineKept({
  owner: "decisions.answers",
  label: "Decision answers",
  tier: "work",
  cap: "32 KB",
  schema: cappedRecord(DecisionDraftSchema, { max: ANSWERS_PER_SUBMIT_MAX }),
  stamp: "ff9unnk2w2",
});

const SUBJECT = "answers";

/** What a decision's draft sends — `null` when it holds nothing. */
export function answerOf(id: string, d: DecisionDraft): DecisionAnswer | null {
  if (isDraftEmpty(d)) return null;
  const note = d.note.trim();
  return {
    decision: id,
    ...(d.pick === null ? {} : { pick: d.pick }),
    ...(note === "" ? {} : { note }),
    ...(d.close ? { close: true as const } : {}),
  };
}

/**
 * Whether a decision takes an answer now: open, and not Sent (an answer the
 * agent has not acted on yet). A draft on any other is left out of a Submit.
 */
export function isAnswerable(d: Pick<DecisionRow, "tab">): boolean {
  return d.tab === "needs" || d.tab === "fyi";
}

export interface DecisionDrafts {
  /** Every draft, by decision id. */
  drafts: Readonly<Record<string, DecisionDraft>>;
  /** One decision's draft as a kept part (its note is a `keep` value). */
  part(decisionId: string): KeptPart<DecisionDraft>;
  /**
   * Send the drafts of `decisions` in ONE Submit. A draft is cleared once the
   * server took it (delivered or kept on the record) and only while it still
   * holds what was sent; a refused one stays, carrying the reason.
   */
  submit(decisions: readonly string[]): Promise<SubmitAnswersResponse>;
  /**
   * Send `decisions` — one agent's section — only if every one of them holds
   * a drafted answer, read as set (so the pick made in the same handler
   * counts). `null`: one has none, nothing sent. A Submit in flight is waited
   * out first, then the drafts are read again (it may have taken some).
   */
  submitIfAllAnswered(
    decisions: readonly string[],
  ): Promise<SubmitAnswersResponse | null>;
  /** Why answers cannot be sent from this host (they type into agents); `null` when they can. */
  unavailable: string | null;
}

const sameDraft = (a: DecisionDraft | undefined, b: DecisionDraft): boolean =>
  a !== undefined &&
  a.pick === b.pick &&
  a.note === b.note &&
  a.close === b.close;

/** The user's drafted answers, and their one Submit. */
export function useDecisionDrafts(): DecisionDrafts {
  const binding = useKept(decisionDrafts, {}, { subject: SUBJECT });
  const [drafts, , , handle] = binding;
  const mutation = useEndpointMutation(submitDecisionAnswersEndpoint);
  const unavailable = mutation.kind === "unavailable" ? mutation.message : null;
  const part = useCallback(
    (decisionId: string): KeptPart<DecisionDraft> =>
      keptEntry(binding, decisionId, {
        empty: EMPTY_DRAFT,
        isEmpty: isDraftEmpty,
      }),
    [binding],
  );
  // One Submit at a time: a second press (⌘↵ twice, the key beside the
  // button) joins the one in flight instead of sending the same drafts again.
  const inFlight = useRef<Promise<SubmitAnswersResponse> | null>(null);
  const send = useCallback(
    async (decisions: readonly string[]) => {
      const current = handle.current();
      const sent: Record<string, DecisionDraft> = {};
      const answers: DecisionAnswer[] = [];
      for (const id of decisions) {
        const d = current[id];
        if (d === undefined) continue;
        const answer = answerOf(id, d);
        if (answer === null) continue;
        sent[id] = d;
        answers.push(answer);
      }
      if (mutation.kind === "unavailable") throw new Error(mutation.message);
      // In storage before the request: a reload while it runs keeps the drafts.
      handle.flush();
      const response = await mutation.mutateAsync({
        body: { submissionId: crypto.randomUUID(), answers },
      });
      const taken = new Set<string>([
        ...response.delivered.flatMap((d) => d.decisions),
        ...response.recorded,
      ]);
      const refused = new Map(
        response.refused.map((r) => [r.decision, r.message]),
      );
      // On storage, not React state: the bar that sent may be gone by now
      // (the conversation tray hides once nothing is left to answer).
      handle.settle((prev) => {
        const next = { ...prev };
        for (const [id, d] of Object.entries(sent)) {
          if (!sameDraft(next[id], d)) continue; // edited since: keep it
          if (taken.has(id)) delete next[id];
          const reason = refused.get(id);
          if (reason !== undefined) next[id] = { ...d, refused: reason };
        }
        return next;
      });
      return response;
    },
    [handle, mutation],
  );
  const submit = useCallback(
    (decisions: readonly string[]): Promise<SubmitAnswersResponse> => {
      if (inFlight.current !== null) return inFlight.current;
      const run = send(decisions).finally(() => {
        inFlight.current = null;
      });
      inFlight.current = run;
      return run;
    },
    [send],
  );
  const submitIfAllAnswered = useCallback(
    async (
      decisions: readonly string[],
    ): Promise<SubmitAnswersResponse | null> => {
      // Not the one in flight's answer: it sent other drafts, maybe not these.
      // Only its settling matters here — its failure is its own caller's.
      while (inFlight.current !== null)
        await Promise.allSettled([inFlight.current]);
      const current = handle.current();
      const all =
        decisions.length > 0 &&
        decisions.every((id) => {
          const d = current[id];
          return d !== undefined && answerOf(id, d) !== null;
        });
      return all ? submit(decisions) : null;
    },
    [handle, submit],
  );
  return { drafts, part, submit, submitIfAllAnswered, unavailable };
}
