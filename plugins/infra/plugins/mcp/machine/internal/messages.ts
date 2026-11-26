/**
 * The JSON-RPC messages a POST body holds (one, or a batch). Reads a clone so
 * the transport still consumes the original body. Unparseable JSON holds none:
 * the transport answers it with its own JSON-RPC parse error.
 */
export async function bodyMessages(req: Request): Promise<unknown[]> {
  let body: unknown;
  try {
    body = await req.clone().json();
  } catch (err) {
    if (err instanceof SyntaxError) return [];
    throw err;
  }
  return Array.isArray(body) ? body : [body];
}

/** Whether the messages are (or contain) a `tools/list` request. */
export function hasToolsList(messages: readonly unknown[]): boolean {
  return messages.some((m) => methodOf(m) === "tools/list");
}

/** Whether the messages are (or contain) an `initialize` request. */
export function hasInitialize(messages: readonly unknown[]): boolean {
  return messages.some((m) => methodOf(m) === "initialize");
}

/**
 * Whether the messages hold a request — a message with a method and an id,
 * which the server answers (a notification alone is answered 202, no body).
 */
export function hasRequest(messages: readonly unknown[]): boolean {
  return messages.some(
    (m) =>
      methodOf(m) !== undefined && (m as { id?: unknown }).id !== undefined,
  );
}

function methodOf(m: unknown): string | undefined {
  if (typeof m !== "object" || m === null) return undefined;
  const method = (m as { method?: unknown }).method;
  return typeof method === "string" ? method : undefined;
}
