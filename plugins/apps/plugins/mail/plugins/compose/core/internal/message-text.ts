// The text/plain a message goes out with: what a body holds of its own
// signature, and the body, signature and quote put together.

/**
 * Whether a body carries its own signature: a line that is the `-- `
 * delimiter (RFC 3676) — a draft written in the provider's own editor and
 * adopted. Such a body is not signed again, and the editor shows no
 * signature block under it.
 */
export function bodySigned(body: string): boolean {
  return /(^|\n)-- \r?(\n|$)/.test(body);
}

/**
 * The text a message goes out with: the body as written, then the signature
 * under the `-- ` delimiter (RFC 3676) — unless the body is signed already (a
 * line that is the delimiter: a draft written in the provider's own editor
 * and adopted, whatever its signature then rendered as) — then the quote a
 * reply answers. Nothing added: the body exactly as written.
 */
export function messageText(
  body: string,
  signature: string | null,
  quote: string | null,
): string {
  const signs = signature !== null && !bodySigned(body);
  if (!signs && quote === null) return body;
  let text = body.replace(/\s+$/, "");
  if (signs)
    text = text === "" ? `-- \n${signature}` : `${text}\n\n-- \n${signature}`;
  return quote === null ? `${text}\n` : `${text}\n\n${quote}\n`;
}
