import { defineRetention } from "@plugins/infra/plugins/retention/server";
import { _recorderSaves } from "./tables";

export const recorderSavesRetention = defineRetention({
  table: _recorderSaves,
  ttlDays: 7,
  perWorktree: true,
});
