/**
 * The repository's issue templates (`.github/ISSUE_TEMPLATE/<file>`), as data.
 *
 * They exist for their label: GitHub applies a new-issue link's `labels=` only
 * for a filer with triage rights, so an outside user's report arrived
 * unlabelled (issue #3) — but it applies a template's front-matter labels for
 * anyone who files through it (`template=<file>`). So a template is a label
 * and a line in GitHub's chooser, nothing more: the link fills the whole body,
 * and an issue filed through it reads as a regular one. `body` is only what
 * someone who picks the template by hand starts from.
 *
 * The files are rendered from this table (`issueTemplateFile`) and held equal
 * to it by the `github-issues:templates-in-sync` check.
 */
export const ISSUE_TEMPLATES = {
  install: {
    file: "install.md",
    name: "Install problem",
    about:
      "Filed by equin's installer (Report). For anything else, choose Blank issue.",
    label: "install",
    body: "Tip: run `./install.sh --report` in your equin folder: it fills this in with what happened, and copies the install log for you to paste.\n",
  },
  wish: {
    file: "wish.md",
    name: "Wish",
    about: "Filed from equin's Wish button.",
    label: "Wish",
    body: "",
  },
} as const satisfies Record<string, IssueTemplate>;

export interface IssueTemplate {
  /** The file under `.github/ISSUE_TEMPLATE/`, and the link's `template=`. */
  file: string;
  /** Its entry in GitHub's New issue chooser. */
  name: string;
  /** The chooser's one line under the name. */
  about: string;
  /** The label GitHub applies to every issue filed through it. */
  label: string;
  /** What a hand-picked template starts with (a link's `body=` replaces it). */
  body: string;
}

export type IssueTemplateId = keyof typeof ISSUE_TEMPLATES;

/** Where the template files live, from the repository root. */
export const ISSUE_TEMPLATE_DIR = ".github/ISSUE_TEMPLATE";

/** A template's file, exactly as committed. */
export function issueTemplateFile(template: IssueTemplate): string {
  const quoted = (s: string) => JSON.stringify(s);
  return [
    "---",
    `name: ${quoted(template.name)}`,
    `about: ${quoted(template.about)}`,
    `labels: ${quoted(template.label)}`,
    "---",
    "",
    template.body,
  ].join("\n");
}
