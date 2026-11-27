import { index, uniqueIndex, type AnyPgColumn } from "drizzle-orm/pg-core";
import {
  defaultNow,
  defineEntity,
} from "@plugins/infra/plugins/entities/server";
import { _tasks } from "@plugins/tasks/plugins/tasks-core/server";
import { proposalsEntityRef } from "../../core";

// The proposals agents handed to this instance (main's): one per revision of
// one record from one task. Built from the web-safe field record
// (`core/internal/fields.ts`).
const proposalsEntity = defineEntity(proposalsEntityRef, {
  primaryKey: "id",
  columns: {
    // Growth bound: this cascade (a task's proposals go with it), and one open
    // revision per (task, type, record) — a new one supersedes it.
    authorTaskId: {
      references: { column: () => _tasks.id, onDelete: "cascade" },
    },
    previousId: {
      references: {
        column: (): AnyPgColumn => _proposals.id,
        onDelete: "set null",
      },
    },
    values: { default: {} },
    changed: { default: [] },
    note: { default: "" },
    isNew: { default: false },
    editedOnMainSinceFork: { default: false },
    revision: { default: 1 },
    state: { default: "open" },
    createdAt: { default: defaultNow() },
    updatedAt: { default: defaultNow() },
  },
  updatedAt: {
    touchedBy: {
      id: false,
      type: false,
      scope: false,
      recordId: false,
      isNew: false,
      baseVersion: false,
      baseValues: false,
      values: false,
      changed: false,
      note: false,
      authorTaskId: false,
      authorConversationId: false,
      worktree: false,
      editedOnMainSinceFork: false,
      revision: false,
      previousId: false,
      state: true,
      decisionNote: true,
      decidedAt: true,
      createdAt: false,
    },
  },
  indexes: (t) => [
    // The owner view's read: one type's scope, newest first.
    index("proposals_type_scope_created_idx").on(
      t.type,
      t.scope,
      t.createdAt.desc(),
    ),
    // A revision's predecessor: the task's latest proposal of one record —
    // and one row per revision (receive serializes them per record).
    uniqueIndex("proposals_task_record_revision_idx").on(
      t.authorTaskId,
      t.type,
      t.recordId,
      t.revision,
    ),
  ],
});

export const _proposals = proposalsEntity.table;
export { proposalsEntity };
