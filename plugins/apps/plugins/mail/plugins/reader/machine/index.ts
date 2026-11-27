import type { MachinePluginDefinition } from "@plugins/framework/plugins/server-core/core";
import { machineHandler } from "@plugins/infra/plugins/endpoints/machine";
import { mailImageProxy } from "../core";
import { handleImage } from "./internal/image";

export default {
  description:
    "The Mail reader, desktop half: the signed image proxy (GET /api/mail/image/:sig) — a remote image of a mail body fetched by this computer's server, SSRF-guarded, so the sender never sees the reader's address (needsMachine: a browser host has no such fetch).",
  httpRoutes: {
    [mailImageProxy.route]: machineHandler(mailImageProxy, handleImage),
  },
} satisfies MachinePluginDefinition;
