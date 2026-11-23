export { installStorage, QuotaStorage } from "./quota-storage";
export { storageScopeOf } from "./scope";
export { writeEntryUnchecked } from "./unchecked-entry";
// Empty storage and every owner's accounting, and tell every in-memory copy
// (onStorageCleared) — the shared jsdom setup runs it before each test.
export { resetBrowserStorage } from "../internal/store";
