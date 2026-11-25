/**
 * What a dropzone takes: `"*"` (anything), a mime family (`"image/*"`), an
 * exact mime, or several of those.
 */
export type UploadAccept = string | readonly string[];

function acceptList(accept: UploadAccept): readonly string[] {
  return typeof accept === "string" ? [accept] : accept;
}

/** Does `mime` match `accept`? `"*"` → always; `"x/*"` → prefix; else equality. */
export function matchesAccept(accept: UploadAccept, mime: string): boolean {
  return acceptList(accept).some((a) => {
    if (a === "*") return true;
    if (a.endsWith("/*")) return mime.startsWith(a.slice(0, -1));
    return mime === a;
  });
}

/** The file input's `accept` attribute (none for `"*"`). */
export function inputAccept(accept: UploadAccept): string | undefined {
  const list = acceptList(accept);
  return list.includes("*") ? undefined : list.join(",");
}
