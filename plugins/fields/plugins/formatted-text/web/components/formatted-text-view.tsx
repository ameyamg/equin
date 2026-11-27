import { Fragment, type ReactNode } from "react";
import {
  parseFormattedText,
  type FormattedText,
} from "@plugins/fields/plugins/formatted-text/core";
import "./formatted-text-view.css";

/**
 * A formatted text's source, drawn: bold as `<strong>`, a key cap as `<kbd>`,
 * a link as `<a>` (a web or mail link in a new tab, a site path in place),
 * line breaks kept. Inline runs only, in the element of the caller's choice
 * (`as`, a `<span>` by default) — the caller's `className` sets the type
 * (`whitespace-pre-line` is always applied, so a newline breaks the line).
 */
export function FormattedTextView({
  source,
  as: Tag = "span",
  className,
}: {
  source: string;
  as?: "span" | "p" | "div";
  className?: string;
}) {
  return (
    <Tag
      className={
        className ? `whitespace-pre-line ${className}` : "whitespace-pre-line"
      }
    >
      {runs(parseFormattedText(source))}
    </Tag>
  );
}

function runs(text: FormattedText): ReactNode {
  return text.map((n, i) => {
    switch (n.kind) {
      case "text":
        return <Fragment key={i}>{n.text}</Fragment>;
      case "strong":
        return (
          <strong key={i} className="formatted-text-strong">
            {runs(n.children)}
          </strong>
        );
      case "key":
        return (
          <kbd key={i} className="formatted-text-key">
            {n.text}
          </kbd>
        );
      case "link": {
        const away = !n.href.startsWith("/");
        return (
          <a
            key={i}
            href={n.href}
            className="text-primary-text underline"
            target={away ? "_blank" : undefined}
            rel={away ? "noopener noreferrer" : undefined}
          >
            {runs(n.children)}
          </a>
        );
      }
    }
  });
}
