import type { WebsiteTileColor } from "@plugins/apps/plugins/website/plugins/app-tiles/core";
import { symbol, type SymbolRef } from "@plugins/ui/plugins/icons/core";

export type AppCategoryId =
  "harness" | "office" | "leisure" | "tools" | "surfaces" | "next";

export interface AppCategory {
  id: AppCategoryId;
  name: string;
  /** The line beside the group's heading. */
  body: string;
}

export interface CatalogEntry {
  id: string;
  name: string;
  category: AppCategoryId;
  /** The glyph the app's own definition declares (`defineApp({ icon: symbol(…) })`), so the card wears the icon the rail draws. */
  icon: SymbolRef;
  /**
   * The id of the app's own definition (`defineApp({ id })`), `null` for an
   * app not built yet. Text, not the descriptor: importing an app's shell
   * would pull it into the website's composition.
   */
  appId: string | null;
  /**
   * The app's tile colour on the site (`WebsiteAppTile`) — the site's own,
   * vivid palette, one per app (`catalog.test.ts`).
   */
  color: WebsiteTileColor;
  description: string;
  /** One short line, for where the description does not fit (the homepage's app shelf). */
  summary?: string;
  /** Not built yet: drawn dimmed, with no Install. */
  soon?: boolean;
}

/** The gallery's groups, in reading order. */
export const CATEGORIES: readonly AppCategory[] = [
  {
    id: "harness",
    name: "The harness",
    body: "The apps used to build equin itself",
  },
  { id: "office", name: "Office", body: "The apps used to get things done" },
  { id: "leisure", name: "Leisure", body: "The apps used for fun" },
  { id: "tools", name: "Tools", body: "Small utilities the others lean on" },
  // Not apps of their own kind: two ways to hold every other app at once.
  {
    id: "surfaces",
    name: "Home screens",
    body: "The workspace to organize your apps",
  },
  { id: "next", name: "Coming next", body: "Being built now" },
];

/**
 * Every app equin ships, and the ones being built — a closed list, plain data.
 * Adding an app to equin does not add it here: the site is a written page, and
 * this is its copy. Plain data in core/, so what draws the apps outside the
 * page (the repo README's app shelf) reads the same list; the screenshots join
 * it on the web side (`web/internal/catalog.ts`).
 */
export const APPS: readonly CatalogEntry[] = [
  {
    id: "agents",
    appId: "agent-manager",
    color: "sky",
    name: "Agent manager",
    category: "harness",
    icon: symbol("chat-bubble"),
    summary: "Agents working through a task tree",
    description:
      "Nested tasks, each worked on by an agent in its own copy of the code. equin's version of Cursor.",
  },
  {
    id: "prototypes",
    appId: "prototypes",
    color: "violet",
    name: "Prototypes",
    category: "harness",
    icon: symbol("dashboard-customize"),
    summary: "Mockups beside the real app",
    description:
      "Mockups beside the real app they mock, with versions and variants. equin's version of Claude Design.",
  },
  {
    id: "deploy",
    appId: "deploy",
    color: "teal",
    name: "Deploy",
    category: "harness",
    icon: symbol("cloud"),
    description: "A self-hosted PaaS. It deploys the site you are reading.",
  },
  {
    id: "pages",
    appId: "pages",
    color: "blue",
    name: "Pages",
    category: "office",
    icon: symbol("description"),
    summary: "Notion-like editor and agentic wiki",
    description:
      "A Notion-like editor and agentic wiki: blocks, databases, backlinks, and agents writing beside you.",
  },
  {
    id: "mail",
    appId: "mail",
    color: "rose",
    name: "Mail",
    category: "office",
    icon: symbol("mail"),
    summary: "Your inbox as views you build",
    description:
      "Your mail as views you build: every mailbox and label is a filter you can copy and edit.",
  },
  {
    id: "maps",
    appId: "places",
    color: "green",
    name: "Maps",
    category: "office",
    icon: symbol("location-on"),
    summary: "Every place you love, on one map",
    description:
      "The places you want to go and have been, on one map, sorted by a tree of tags.",
  },
  {
    id: "events",
    appId: "events",
    color: "orange",
    name: "Events",
    category: "office",
    icon: symbol("event"),
    description:
      "Social events from many sources, in one place, on a map and a calendar.",
  },
  {
    id: "sonata",
    appId: "sonata",
    color: "emerald",
    name: "Sonata",
    category: "leisure",
    icon: symbol("piano"),
    summary: "Learn piano from any song",
    description:
      "Learn piano from any song: a piano roll, chords broken down, and practice that adapts to you.",
  },
  {
    id: "chord",
    appId: "chord",
    color: "pink",
    name: "Chord",
    category: "leisure",
    icon: symbol("queue-music"),
    summary: "Name the chords of real songs",
    description:
      "An ear trainer that plays loops of real songs and asks you to name each chord.",
  },
  {
    id: "party",
    appId: "keyboard-party",
    color: "fuchsia",
    name: "Tap Tap Party",
    category: "leisure",
    icon: symbol("celebration"),
    description:
      "A keyboard toy for a small child: every key answers with its own animation and sound.",
  },
  {
    id: "browser",
    appId: "browser",
    color: "indigo",
    name: "Browser",
    category: "tools",
    icon: symbol("public"),
    description:
      "A minimal web browser, so a page can sit next to the app that uses it.",
  },
  {
    id: "files",
    appId: "file-explorer",
    color: "amber",
    name: "Files",
    category: "tools",
    icon: symbol("folder"),
    summary: "Your files and every agent's",
    description:
      "Browse and preview files on your machine and in every agent's workspace.",
  },
  {
    id: "desktop",
    appId: "desktop",
    color: "cyan",
    name: "Desktop",
    category: "surfaces",
    icon: symbol("desktop-windows"),
    description: "Use equin as a desktop, with every app in its own window.",
  },
  {
    id: "isle",
    appId: "isle",
    color: "mint",
    name: "Isle",
    category: "surfaces",
    icon: symbol("sailing"),
    description:
      "An RPG-style workspace where you walk around to open your apps.",
  },
  {
    id: "studio",
    appId: "studio",
    color: "purple",
    name: "Studio",
    category: "harness",
    icon: symbol("extension"),
    description:
      "Every plugin of equin, its graph and what it contributes, open to inspect.",
  },
  {
    id: "finance",
    appId: null,
    color: "gold",
    name: "Finance",
    category: "next",
    icon: symbol("account-balance"),
    soon: true,
    description: "Every account in one place: a personal finance aggregator.",
  },
];
