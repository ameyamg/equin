import { eq } from "drizzle-orm";
import type { ServerPluginDefinition } from "@plugins/framework/plugins/server-core/core";
import { idChipServer } from "@plugins/active-data/plugins/id-chip/server";
import { db } from "@plugins/database/server";
import { decisionIdKind } from "@plugins/tasks/plugins/decisions/core";
import { _decisions } from "@plugins/tasks/plugins/decisions/server";
import { DECISION_CHIP_SURFACES } from "../core";

export default {
  description:
    "The decision id chip's server half (idChipServer): resolves a `dec-…` to its label and question for the id registry and for model-read text.",
  contributions: [
    ...idChipServer({
      kind: decisionIdKind,
      surfaces: DECISION_CHIP_SURFACES,
      resolve: async (id) => {
        if (!decisionIdKind.is(id)) return { found: false };
        const [row] = await db
          .select({ label: _decisions.label, question: _decisions.question })
          .from(_decisions)
          .where(eq(_decisions.id, id))
          .limit(1);
        return row === undefined
          ? { found: false }
          : { found: true, title: `${row.label}: ${row.question}` };
      },
    }),
  ],
} satisfies ServerPluginDefinition;
