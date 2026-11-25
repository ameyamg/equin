import type { WebLinkProps } from "../slots";

/** A web link no plugin claimed: a real link opening the site in a new tab. */
export function PlainWebLink({ href, children, ...rest }: WebLinkProps) {
  return (
    <a
      {...rest}
      className="text-primary-text underline"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}
    </a>
  );
}
