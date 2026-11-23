import { HostRefusedError } from "@plugins/framework/plugins/browser-server/core";

/**
 * The storage belongs to newer code than this worker's: its stored data was
 * migrated (or seeded) by a newer build, or a newer build's worker holds it.
 * Booting would run old code over the new schema, so the host refuses
 * (`{ kind: "outdated" }`), and the tab asks for a reload — which loads the
 * newer build.
 */
export class StorageNewerThanCodeError extends HostRefusedError {
  constructor(detail: string) {
    super({ kind: "outdated" }, detail);
    this.name = "StorageNewerThanCodeError";
  }
}

/**
 * The boot was cut short by the browser suspending the page
 * (`isSuspensionAbort`), not by a fault: the host declines
 * (`{ kind: "interrupted" }`) and the page starts it again on a fresh worker.
 * The storage is left as its last committed transaction left it — a
 * database never created, a lifecycle record still `seeding` (which the next
 * open wipes and seeds again), or a booted one short of the write that was
 * cut, as after a tab closed mid-write.
 */
export class BootInterruptedError extends HostRefusedError {
  constructor(cause: unknown) {
    super(
      { kind: "interrupted" },
      "the browser cut the storage's IndexedDB work short while the page was suspended (back/forward cache, a background tab)",
    );
    this.name = "BootInterruptedError";
    this.cause = cause;
  }
}
