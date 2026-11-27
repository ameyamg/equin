/** What a pasted file is called when the clipboard gave it no name of its own. */
const PASTED_IMAGE = "Pasted image";

/**
 * The name a file pasted from the system clipboard is saved under: its own
 * (a file copied in the Finder), else — an image copied from a page or a
 * screenshot, which the browser names `image.png` — "Pasted image" with the
 * extension of its type. Whatever it is, its name opens for editing.
 */
export function pastedFileName(file: { name: string; type: string }): string {
  const own = file.name.replaceAll("/", "-").replaceAll("\0", "");
  const generic = own === "" || /^image\.[a-z0-9]+$/i.test(own);
  if (!generic && own !== "." && own !== "..") return own;
  const ext =
    own.includes(".") && own !== "." && own !== ".."
      ? own.slice(own.lastIndexOf(".") + 1)
      : extensionOf(file.type);
  return ext === "" ? PASTED_IMAGE : `${PASTED_IMAGE}.${ext}`;
}

/** `image/png` → `png`, `image/svg+xml` → `svg`; `""` for no type. */
function extensionOf(type: string): string {
  const sub = type.split("/")[1] ?? "";
  const ext = sub.split("+")[0]!.toLowerCase();
  return ext === "jpeg" ? "jpg" : ext;
}
