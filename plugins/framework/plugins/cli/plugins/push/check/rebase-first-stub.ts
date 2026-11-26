/**
 * The pre-rebase stub's two invariants, read from the files' text.
 *
 * The stub (`../scripts/rebase-first.sh`) is the only part of `./equin push`
 * that still runs a branch's OLD code before the branch is on top of main. It
 * stays safe only while it depends on nothing main changes, and only while it
 * runs before everything else. Both are what this measures:
 *
 * 1. `./equin` invokes it FIRST — the only lines above it are `set -e` and the
 *    `cd` to the checkout. A step put above it (the data-root script, the
 *    process naming, the bun guard's doctor) would run the branch's old copy
 *    again before the rebase.
 * 2. The stub reaches nothing in the repo and nothing but git and sh: no `bun`,
 *    no `./equin`, no repo path, no sourced script. Its printed messages (the
 *    heredoc) may name `./equin`; its commands may not.
 *
 * No flaw: an old branch's copy of these files runs by definition, so no API
 * can keep a future edit from widening them; the check holds the next copy
 * narrow before it lands.
 */

export const WRAPPER_FILE = "equin";
export const STUB_SCRIPT =
  "plugins/framework/plugins/cli/plugins/push/scripts/rebase-first.sh";

/** The shell lines that do something: no comment, no blank, no shebang. */
function commandLines(text: string): { line: number; text: string }[] {
  const out: { line: number; text: string }[] = [];
  let heredocEnd: string | null = null;
  text.split("\n").forEach((raw, i) => {
    const trimmed = raw.trim();
    if (heredocEnd !== null) {
      if (trimmed === heredocEnd) heredocEnd = null;
      return;
    }
    if (trimmed === "" || trimmed.startsWith("#")) return;
    const heredoc = /<<-?\s*['"]?([A-Za-z_]+)['"]?/.exec(trimmed);
    if (heredoc) heredocEnd = heredoc[1]!;
    out.push({ line: i + 1, text: trimmed.replace(/\s+#.*$/, "") });
  });
  return out;
}

/** The `if [ "${1:-}" = push ] …` line that opens the stub's block. */
const PUSH_GUARD = /^if \[ "\$\{1:-\}" = push \]/;

const ALLOWED_PREAMBLE = ["set -e", 'cd "$(dirname "$0")"'];

export function wrapperFindings(equin: string): string[] {
  const lines = commandLines(equin);
  const guard = lines.findIndex((l) => PUSH_GUARD.test(l.text));
  const invoked = lines.findIndex((l) => l.text.includes(STUB_SCRIPT));
  if (guard === -1 || invoked === -1 || invoked < guard)
    return [
      `${WRAPPER_FILE} must run ${STUB_SCRIPT} inside an \`if [ "\${1:-}" = push ] …\` block.`,
    ];
  const before = (l: { line: number; text: string }) =>
    `${WRAPPER_FILE}:${l.line}: \`${l.text}\` runs before the pre-rebase stub`;
  return [
    ...lines
      .slice(0, guard)
      .filter((l, i) => l.text !== ALLOWED_PREAMBLE[i])
      .map(
        (l) =>
          `${before(l)}; only ${ALLOWED_PREAMBLE.map((p) => `\`${p}\``).join(" and ")} may.`,
      ),
    // Inside the block, only plain variable assignments may precede it.
    ...lines
      .slice(guard + 1, invoked)
      .filter((l) => !/^[A-Za-z_][A-Za-z0-9_]*=[A-Za-z0-9_]*$/.test(l.text))
      .map((l) => `${before(l)}, inside its block.`),
  ];
}

// What would make the stub depend on the repo or on more than git and sh.
const REACHES: { pattern: RegExp; what: string }[] = [
  { pattern: /(^|[\s;&|(`])bun(\s|$)/, what: "runs bun" },
  { pattern: /(^|[\s;&|(`])\.\/[A-Za-z]/, what: "runs a repo file" },
  { pattern: /\bplugins\//, what: "names a repo path" },
  { pattern: /\bnode_modules\b/, what: "reads node_modules" },
  { pattern: /(^|[\s;&|])(\.|source)\s+\S/, what: "sources a script" },
  {
    pattern: /(^|[\s;&|(`])(eval|exec|sh|bash|node|env)(\s|$)/,
    what: "runs a command line it does not spell out",
  },
  {
    pattern: /\/equin(["'\s]|$)|--show-toplevel/,
    what: "reaches the checkout's files",
  },
];

export function stubFindings(stub: string): string[] {
  const findings: string[] = [];
  for (const l of commandLines(stub)) {
    for (const { pattern, what } of REACHES) {
      if (pattern.test(l.text))
        findings.push(`${STUB_SCRIPT}:${l.line}: ${what}: \`${l.text}\``);
    }
  }
  return findings;
}
