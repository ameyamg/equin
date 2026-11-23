import { expect, test } from "bun:test";
import { asPluginId } from "@plugins/framework/plugins/plugin-id/core";
import { appRoots, partialAppEntries } from "./apps-whole";

const declarers = [
  "apps.settings.shell",
  "apps.isle.shell",
  "companions.menu-bar",
  "companions.browser-extension",
].map(asPluginId);

test("an app is the largest subtree holding its declarer and no other app's", () => {
  expect(appRoots(declarers)).toEqual(
    [
      "apps.settings",
      "apps.isle",
      "companions.menu-bar",
      "companions.browser-extension",
    ].map(asPluginId),
  );
});

const roots = appRoots(declarers);

test("a whole app, and plugins outside every app, pass", () => {
  expect(
    partialAppEntries(["apps.isle.**", "tasks.**", "ui.tokens.x"], roots),
  ).toEqual([]);
});

test("an app less negatives on some panes passes", () => {
  expect(
    partialAppEntries(
      ["apps.settings.**", "!apps.settings.appearance.**"],
      roots,
    ),
  ).toEqual([]);
});

test("hand-picked plugins of an app fail, naming the app", () => {
  expect(
    partialAppEntries(
      ["apps.settings.shell", "apps.settings.config", "apps.isle"],
      roots,
    ),
  ).toEqual([
    { entry: "apps.settings.shell", app: asPluginId("apps.settings") },
    { entry: "apps.settings.config", app: asPluginId("apps.settings") },
    { entry: "apps.isle", app: asPluginId("apps.isle") },
  ]);
});

test("a leaf kept under one of the row's own negatives passes", () => {
  expect(
    partialAppEntries(
      ["apps.isle.**", "!apps.isle.dev.**", "apps.isle.dev.capability"],
      roots,
    ),
  ).toEqual([]);
});
