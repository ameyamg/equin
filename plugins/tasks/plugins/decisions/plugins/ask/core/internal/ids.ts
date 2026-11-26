// The scratch profile a decision's side chat runs under (its CLAUDE.md, its
// tools) — the thread's kind.
export const DECISION_ASK_PROFILE = "tasks.decisions.ask";

// The task category every decision's side chat is filed under: its own, so a
// side chat never lands in the asking agent's tree and the Agent Manager
// groups them apart.
export const DECISION_ASK_CATEGORY_ID = "decision-questions";

// The task-subject kind linking a side chat's task to its decision: one
// thread per decision, read back by subject (`useSubjectTask`).
export const DECISION_ASK_SUBJECT_KIND = "decision-ask";

// The file the profile's `prepare` writes the decision's context into, which
// the instructions import.
export const DECISION_ASK_CONTEXT_FILE = "context.md";
