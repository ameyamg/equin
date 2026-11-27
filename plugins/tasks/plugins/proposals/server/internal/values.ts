import { fieldsToZodObject, type FieldsRecord } from "@plugins/fields/core";

/** A record's values read through its fields: a field added since takes its default. */
export function resolveValues(
  fields: FieldsRecord,
  values: Readonly<Record<string, unknown>>,
):
  | { kind: "valid"; values: Record<string, unknown> }
  | { kind: "invalid"; message: string } {
  const parsed = fieldsToZodObject(fields).strict().safeParse(values);
  if (parsed.success) {
    return { kind: "valid", values: parsed.data as Record<string, unknown> };
  }
  return {
    kind: "invalid",
    message: parsed.error.issues
      .slice(0, 10)
      .map((i) => `${i.path.join(".") || "(record)"}: ${i.message}`)
      .join("; "),
  };
}

/** The values a new record of these fields starts from. */
export function defaultValues(fields: FieldsRecord): Record<string, unknown> {
  return fieldsToZodObject(fields).parse({}) as Record<string, unknown>;
}
