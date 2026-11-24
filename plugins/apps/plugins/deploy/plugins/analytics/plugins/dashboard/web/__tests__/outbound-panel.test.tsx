/**
 * The Outbound links panel: one `outbound_click` prop per tab (destination,
 * page, link), each row named by the prop's value and filtering by its own
 * (event_prop, value).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Dimension } from "@plugins/apps/plugins/deploy/plugins/analytics/plugins/collect/core";
import { PANELS } from "../internal/panels";
import { RankedPanel } from "../components/ranked-panel";
import { report, row } from "../testing";

afterEach(cleanup);

const outbound = PANELS.find((p) => p.id === "outbound")!;
const sample = report({
  rows: {
    ...report().rows,
    event_prop: [
      row("outbound_click.to=github_repo", { visitors: 5, events: 7 }),
      row("outbound_click.to=discord", { visitors: 2, events: 2 }),
      row("outbound_click.page=/about", { visitors: 6, events: 8 }),
      row("outbound_click.link=header_github", { visitors: 4, events: 5 }),
      row("card_open.card=Pages", { visitors: 3, events: 6 }),
    ],
  },
});

function renderTab(
  tabId: string,
  onFilterRow: (d: Dimension, v: string) => void = () => {},
) {
  render(
    <RankedPanel
      panel={outbound}
      tabId={tabId}
      onTab={() => {}}
      report={sample}
      source="raw"
      filters={[]}
      onFilterRow={onFilterRow}
    />,
  );
}

describe("outbound links panel", () => {
  it("ranks destinations by their own name, and filters by one", () => {
    const onFilterRow = vi.fn();
    renderTab("destination", onFilterRow);
    expect(screen.getByText("github_repo")).toBeTruthy();
    expect(screen.getByText("discord")).toBeTruthy();
    expect(screen.queryByText("/about")).toBeNull();
    expect(screen.queryByText("Pages")).toBeNull();
    fireEvent.click(screen.getByTitle("Filter by discord"));
    expect(onFilterRow).toHaveBeenCalledWith(
      "event_prop",
      "outbound_click.to=discord",
    );
  });

  it("has a tab per page and per link", () => {
    renderTab("page");
    expect(screen.getByText("/about")).toBeTruthy();
    cleanup();
    renderTab("link");
    expect(screen.getByText("header_github")).toBeTruthy();
    expect(screen.queryByText("github_repo")).toBeNull();
  });
});
