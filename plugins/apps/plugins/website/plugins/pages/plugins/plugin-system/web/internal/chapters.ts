/**
 * The page in eight chapters. The picture has its own timeline p: a chapter
 * stands at one place on it (`p`, a number) and holds there while its card is
 * read, or spans a stretch of it (`p`, a pair): then its card stays in place
 * while the scroll plays that stretch (a feature removed then the database
 * swapped; three standalone builds lit one after the other).
 *
 * Copy as approved on the prototype (proto-1794379870-rcqzur), verbatim.
 */
export interface Chapter {
  /** Stable id: the analytics key (`plugin-system/<key>`). */
  key: string;
  /** The chapter's name on the strip under the header. */
  name: string;
  title: string;
  body: string;
  /** Where the chapter stands on the picture's timeline, or the stretch it plays. */
  p: number | readonly [number, number];
  /** A longer step: more scroll for the transition into this chapter. */
  tall?: boolean;
}

export const CHAPTERS: readonly Chapter[] = [
  {
    key: "plugin",
    name: "A plugin",
    title: "A plugin is one feature.",
    body: "Each feature is one self-contained block. It holds both halves of the feature: the code that runs in your browser and the code that runs on the server.",
    p: 0,
  },
  {
    key: "slots",
    name: "Slots",
    title: "Plugins connect together.",
    body: "Each plugin can expose slots for others to connect to, or use slots from other plugins. For example, a button plugin can contribute to the slot exposed by a toolbar plugin.",
    p: 1,
  },
  {
    key: "infrastructure",
    name: "Infrastructure",
    title: "Infrastructure is also plugins.",
    body: "equin uses plugins all the way down. All the server and tooling infrastructure that apps are built on is also made of plugins.",
    p: 2,
  },
  {
    key: "app",
    name: "One app",
    title: "An app is a composition of plugins.",
    body: "Plugins are assembled together to form a coherent app. Implementing a new app only requires building its specific features on top of the shared infrastructure primitives.",
    p: 3,
  },
  {
    key: "customize",
    name: "Customize",
    title: "Apps are fully customizable.",
    body: "Add, remove or swap any plugin in the app. Everything else keeps working.",
    p: [3.5, 4.85],
  },
  {
    key: "system",
    name: "One system",
    title: "All applications form a unified system.",
    body: "Every app shares the same foundations while contributing to the system.",
    p: 6,
    tall: true,
  },
  {
    key: "standalone",
    name: "Standalone apps",
    title: "Each app can be shipped as standalone.",
    body: "A release is a selection of plugins. Select what one app needs and it ships on its own. Select fewer for a lighter variant.",
    p: [7, 9],
  },
  {
    key: "personal-os",
    name: "Your own system",
    title: "A personal operating system.",
    body: "equin itself is one more composition: the plugins of every app you want, assembled into one coherent surface. Add or remove any of them, and the system is yours alone.",
    p: 10,
  },
];

/** A chapter that plays a stretch of the timeline while its card holds. */
export const isSpan = (p: Chapter["p"]): p is readonly [number, number] =>
  typeof p !== "number";
