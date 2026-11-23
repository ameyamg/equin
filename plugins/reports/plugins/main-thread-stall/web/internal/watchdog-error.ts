import {
  SubjectError,
  normalizeMessage,
} from "@plugins/packages/plugins/error-subject/core";
import type { WatchdogFailure } from "./protocol";

/**
 * A failure the watchdog relayed. Thrown from ONE place in the tab whatever
 * failed in the worker (`onWorkerMessage`, inside `runMarked`), so its stack
 * says nothing of the cause: it names the cause as its subject — what the
 * watchdog was doing, the error's type, its message as a class — and each
 * cause is its own report.
 */
export class WatchdogError extends SubjectError {
  constructor({ op, errorType, message }: WatchdogFailure) {
    super(`main-thread-stall watchdog: ${op} failed: ${message}`, {
      subject: [
        "main-thread-stall watchdog",
        op,
        errorType,
        normalizeMessage(message, 120),
      ].join(" › "),
    });
    this.name = "WatchdogError";
  }
}
