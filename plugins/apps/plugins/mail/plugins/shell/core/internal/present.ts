/**
 * How Mail says who and when — pure, shared by the thread list and the reader,
 * so both (and their tests) read one answer.
 */

/** The avatar palette: six data colours, picked per sender (the prototype's `--k1…6`). */
const AVATAR_COLORS = [
  "#d4854f",
  "#8069c6",
  "#3797a6",
  "#6b7a94",
  "#cc9c42",
  "#3f6fd0",
] as const;

/** A person's colour: stable for one name (or address). */
export function avatarColor(key: string): string {
  let sum = 0;
  for (const ch of key) sum += ch.codePointAt(0) ?? 0;
  return AVATAR_COLORS[sum % AVATAR_COLORS.length]!;
}

/** Up to two initials of a name ("Maya Chen" → "MC"), else the address's first letter. */
export function initials(name: string | null, address: string): string {
  const words = (name ?? "")
    .trim()
    .split(/\s+/)
    .filter((w) => w !== "");
  if (words.length === 0) return (address[0] ?? "?").toUpperCase();
  return words
    .slice(0, 2)
    .map((w) => [...w][0]!.toUpperCase())
    .join("");
}

/** A person as a row names them: their first name, else their address's local part. */
export function shortName(p: { name: string | null; address: string }): string {
  const first = (p.name ?? "").trim().split(/\s+/)[0];
  if (first !== undefined && first !== "") return first;
  return p.address.split("@")[0] ?? p.address;
}

/** Text as one line: every run of whitespace (a snippet's line breaks and padding) one space. */
export function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** A person in full: their name, else their address. */
export function fullName(p: { name: string | null; address: string }): string {
  const name = (p.name ?? "").trim();
  return name !== "" ? name : p.address;
}

/**
 * When a thread's latest message came, the way a mail list says it: the time
 * today, "Yesterday", the weekday within the week, else the day and month
 * (and the year when it is not this one).
 */
export function listTime(at: Date, now: Date, locale?: string): string {
  const day = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(now) - day(at)) / 86_400_000);
  if (days <= 0) {
    return new Intl.DateTimeFormat(locale, {
      hour: "numeric",
      minute: "2-digit",
    }).format(at);
  }
  if (days === 1) return "Yesterday";
  if (days < 7) {
    return new Intl.DateTimeFormat(locale, { weekday: "short" }).format(at);
  }
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    ...(at.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
  }).format(at);
}
