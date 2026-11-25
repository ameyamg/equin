// A fresh in-process queue for a suite that runs real jobs end to end without
// graphile: provide it with `withHostServices([JobQueue.provide(queue)], …)`,
// `start()` it, and run it dry with `settleJobQueue()`. Its rows go to the
// host's database (the suite's own, through `DatabaseDriver`).
export { createInProcessQueue } from "../internal/in-process-queue";

// A row store kept in memory, for a suite that inspects how its job's rows
// queue (fold, due time) without a database: `createInProcessQueue({ store })`.
export { memoryRowStore } from "../internal/row-store";
