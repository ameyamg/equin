/**
 * The part of Chrome's extension API the shell uses, typed here (the repo
 * carries no `@types/chrome`): each entrypoint (popup, service worker,
 * offscreen document, content script, permissions page) reads the one global
 * through {@link chrome}. An offscreen document and a content script have only
 * `runtime`; the rest is the popup's and the worker's.
 */

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
    sendMessage(id: number, message: unknown): Promise<unknown>;
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
    sendMessage(message: unknown): Promise<unknown>;
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
 * claim are left to other listeners.
 */
export function onMessageAsync(
  accepts: (message: unknown) => boolean,
  handle: (message: unknown, sender: MessageSender) => Promise<unknown>,
): void {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!accepts(message)) return undefined;
    handle(message, sender).then(sendResponse, (err: unknown) =>
      sendResponse({ ok: false, error: errorText(err) }),
    );
    return true;
  });
}

export function errorText(err: unknown): string {
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
