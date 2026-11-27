import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { usePaneTitle } from "@plugins/primitives/plugins/pane/web";
import { websiteApp } from "@plugins/apps/plugins/website/plugins/shell/core";
import { pluginSystemPage } from "../../core";
import { pluginSystemPane } from "../panes";

// The pane takes its title from its page declaration and its route from the
// page path (`crawlable:pages-declared`): links, history entries and
// section-reach keys all carry its URL and route id.
describe("pluginSystemPane", () => {
  it("has its URL and route id", () => {
    expect(pluginSystemPane.link(websiteApp, {})).toBe("/about/plugin-system");
    expect(pluginSystemPane._internal.id).toBe("website-plugin-system");
    expect(pluginSystemPane._internal.appIndex).toBe(false);
  });

  it("takes its title from the page declaration", () => {
    const { result } = renderHook(() =>
      usePaneTitle(pluginSystemPane._internal, {}, {}, {}),
    );
    expect(result.current).toBe(pluginSystemPage.title);
  });
});
