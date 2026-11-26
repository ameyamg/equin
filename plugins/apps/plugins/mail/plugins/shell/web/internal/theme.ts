import { both, defineTheme } from "@plugins/ui/plugins/theme-engine/core";
import { colorPaletteGroup } from "@plugins/ui/plugins/tokens/plugins/color-palette/core";
import { sidebarPaletteGroup } from "@plugins/ui/plugins/tokens/plugins/sidebar-palette/core";
import { fontFamilyGroup } from "@plugins/ui/plugins/tokens/plugins/font-family/core";
import { shapeGroup } from "@plugins/ui/plugins/tokens/plugins/shape/core";
import { shadowGroup } from "@plugins/ui/plugins/tokens/plugins/shadow/core";
import { typeScaleGroup } from "@plugins/ui/plugins/tokens/plugins/type-scale/core";
import { dataViewGroup } from "@plugins/ui/plugins/tokens/plugins/data-view/core";
import { densityGroup } from "@plugins/ui/plugins/tokens/plugins/density/core";
import { sidebarMetricsGroup } from "@plugins/ui/plugins/tokens/plugins/sidebar-metrics/core";

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

// The sidebar's rows are pills hung from its left edge (`.nav`: 0 16px 16px 0).
// Controls 8px (`.compose`, `.q`, `.ib`), the day cards 10px (`.card`).
const shape = shapeGroup.fragment(
  both({
    radius: "0.5rem",
    radiusCard: "0.625rem",
    radiusNavRow: "0 1rem 1rem 0",
  }),
);

/**
 * The prototype's type: 13.5px text on a 1.4 line (`body`), the 18px
 * subject over a thread, the 16px view
 * name (`.bar h1`), 12.5px day headers at 500 (`.sec-h`), 12px times and
 * counts (`.time`, `.nav .n` — the compact caption rung a row draws them in).
 * Names read at 450 (`.nav`), the current view's semibold (`.nav.on`).
 */
const typeScale = typeScaleGroup.fragment(
  both({
    fontSizeBody: "0.84375rem",
    lineHeightBody: "1.18125rem",
    fontSizeLabel: "0.84375rem",
    lineHeightLabel: "1.18125rem",
    fontWeightLabel: "450",
    fontWeightLabelStrong: "var(--font-weight-semibold)",
    // The reader's subject (`.rd h2`).
    fontSizeTitle: "1.125rem",
    lineHeightTitle: "1.40625rem",
    fontSizeHeading: "1rem",
    lineHeightHeading: "1.4rem",
    lineHeightCaption: "1.05rem",
    // = caption: Mail has no rung below 12px (a row's time is the compact
    // caption, and the prototype draws it at 12px).
    "font-size-2xs": "0.75rem",
    "line-height-2xs": "1.05rem",
    fontSizeGroup: "0.78125rem",
    lineHeightGroup: "1.09375rem",
    fontWeightGroup: "var(--font-weight-medium)",
  }),
);

/** A thread row is 40px with 14px sides (`.row`); Compose, the one large control, 34px. */
const density = densityGroup.fragment(
  both({
    padRowX: "0.875rem",
    padRowY: "0.5rem",
    controlHeightLg: "2.125rem",
    // A row's hover actions are 28px (`.ib`).
    controlHeightXs: "1.75rem",
    // The label tree's rows are the sidebar's 32px (`.nav.lt`): a 14px
    // chevron, its dot then name, each level 16px further in.
    treeRowH: "2rem",
    treeChevronW: "0.875rem",
    treeRowGap: "0.5rem",
    treeIndent: "1rem",
  }),
);

/** The sidebar's rows (`.nav`): 32px, the glyph 20px in, 12px to its name. */
const sidebarMetrics = sidebarMetricsGroup.fragment(
  both({
    sidebarRowHeight: "2rem",
    sidebarRowPadX: "1.25rem",
    sidebarIconSize: "1rem",
    sidebarIconGap: "0.75rem",
  }),
);

const shadow = shadowGroup.fragment(
  both({
    "shadow-sm": "0 1px 2px rgba(0, 0, 0, 0.25)",
    shadow: "0 1px 2px rgba(0, 0, 0, 0.25)",
    "shadow-md": "0 14px 34px rgba(0, 0, 0, 0.45)",
    "shadow-lg": "0 14px 34px rgba(0, 0, 0, 0.45)",
  }),
);

/** The day groups name the day alone: a tally per day is noise in a mail list. */
// The day cards stand on their shadow alone (`.card`: no border).
// A day's header sits 16px under the bar or the card above (`.sec-h`
// margin), 4px in from the card's edge, 5px over its card.
const dataView = dataViewGroup.fragment(
  both({
    groupCount: "hidden",
    sectionCardBorder: "transparent",
    groupHeaderPadX: "0.25rem",
    groupHeaderPadY: "0.21875rem",
    groupHeaderSpaceBelow: "0.3125rem",
    groupGap: "1rem",
    toolbarSpaceBelow: "1.125rem",
  }),
);

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
    typeScale,
    density,
    sidebarMetrics,
    shadow,
    dataView,
  ],
});
