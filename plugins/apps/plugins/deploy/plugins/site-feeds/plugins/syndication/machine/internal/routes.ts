import {
  implementMachine,
  machineHandler,
} from "@plugins/infra/plugins/endpoints/machine";
import { retrySyndication, saveSyndicationSettings } from "../../shared";
import { retryOne } from "./jobs";
import { saveTargetSettings } from "./settings";

export const handleSaveSettings = machineHandler(
  saveSyndicationSettings,
  implementMachine(saveSyndicationSettings, async ({ body }) =>
    saveTargetSettings(body),
  ),
);

export const handleRetry = machineHandler(
  retrySyndication,
  implementMachine(retrySyndication, async ({ body }) =>
    retryOne(body.itemId, body.targetId),
  ),
);
