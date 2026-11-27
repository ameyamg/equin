import { both, defineSubTheme } from "@plugins/ui/plugins/theme-engine/core";
import { colorPaletteGroup } from "@plugins/ui/plugins/tokens/plugins/color-palette/core";

/**
 * The night the plugin system page is drawn on: the city of glass bricks is
 * light added to a black ground, so the page (its heading, its chapter text,
 * the site header over it) is dark in both modes — the picture does not change
 * with the mode. The values are the site theme's dark ones, pinned.
 *
 * `muted` / `accent` are the tone a ghost control hovers to on the header
 * (`--hover-fill`); left out they would fall through to the desktop's mode.
 */
export const pluginSystemNightTheme = defineSubTheme({
  id: "plugin-system-night",
  label: "plugin system night",
  fragments: [
    colorPaletteGroup.fragment(
      both({
        background: "#07090e",
        border: "rgba(255, 255, 255, 0.08)",
        foreground: "#f4f4f5",
        mutedForeground: "#b4b4bd",
        faintForeground: "#8a909c",
        muted: "#1a1e27",
        accent: "#1a1e27",
        accentForeground: "#f4f4f5",
        primaryText: "#60a5fa",
        secondary: "#f4f4f5",
        secondaryForeground: "#000000",
      }),
    ),
  ],
});
