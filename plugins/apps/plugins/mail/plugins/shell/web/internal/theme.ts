import { both, defineTheme } from "@plugins/ui/plugins/theme-engine/core";
import { colorPaletteGroup } from "@plugins/ui/plugins/tokens/plugins/color-palette/core";
import { sidebarPaletteGroup } from "@plugins/ui/plugins/tokens/plugins/sidebar-palette/core";
import { fontFamilyGroup } from "@plugins/ui/plugins/tokens/plugins/font-family/core";
import { shapeGroup } from "@plugins/ui/plugins/tokens/plugins/shape/core";
import { shadowGroup } from "@plugins/ui/plugins/tokens/plugins/shadow/core";
import { dataViewGroup } from "@plugins/ui/plugins/tokens/plugins/data-view/core";

// The approved Mail prototype's dark palette (proto-1795656296-rtsmk5 `:root`).
// Dark only: the Mail app declares `colorMode: "dark"`, so the theme writes
// the same values for both modes (`both`).
const BG = "#12151b";
const SURFACE = "#1b1f27";
const RAISE = "#222731";
const INK = "#e7eaf0";
const INK_2 = "#9aa3b2";
const INK_3 = "#6c7483";
const ACCENT = "#7ba1ee";
const FILL = "#3f6fd0";
const DANGER = "#e58d7f";
const LINE = "rgba(255, 255, 255, 0.07)";
const LINE_2 = "rgba(255, 255, 255, 0.13)";

const colorPalette = colorPaletteGroup.fragment(
  both({
    background: BG,
    foreground: INK,
    card: SURFACE,
    cardForeground: INK,
    popover: RAISE,
    popoverForeground: INK,
    primary: FILL,
    primaryForeground: "#ffffff",
    primaryText: ACCENT,
    secondary: RAISE,
    secondaryForeground: INK,
    muted: RAISE,
    mutedForeground: INK_2,
    faintForeground: INK_3,
    accent: RAISE,
    accentForeground: INK,
    // The prototype's current view / label (`.nav.on`): an accent wash on
    // the ground, its name and glyph in the accent.
    selected: `color-mix(in srgb, ${ACCENT} 17%, ${BG})`,
    selectedForeground: ACCENT,
    destructive: DANGER,
    info: ACCENT,
    border: LINE,
    input: LINE_2,
    ring: ACCENT,
    switchTrack: LINE_2,
  }),
);

/** The sidebar sits on the page ground, as in the prototype. */
const sidebarPalette = sidebarPaletteGroup.fragment(
  both({
    sidebar: BG,
    sidebarForeground: INK_2,
    sidebarBorder: LINE,
    sidebarAccent: RAISE,
    sidebarAccentForeground: INK,
  }),
);

const fontFamily = fontFamilyGroup.fragment(
  both({
    fontSans:
      'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
    fontSmoothing: "antialiased",
  }),
);

const shape = shapeGroup.fragment(both({ radius: "0.625rem" }));

const shadow = shadowGroup.fragment(
  both({
    "shadow-sm": "0 1px 2px rgba(0, 0, 0, 0.25)",
    shadow: "0 1px 2px rgba(0, 0, 0, 0.25)",
    "shadow-md": "0 14px 34px rgba(0, 0, 0, 0.45)",
    "shadow-lg": "0 14px 34px rgba(0, 0, 0, 0.45)",
  }),
);

/** The day groups name the day alone: a tally per day is noise in a mail list. */
const dataView = dataViewGroup.fragment(both({ groupCount: "hidden" }));

/**
 * The Mail app's own theme (dark only): the prototype's slate ground, raised
 * cards and a soft blue accent. Selected for the app in
 * `config/ui/theme-engine/@app/mail/theme.jsonc`. A group it does not mention
 * paints that group's schema defaults.
 */
export const mailTheme = defineTheme({
  id: "mail",
  label: "Mail",
  fragments: [
    colorPalette,
    sidebarPalette,
    fontFamily,
    shape,
    shadow,
    dataView,
  ],
});
