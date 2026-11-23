/**
 * The push's test gate, as the push driver runs it (`runTestGate`). A `cli/`
 * barrel with no default export: shared CLI machinery, not a command.
 */
export { runTestGate } from "./internal/gate";
export type { TestGateResult } from "./internal/gate";
