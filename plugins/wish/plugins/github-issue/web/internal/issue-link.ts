import { SOURCE_REPO_URL } from "@plugins/framework/plugins/product-name/core";
import {
  buildIssueUrl,
  ISSUE_TEMPLATES,
  issueTitle,
} from "@plugins/integrations/plugins/github-issues/core";

export interface WishIssueInput {
  draft: string;
  /** The page URL the draft shares; `null` leaves the page out of the issue entirely. */
  pageUrl: string | null;
  /** The environment lines the maintainer asks for first. */
  environmentNotes: readonly string[];
}

/** The new-issue link for a wish: what the button opens, and what its tooltip previews. */
export function wishIssueLink({
  draft,
  pageUrl,
  environmentNotes,
}: WishIssueInput): { href: string; title: string; label: string } {
  return {
    href: buildIssueUrl({
      repoUrl: SOURCE_REPO_URL,
      text: draft,
      omitPickUrls: pageUrl === null,
      ...(pageUrl === null ? {} : { pageUrl }),
      notes: [
        ...environmentNotes,
        "Filed from the Wish button in the equin app",
      ],
      template: "wish",
    }),
    title: issueTitle(draft),
    // The wish template carries the label, for any filer.
    label: ISSUE_TEMPLATES.wish.label,
  };
}
