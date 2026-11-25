import { createContext } from "react";
import type { FieldDef } from "@plugins/fields/core";

/**
 * Whether a secret field already holds a value, for a form whose secrets are
 * stored by its owner rather than as config (`FieldsForm` over a record with
 * `secretField`s — a syndication target's settings). The owner answers per
 * field DEF (the same object it handed the form: `FieldsForm` renders the
 * record verbatim) from what it read — never the value, which stays on the
 * computer. Loading is the owner's to render: it mounts the form once known.
 *
 * Absent (and outside a config field): the field is a plain secret input.
 */
export const SecretFieldStatusContext = createContext<
  ((field: FieldDef<string>) => boolean) | null
>(null);
