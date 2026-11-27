import { describe, expect, test } from "bun:test";
import type { AppRef } from "@plugins/primitives/plugins/pane/core";
import { agentManagerApp } from "@plugins/apps/plugins/agent-manager/plugins/shell/core";
import { browserApp } from "@plugins/apps/plugins/browser/plugins/shell/core";
import { chordApp } from "@plugins/apps/plugins/chord/plugins/shell/core";
import { deployApp } from "@plugins/apps/plugins/deploy/plugins/shell/core";
import { desktopApp } from "@plugins/apps/plugins/desktop/plugins/shell/core";
import { eventsApp } from "@plugins/apps/plugins/events/plugins/shell/core";
import { fileExplorerApp } from "@plugins/apps/plugins/file-explorer/plugins/shell/core";
import { isleApp } from "@plugins/apps/plugins/isle/plugins/shell/core";
import { keyboardPartyApp } from "@plugins/apps/plugins/keyboard-party/plugins/shell/core";
import { mailApp } from "@plugins/apps/plugins/mail/plugins/shell/core";
import { pagesApp } from "@plugins/apps/plugins/pages/plugins/shell/core";
import { placesApp } from "@plugins/apps/plugins/places/plugins/shell/core";
import { prototypesApp } from "@plugins/apps/plugins/prototypes/plugins/shell/core";
import { sonataApp } from "@plugins/apps/plugins/sonata/plugins/shell/core";
import { studioApp } from "@plugins/apps/plugins/plugin-studio/plugins/shell/core";
import { workspaceDemo } from "@plugins/apps/plugins/website/plugins/demos/plugins/workspace/core";
import { APPS } from "./catalog";
import { APP_DEMO_PLACES } from "./demo-places";

// The catalog copies each app's glyph as text (importing an app's shell would
// pull it into the website's composition — a test may). The site draws an
// app's icon the way the app draws it only while the copies agree.
/**
 * Each definition's shell plugin, by app id: an app the demo's composition
 * carries has its shell among the demo's plugins.
 */
const SHELL_PLUGIN: Readonly<Record<string, string>> = {
  "agent-manager": "apps.agent-manager.shell",
  browser: "apps.browser.shell",
  chord: "apps.chord.shell",
  deploy: "apps.deploy.shell",
  desktop: "apps.desktop.shell",
  events: "apps.events.shell",
  "file-explorer": "apps.file-explorer.shell",
  isle: "apps.isle.shell",
  "keyboard-party": "apps.keyboard-party.shell",
  mail: "apps.mail.shell",
  pages: "apps.pages.shell",
  places: "apps.places.shell",
  prototypes: "apps.prototypes.shell",
  sonata: "apps.sonata.shell",
  studio: "apps.plugin-studio.shell",
};

/**
 * Apps whose shell the demo holds without the app being there to try, so
 * their card does not open the demo.
 */
const SHELL_ONLY_IN_DEMO: Readonly<Record<string, string>> = {
  studio:
    "only the shell reaches the demo's closure; none of Studio's panes do",
};

const DEFINITIONS: readonly AppRef[] = [
  agentManagerApp,
  browserApp,
  chordApp,
  deployApp,
  desktopApp,
  eventsApp,
  fileExplorerApp,
  isleApp,
  keyboardPartyApp,
  mailApp,
  pagesApp,
  placesApp,
  prototypesApp,
  sonataApp,
  studioApp,
];

describe("the apps catalog", () => {
  test("each app's glyph is its definition's", () => {
    const byId = new Map(DEFINITIONS.map((app) => [app.id, app]));
    for (const app of APPS) {
      if (app.appId === null) continue;
      const def = byId.get(app.appId);
      expect(def, `no definition imported for "${app.appId}"`).toBeDefined();
      expect([app.appId, app.icon.name]).toEqual([app.appId, def!.icon.name]);
    }
  });

  test("no two apps share a colour", () => {
    const colors = APPS.map((app) => app.color);
    expect(colors.filter((c, i) => colors.indexOf(c) !== i)).toEqual([]);
  });

  // Compensates for: the gallery's demo places are written by hand (the site
  // must not bundle the demo's composition), so an app added to the demo
  // stayed a plain card — Tap Tap Party (task-1795747806-d959sz).
  test("an app the demo carries opens it, and only such an app", () => {
    const demoPlugins = new Set(workspaceDemo.host.plugins);
    const inDemo: string[] = [];
    for (const app of APPS) {
      if (app.appId === null || SHELL_ONLY_IN_DEMO[app.id] !== undefined)
        continue;
      const shell = SHELL_PLUGIN[app.appId];
      expect(shell, `no shell plugin named for "${app.appId}"`).toBeDefined();
      if (demoPlugins.has(shell!)) inDemo.push(app.id);
    }
    expect(Object.keys(APP_DEMO_PLACES).sort()).toEqual(inDemo.sort());
  });

  test("each demo place's home is its app's base path", () => {
    const byId = new Map(DEFINITIONS.map((app) => [app.id, app]));
    for (const [id, place] of Object.entries(APP_DEMO_PLACES)) {
      const entry = APPS.find((app) => app.id === id);
      expect(entry?.appId, `no catalog app "${id}"`).toBeTruthy();
      const def = byId.get(entry!.appId!);
      expect([id, place.home]).toEqual([id, def!.basePath]);
      expect(
        place.shot.startsWith(place.home),
        `${id}'s shot is under its home`,
      ).toBe(true);
    }
  });
});
