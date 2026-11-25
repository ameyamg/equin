import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { usePaneTitle } from "@plugins/primitives/plugins/pane/web";
import { websiteApp } from "@plugins/apps/plugins/website/plugins/shell/core";
import { tipsPage } from "../../core";
import { tipsPane } from "../panes";

// The pane takes its title from its page declaration and its route from the
// page path (`crawlable:pages-declared`).
describe("tipsPane", () => {
  it("lives at /about/tips", () => {
    expect(tipsPane.link(websiteApp, {})).toBe("/about/tips");
    expect(tipsPane._internal.id).toBe("website-tips");
    expect(tipsPane._internal.appIndex).toBe(false);
  });

  it("takes its title from the page declaration", () => {
    const { result } = renderHook(() =>
      usePaneTitle(tipsPane._internal, {}, {}, {}),
    );
    expect(result.current).toBe(tipsPage.title);
  });
});
