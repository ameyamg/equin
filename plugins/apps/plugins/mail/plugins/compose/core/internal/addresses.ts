import type { Participant } from "@plugins/apps/plugins/mail/plugins/provider/core";

/**
 * An address a recipient field can send to: printable ASCII, one `@`, a dot
 * in the domain, no spaces or angle brackets. (An internationalised address
 * needs SMTPUTF8, which the message builder does not write: refused, named.)
 */
const ADDRESS = /^[!#-'*+\-./0-9=?A-Z^-~]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;

export type AddressListParse =
  | { kind: "ok"; addresses: Participant[] }
  | { kind: "invalid"; addresses: Participant[]; invalid: string[] };

/**
 * A recipient field as typed — `Ana <ana@x.com>, "Doe, J" <j@y.org>; bob@z.io`
 * — as addresses: split at `,` / `;` outside quotes and angle brackets, each
 * piece `Name <address>`, `"Name" <address>` or a bare address. The pieces
 * that are none of those are named (`invalid`), never dropped silently.
 */
export function parseAddressList(text: string): AddressListParse {
  const pieces: string[] = [];
  let cur = "";
  let quoted = false;
  let angled = false;
  for (const ch of text) {
    if (ch === '"' && !angled) quoted = !quoted;
    else if (ch === "<" && !quoted) angled = true;
    else if (ch === ">" && !quoted) angled = false;
    if ((ch === "," || ch === ";" || ch === "\n") && !quoted && !angled) {
      pieces.push(cur);
      cur = "";
    } else cur += ch;
  }
  pieces.push(cur);
  const addresses: Participant[] = [];
  const invalid: string[] = [];
  for (const raw of pieces) {
    const piece = raw.trim();
    if (piece === "") continue;
    const angle = /^(.*)<([^<>]*)>$/.exec(piece);
    const address = (angle ? angle[2]! : piece).trim();
    let name: string | null = angle ? angle[1]!.trim() : null;
    if (name !== null && /^".*"$/.test(name)) {
      name = name.slice(1, -1).replace(/\\(["\\])/g, "$1");
    }
    if (!ADDRESS.test(address)) {
      invalid.push(piece);
      continue;
    }
    addresses.push({ name: name === "" ? null : name, address });
  }
  return invalid.length === 0
    ? { kind: "ok", addresses }
    : { kind: "invalid", addresses, invalid };
}

/** Addresses as a recipient field shows them (the inverse of `parseAddressList`). */
export function formatAddressList(list: readonly Participant[]): string {
  return list
    .map((p) => {
      if (p.name === null || p.name.trim() === "") return p.address;
      const name = /[,;<>"]/.test(p.name)
        ? `"${p.name.replace(/(["\\])/g, "\\$1")}"`
        : p.name;
      return `${name} <${p.address}>`;
    })
    .join(", ");
}
