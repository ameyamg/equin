/**
 * The part of Chrome's extension API the shell uses, typed here (the repo
 * carries no `@types/chrome`): each entrypoint (popup, service worker,
 * offscreen document, content script, permissions page) reads the one global
 * through {@link chrome}. An offscreen document and a content script have only
 * `runtime`; the rest is the popup's and the worker's.
 */
import { z } from "zod";

export interface ChromeTab {
  id?: number;
  windowId: number;
  url?: string;
  title?: string;
  active: boolean;
  lastAccessed?: number;
}

export interface ChromeWindow {
  id?: number;
  left?: number;
  top?: number;
  width?: number;
  height?: number;
  state?:
    "normal" | "minimized" | "maximized" | "fullscreen" | "locked-fullscreen";
}

export interface ChromeEvent<F extends (...args: never[]) => unknown> {
  addListener(listener: F): void;
  removeListener(listener: F): void;
}

export interface MessageSender {
  tab?: ChromeTab;
  url?: string;
  id?: string;
}

export interface StorageArea {
  get(keys: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

export interface StorageChange {
  oldValue?: unknown;
  newValue?: unknown;
}

/**
 * The APIs a manifest permission gates. Optional, because the popup's files
 * are read from disk on every open but the manifest only when Chrome
 * (re)loads the extension: a popup can run under an older manifest that did
 * not ask for them, and then they are `undefined`. Reach them through
 * {@link permitted}, never as `chrome.<api>`.
 */
export type GatedApi =
  "storage" | "scripting" | "tabCapture" | "offscreen" | "commands";

export interface ChromeApi {
  tabs: {
    getCurrent(): Promise<ChromeTab | undefined>;
    get(id: number): Promise<ChromeTab>;
    query(q: {
      lastFocusedWindow?: boolean;
      active?: boolean;
    }): Promise<ChromeTab[]>;
    update(id: number, props: { url: string }): Promise<unknown>;
    create(props: { url: string; active?: boolean }): Promise<ChromeTab>;
    getZoom(id: number): Promise<number>;
    onRemoved: ChromeEvent<(tabId: number) => void>;
    onUpdated: ChromeEvent<
      (tabId: number, change: { status?: string; url?: string }) => void
    >;
  };
  windows: {
    get(id: number): Promise<ChromeWindow>;
    update(
      id: number,
      props: {
        left?: number;
        top?: number;
        width?: number;
        height?: number;
        state?: ChromeWindow["state"];
      },
    ): Promise<ChromeWindow>;
    onBoundsChanged: ChromeEvent<(window: ChromeWindow) => void>;
  };
  scripting?: {
    executeScript<A extends unknown[], R>(injection: {
      target: { tabId: number };
      func?: (...args: A) => R | Promise<R>;
      args?: A;
      files?: string[];
    }): Promise<{ result?: Awaited<R> }[]>;
  };
  tabCapture?: {
    getMediaStreamId(opts: { targetTabId: number }): Promise<string>;
  };
  offscreen?: {
    createDocument(opts: {
      url: string;
      reasons: string[];
      justification: string;
    }): Promise<void>;
    closeDocument(): Promise<void>;
    hasDocument?(): Promise<boolean>;
  };
  action: {
    setBadgeText(opts: { text: string }): Promise<void>;
    setBadgeBackgroundColor(opts: { color: string }): Promise<void>;
    setBadgeTextColor?(opts: { color: string }): Promise<void>;
    setTitle(opts: { title: string }): Promise<void>;
  };
  commands?: {
    onCommand: ChromeEvent<(command: string, tab?: ChromeTab) => void>;
  };
  storage?: {
    session: StorageArea;
    local: StorageArea;
    onChanged: ChromeEvent<
      (changes: Record<string, StorageChange>, area: string) => void
    >;
  };
  runtime: {
    reload(): void;
    getManifest(): { version_name?: string };
    getURL(path: string): string;
    getContexts?(filter: { contextTypes: string[] }): Promise<unknown[]>;
    onMessage: ChromeEvent<
      (
        message: unknown,
        sender: MessageSender,
        sendResponse: (response: unknown) => void,
      ) => boolean | undefined
    >;
  };
}

export const chrome = (globalThis as unknown as { chrome: ChromeApi }).chrome;

// ── One shell, one build ────────────────────────────────────────────────────

/** Written by the build into every script (a Bun `define`): the digest of the
 *  whole shell, which is also the manifest's `version_name`. */
declare const __SHELL_BUILD__: string;

/**
 * The build this script is from. Chrome loads the shell's parts at different
 * times — the manifest and the service worker when the extension (re)loads,
 * the popup, the offscreen document and the content script from disk each
 * time they open — so after a build, parts of two builds can run side by side
 * until Chrome reloads the extension. (2026-11-25: a worker from the build
 * before sent the new offscreen recorder a stop without the field it now
 * required; the recording failed with a raw parse error.)
 */
export const SHELL_BUILD = __SHELL_BUILD__;

/** Whether Chrome runs this script's build: the loaded manifest names it. */
export function runsThisBuild(): boolean {
  return chrome.runtime.getManifest().version_name === SHELL_BUILD;
}

/** What a part answers a message from another build. */
export const OTHER_BUILD_TEXT =
  "The extension was updated while it ran, and its parts are from two builds: open the equin popover again to reload it, then record again.";

/** The key every message between the shell's parts carries its build under. */
const BUILD_KEY = "equinShellBuild";

/** Chrome's messaging, kept out of {@link ChromeApi} on purpose: every send
 *  goes through {@link sendToExtension} / {@link sendToTab}, which stamp the
 *  build, so an unstamped send has no spelling. */
interface RawMessaging {
  runtime: { sendMessage(message: unknown): Promise<unknown> };
  tabs: { sendMessage(tabId: number, message: unknown): Promise<unknown> };
}
const raw = chrome as unknown as RawMessaging;

/** A message to the extension's other contexts (worker, offscreen document,
 *  popup), stamped with this build. */
export function sendToExtension(message: { type: string }): Promise<unknown> {
  return raw.runtime.sendMessage({ ...message, [BUILD_KEY]: SHELL_BUILD });
}

/** A message to a tab's content script, stamped with this build. */
export function sendToTab(
  tabId: number,
  message: { type: string },
): Promise<unknown> {
  return raw.tabs.sendMessage(tabId, { ...message, [BUILD_KEY]: SHELL_BUILD });
}

/** The build a message was sent from (`null`: a build from before stamps). */
export function messageBuild(message: unknown): string | null {
  if (typeof message !== "object" || message === null) return null;
  const build = (message as Record<string, unknown>)[BUILD_KEY];
  return typeof build === "string" ? build : null;
}

/** The message as its schema reads it: without the build stamp. */
export function unstamped(message: unknown): unknown {
  if (typeof message !== "object" || message === null) return message;
  const { [BUILD_KEY]: _build, ...rest } = message as Record<string, unknown>;
  return rest;
}

/** Whether the loaded manifest grants every one of `apis`. */
export function hasApis(...apis: GatedApi[]): boolean {
  return apis.every((api) => chrome[api] !== undefined);
}

/**
 * A permission-gated API, or a throw naming the permission the loaded
 * manifest lacks (an extension Chrome has not reloaded since the build).
 */
export function permitted<A extends GatedApi>(
  api: A,
): NonNullable<ChromeApi[A]> {
  const value = chrome[api];
  if (value === undefined)
    throw new Error(
      `The extension runs without the "${api}" permission: reload it (chrome://extensions).`,
    );
  return value as NonNullable<ChromeApi[A]>;
}

/**
 * Serve `runtime.onMessage` with an async handler: the answer is sent when it
 * settles (a throw answers `{ ok: false, error }`), messages `accepts` does not
 * claim are left to other listeners. A claimed message from another build of
 * the shell is refused as such ({@link OTHER_BUILD_TEXT}) before its schema
 * reads it: the two builds' contracts may differ, and the user must hear
 * "reload", not a parse error. The handler gets the message unstamped.
 */
export function onMessageAsync(
  accepts: (message: unknown) => boolean,
  handle: (message: unknown, sender: MessageSender) => Promise<unknown>,
): void {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!accepts(message)) return undefined;
    if (messageBuild(message) !== SHELL_BUILD) {
      sendResponse({ ok: false, error: OTHER_BUILD_TEXT });
      return undefined;
    }
    handle(unstamped(message), sender).then(sendResponse, (err: unknown) =>
      sendResponse({ ok: false, error: errorText(err) }),
    );
    return true;
  });
}

/**
 * An error in words, for the panel. A schema that refused a message names
 * what it could not read, never as zod's raw issue list.
 */
export function errorText(err: unknown): string {
  if (err instanceof z.ZodError)
    return `The extension could not read a message between its parts (${err.issues
      .map(
        (issue) =>
          `${issue.path.length === 0 ? "the message" : issue.path.join(".")}: ${issue.message}`,
      )
      .join("; ")}). Reload it from chrome://extensions if this persists.`;
  return err instanceof Error ? err.message : String(err);
}

/** A message's `type`, if it has one. */
export function messageType(message: unknown): string | null {
  return typeof message === "object" &&
    message !== null &&
    "type" in message &&
    typeof (message as { type: unknown }).type === "string"
    ? (message as { type: string }).type
    : null;
}
