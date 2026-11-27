import { defineServerContribution } from "@plugins/framework/plugins/server-core/core";
import type { FieldsRecord } from "@plugins/fields/core";
import { PROPOSAL_TYPE_ID_PATTERN } from "../../core";

/** One record as its owner reads it. */
export interface ProposalRecord {
  /** What picks the record's fields within its type (a site feed item's feed). */
  readonly scope: string;
  readonly values: Readonly<Record<string, unknown>>;
  /** Opaque: moves whenever the values do (the owner's `updated_at`, spelled). */
  readonly version: string;
  /** When the values last moved: whether main's record changed since a fork. */
  readonly updatedAt: Date;
}

/** What an accept asks the owner to write. */
export type ProposalTarget =
  | { readonly kind: "edit"; readonly id: string }
  /** A record main does not hold yet, under the id it had in the worktree. */
  | { readonly kind: "create"; readonly id: string; readonly scope: string };

export type ProposalApplied =
  | { readonly kind: "applied" }
  /** The owner's write path refused the values — why, in words. */
  | { readonly kind: "refused"; readonly message: string };

/**
 * A record type agents may propose changes to: registered by the plugin that
 * owns those records, in the runtime that holds their write path. The
 * proposals plugin names no type, field or owner — it reads, diffs and applies
 * records only through this.
 */
export interface ProposalType {
  /** `PROPOSAL_TYPE_ID_PATTERN`. */
  readonly id: string;
  /** "Site feed item" — what the CLI and the review say. */
  readonly label: string;
  /** The fields of a scope's records, or null when the scope is unknown here. */
  readonly fieldsOf: (scope: string) => FieldsRecord | null;
  /** One record of THIS database, or null when it holds none. */
  readonly read: (id: string) => Promise<ProposalRecord | null>;
  /** The records THIS database wrote (created or edited) at or after `since`. */
  readonly touchedSince: (since: Date) => Promise<readonly string[]>;
  /**
   * Write `set` (an edit: only the keys to change; a create: the whole
   * record) through the owner's own path, its validation and side effects
   * included (a published item published again).
   */
  readonly apply: (
    target: ProposalTarget,
    set: Readonly<Record<string, unknown>>,
  ) => Promise<ProposalApplied>;
}

/** The record types agents may propose changes to — `Proposals.Type(type)`. */
export const Proposals = {
  Type: defineServerContribution<ProposalType>("proposals.type", {
    docLabel: (t) => t.id,
  }),
};

/** Every registered type, each id once (a second registration throws). */
export function proposalTypes(): readonly ProposalType[] {
  const types = Proposals.Type.getContributions();
  const seen = new Set<string>();
  for (const t of types) {
    if (!PROPOSAL_TYPE_ID_PATTERN.test(t.id)) {
      throw new Error(
        `proposals: type id ${JSON.stringify(t.id)} does not match ${PROPOSAL_TYPE_ID_PATTERN}`,
      );
    }
    if (seen.has(t.id)) {
      throw new Error(
        `proposals: type "${t.id}" is registered twice — a type is registered once, by its owner`,
      );
    }
    seen.add(t.id);
  }
  return types;
}

/** The registered type `id`, or null. */
export function proposalTypeOf(id: string): ProposalType | null {
  return proposalTypes().find((t) => t.id === id) ?? null;
}
