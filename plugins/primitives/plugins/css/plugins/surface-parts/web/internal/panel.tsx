import { Children, type ReactNode } from "react";
import { Line } from "@plugins/primitives/plugins/css/plugins/line/web";
import { Text } from "@plugins/primitives/plugins/css/plugins/text/web";
import "./lines.css";

/**
 * The measurement hook of the layout-geometry harness: the one attribute a
 * part forwards. Parts take no `className` and no padding prop — a part's
 * inset is the surface's, never the caller's.
 */
interface Measured {
  "data-geo"?: string;
}

/**
 * A region's children, with every bare string or number boxed. A text node is
 * an anonymous grid item no selector can place; boxed, it lands on `text` like
 * any element. (A component that RETURNS a bare string is not seen here.)
 */
function placed(children: ReactNode): ReactNode {
  return Children.map(children, (child) =>
    typeof child === "string" || typeof child === "number" ? (
      <span className="part-loose">{child}</span>
    ) : (
      child
    ),
  );
}

export interface PanelProps {
  /** The title strip: text on the `text` line, a rule under it. */
  header?: ReactNode;
  /** The search strip: a field with its own room, a rule under it. */
  search?: ReactNode;
  /** The action / status strip: text on the `text` line, a rule over it. */
  footer?: ReactNode;
  /** Content parts, and any other content (it lands on the `text` line). */
  children: ReactNode;
}

/**
 * The body of a floating or docked surface (a menu, a popover, a sidebar),
 * built from parts: each region is a grid of named lines (`lines.css`) and
 * every part sits on one. The host (what floats it, how wide) is not its
 * business; neither is any inset.
 */
function PanelRoot({ header, search, footer, children }: PanelProps) {
  return (
    <div className="part-panel">
      {header === undefined ? null : (
        <div className="part-panel-band part-lines" data-rule="bottom">
          {placed(header)}
        </div>
      )}
      {search === undefined ? null : (
        <div className="part-panel-search">{search}</div>
      )}
      <div className="part-panel-body part-lines">{placed(children)}</div>
      {footer === undefined ? null : (
        <div className="part-panel-band part-lines" data-rule="top">
          {placed(footer)}
        </div>
      )}
    </div>
  );
}

export interface PanelSectionProps {
  /** The section's label, on the `text` line. */
  label: ReactNode;
  children: ReactNode;
}

/** A labelled group. Sections nest; nesting adds no inset. */
function PanelSection({ label, children }: PanelSectionProps) {
  return (
    <div className="part-relay">
      <div className="part-section-head">
        <Text variant="caption">{label}</Text>
      </div>
      {placed(children)}
    </div>
  );
}

export interface PanelRowProps extends Measured {
  /** A leading glyph, before the label. */
  icon?: ReactNode;
  /** A trailing hint, after the label. */
  hint?: ReactNode;
  onSelect: () => void;
  children: ReactNode;
}

/**
 * An interactive row: its fill runs from `fill` to `fill`, its content starts
 * on `text` — the row pad is the distance between the two lines, so a row's
 * text and a label's text cannot disagree.
 */
function PanelRow({
  icon,
  hint,
  onSelect,
  children,
  "data-geo": geo,
}: PanelRowProps) {
  return (
    <button
      type="button"
      className="part-row part-relay part-at-fill"
      data-geo={geo}
      onClick={onSelect}
    >
      <Line className="gap-sm">
        {icon}
        <Text>{children}</Text>
        {hint}
      </Line>
    </button>
  );
}

/** A hairline, edge to edge. */
function PanelRule({ "data-geo": geo }: Measured) {
  return (
    <div role="separator" className="part-rule part-at-edge" data-geo={geo} />
  );
}

export interface PanelFullProps extends Measured {
  children: ReactNode;
}

/** The placement of a block that spans the region edge to edge. */
function PanelFull({ children, "data-geo": geo }: PanelFullProps) {
  return (
    <div className="part-at-edge" data-geo={geo}>
      {children}
    </div>
  );
}

export interface PanelStripProps extends Measured {
  children: ReactNode;
}

/** One line that scrolls sideways edge to edge, its content starting on `text`. */
function PanelStrip({ children, "data-geo": geo }: PanelStripProps) {
  return (
    <div className="part-strip part-at-edge" data-geo={geo}>
      {children}
    </div>
  );
}

export interface PanelStateProps {
  children: ReactNode;
}

/** Text standing in for content (empty, loading, failed), on the `text` line. */
function PanelState({ children }: PanelStateProps) {
  return (
    <div className="part-state">
      <Text variant="body">{children}</Text>
    </div>
  );
}

export const Panel = Object.assign(PanelRoot, {
  Section: PanelSection,
  Row: PanelRow,
  Rule: PanelRule,
  Full: PanelFull,
  Strip: PanelStrip,
  State: PanelState,
});
