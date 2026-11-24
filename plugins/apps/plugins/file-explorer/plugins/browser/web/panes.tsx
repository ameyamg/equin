import { HOME } from "@plugins/infra/plugins/host-account/core";
import { useCallback, useEffect, useMemo, type ReactNode } from "react";
import {
  Pane,
  PaneChrome,
  defineRoute,
  impliedBy,
  paneColumn,
  relativeTo,
  useOpenPane,
  usePaneStore,
  PaneMessage,
  type AnyPane,
  type PaneExpandTarget,
  type RelativeSpelling,
} from "@plugins/primitives/plugins/pane/web";
import {
  type Activation,
  type LinkTarget,
} from "@plugins/primitives/plugins/link-gesture/core";
import { fileExplorerApp } from "@plugins/apps/plugins/file-explorer/plugins/shell/core";
import { useConfigResult } from "@plugins/config_v2/web";
import { Loading } from "@plugins/primitives/plugins/loading/web";
import { Placeholder } from "@plugins/primitives/plugins/css/plugins/placeholder/web";
import {
  ResourceErrorInline,
  foldResource,
} from "@plugins/network/plugins/live/plugins/live-state/web";
import {
  isBrowsableFileSystem,
  type BrowsableFileSystem,
} from "@plugins/infra/plugins/paths/plugins/file-systems/core";
import {
  baseName,
  filesConfig,
  isWithin,
  joinPath,
  parentPath,
  type ExplorerLocation,
} from "../core";
import { FileBrowserBody } from "./components/file-browser";
import {
  FileBrowserPath,
  FileBrowserProvider,
  PendingFileBrowserProvider,
} from "./components/file-browser-header";
import {
  FilePreviewPane,
  FilePreviewTitle,
  PendingFilePreviewPane,
} from "./components/file-preview";
import { FileBrowserHeader, FilePreviewHeader } from "./slots";
import { useRoutedHistory, type ExplorerNavigator } from "./internal/navigator";
import { useHomeSystem } from "./internal/explorer-system";

// Files is a Miller row: a folder column, and the file open in it as a
// column of its own beside it —
//
//   /files/browse/<folder>[;fs=<system>][/preview/<open file>[;fs=<system>]]
//
// The folder and the open file are each ONE encoded segment (`~%2FProjects`,
// `README.md`); `;fs` names the file system — absent, the computer's disk.
// Each column carries its WHOLE address: the preview's `path` is the file's
// full path, and it reads nothing from the folder column, so it works in any
// column order (a reordered Miller row), beside another folder, and on its
// own. Only its URL spelling leans on position — an implied param (`pane`
// CLAUDE.md): a file inside the folder column to its LEFT is written
// relative to it (`/files/browse/~%2Fp/preview/README.md`), anywhere else in
// full (`/files/preview/~%2Fp%2FREADME.md`). Every location is therefore a
// link, and back / forward are the browser history:
//
// - another folder is a new entry moving the folder column IN PLACE (an
//   `inPlace` swap of the folder and its open file): the column, its header
//   and the preview beside it stay mounted — only the listing (keyed by its
//   folder) starts over, and the filter is the new folder's;
// - opening a file pushes the preview column beside the folder's (replacing
//   the one open there), as any app opens a pane — closing it closes that
//   column. The folder column is never remounted, so the listing keeps its
//   scroll and expansion, and the preview slides in and out with the row's
//   column motion.

// Not `at/…`: `at` spells an embed's place on the page URL (the embed tail,
// `pane` CLAUDE.md), and the Demo's former `at/:url*` pane carried any
// `/files/at/…` loaded cold off to the Demo. The id is the one this pane had
// at `/files/at/…`, so a saved route still restores.
const folderRoute = defineRoute({ id: "files-at", segment: "browse/:dir;fs" });

/** `/files/browse/<folder>[;fs=<system>]` — any folder of a browsable file system. */
export const filesFolderPane = Pane.define({
  route: folderRoute,
  app: fileExplorerApp,
  // The header is the shared browser header (back / forward / up, the path
  // bar as the title, the filter, the toggles).
  title: { useText: useFolderTitle, component: FileBrowserPath },
  actions: FileBrowserHeader,
  useResolve: false,
  component: FilesFolder,
});

/** A path as Files spells it is whole from the root: `/…`, `~`, `~/…`. */
function isWholePath(written: string): boolean {
  return written.startsWith("/") || written === "~" || written.startsWith("~/");
}

/**
 * A file's path relative to a folder: the part after `<folder>/` when the
 * file is below it — never empty, never a spelling that reads as whole (a
 * folder named `~` below the base would) — else none.
 */
const pathBelowFolder: RelativeSpelling = {
  within: (path, dir) => {
    if (path === dir || !isWithin(path, dir)) return undefined;
    const relative = path.slice(dir === "/" ? 1 : dir.length + 1);
    return isWholePath(relative) ? undefined : relative;
  },
  join: joinPath,
  isWhole: isWholePath,
};

/**
 * `…/preview/<file>[;fs=<system>]` — a file, previewed beside the folder it
 * was opened from. Its address is its own (the full path, the system), so it
 * shows the same file wherever its column stands; the path is only WRITTEN
 * relative to the folder column to its left when the file is in it.
 *
 * `;fs` stays explicit: implied from the folder's, an absent `fs` (the
 * computer's disk) beside a folder of another system would have no spelling.
 */
export const filesPreviewPane = Pane.define({
  route: defineRoute({
    // Not "files-preview": that id held a path RELATIVE to the folder (`:open`)
    // and no `path`. A saved route naming it is validated on restore and
    // re-read from its URL — which today's relative spelling parses.
    id: "files-preview-path",
    segment: "preview/:path;fs",
  }),
  implied: { path: impliedBy(folderRoute, relativeTo("dir", pathBelowFolder)) },
  app: fileExplorerApp,
  // The header is the shared preview header (the file's title, then its
  // renderer tabs and Open with default app).
  title: { useText: usePreviewTitle, component: FilePreviewTitle },
  actions: FilePreviewHeader,
  // Promoted, the preview stands alone — the file full width, its address its
  // own. A renderer with a fuller view of its own adds that Expand too
  // (FilePreviewPane).
  useResolve: false,
  component: FilesPreview,
});

/**
 * `/files` — the app's index pane: Files opens on the home folder of the file
 * system this host serves first (the computer's disk on the desktop, the
 * browser's storage in the in-browser demo), forwarded to that folder's own
 * address once the system is known — REPLACING the history entry, so Back
 * skips the bare root that only forwarded.
 */
export const filesHomePane = Pane.define({
  route: defineRoute({ id: "files-home", segment: "" }),
  app: fileExplorerApp,
  appIndex: true,
  title: "Home",
  component: FilesHome,
});

function useFolderTitle(params: { dir: string }): string {
  return params.dir === HOME ? "Home" : baseName(params.dir);
}

function usePreviewTitle(params: { path: string }): string {
  return baseName(params.path);
}

/** The folder pane's params: the folder, and its system unless the computer's disk. */
interface FolderParams {
  dir: string;
  fs?: string;
}

function folderParams(fs: BrowsableFileSystem, dir: string): FolderParams {
  return fs === "computer" ? { dir } : { dir, fs };
}

/** The file system `;fs` names: none is the computer's disk. */
function systemOf(fs: string | undefined): BrowsableFileSystem | null {
  if (fs === undefined) return "computer";
  return isBrowsableFileSystem(fs) ? fs : null;
}

type OpenPaneFn = ReturnType<typeof useOpenPane>;

/** The preview pane's params: the file, and its system unless the computer's disk. */
function previewParams(
  fs: BrowsableFileSystem,
  path: string,
): { path: string; fs?: string } {
  return fs === "computer" ? { path } : { path, fs };
}

/**
 * Files on `location`, as columns: its folder, with the open file's preview
 * beside it when there is one. `root` — the route is those columns; `swap` —
 * they replace the caller's column and every one right of it (the folder
 * column moving, the columns left of it staying). `inPlace` — a move within
 * Files on screen — keeps the columns already standing there mounted, only
 * their address changing (the same file previewed is not reloaded).
 */
function locationTarget(
  openPane: OpenPaneFn,
  location: ExplorerLocation,
  opts: { mode: "root" | "swap"; replace?: boolean; inPlace?: boolean },
): LinkTarget {
  const folder = paneColumn(
    filesFolderPane,
    folderParams(location.fs, location.dir),
  );
  return openPane.columns(
    location.open === null
      ? [folder]
      : [
          folder,
          paneColumn(
            filesPreviewPane,
            previewParams(location.fs, location.open),
          ),
        ],
    opts,
  );
}

/**
 * `preview-file/<file>[;fs=<system>]` — a file previewed in a column of its
 * own beside the browser that opened it, for a browser hosted inside some
 * other pane (the conversation's Files pane, a folder peek). Like Files' own
 * preview (`filesPreviewPane`) it names its whole place itself — the file in
 * display form (`~/…`), `;fs` absent for the computer's disk — so it reads
 * nothing from the column to its left and serves any host; unlike it, its
 * path is always written whole (no Files folder column stands to its left).
 *
 * Its home is Files, but it opens BESIDE the browser holding the file, so
 * Expand ("Open in Files") is the move that leaves the host — unless the
 * file's renderer has a fuller view of its own (Open in Sonata), which wins.
 */
export const filePreviewBesidePane = Pane.define({
  route: defineRoute({
    id: "files-preview-beside",
    segment: "preview-file/:path;fs",
  }),
  app: fileExplorerApp,
  title: {
    useText: usePreviewBesideTitle,
    component: FilePreviewTitle,
  },
  actions: FilePreviewHeader,
  useResolve: false,
  // Opened from an app's bare root, it stays beside that home rather than
  // replacing it (like the folder peek it is opened from).
  companion: true,
  expand: { app: fileExplorerApp, useTarget: usePreviewBesideExpand },
  component: FilePreviewBeside,
});

function usePreviewBesideTitle(params: { path: string }): string {
  return baseName(params.path);
}

function usePreviewBesideExpand(params: {
  path: string;
  fs?: string;
}): PaneExpandTarget {
  const fs = systemOf(params.fs);
  const dir = params.path === HOME ? null : parentPath(params.path, HOME);
  const target = useOpenInFiles({
    fs: fs ?? "computer",
    dir: dir ?? "/",
    open: params.path,
  });
  return fs === null || dir === null
    ? { kind: "none" }
    : { kind: "ready", target };
}

function FilePreviewBeside(): ReactNode {
  const { path, fs: fsParam } = filePreviewBesidePane.useParams();
  const fs = systemOf(fsParam);
  if (fs === null) {
    return (
      <PendingFilePreviewPane
        pane={filePreviewBesidePane}
        name={baseName(path)}
      >
        <Placeholder>No file system is called “{fsParam}”</Placeholder>
      </PendingFilePreviewPane>
    );
  }
  return <FilePreviewPane pane={filePreviewBesidePane} fs={fs} path={path} />;
}

/**
 * Opening and closing the file previewed in the column beside a browser: open
 * is `openTarget` (a push — appending the column, or replacing the one open
 * there, so the row's swap motion plays), close closes the column `opened`
 * names on this surface's store (an embedded surface is not the live one) —
 * as a link, the folder on its own (`here`).
 */
function useColumnFileTo(
  openTarget: (open: string) => LinkTarget,
  opened: { pane: AnyPane; instanceId: number } | null,
  here: () => LinkTarget,
): (open: string | null) => Activation {
  const store = usePaneStore();
  return useCallback(
    (open: string | null): Activation => {
      if (open !== null) return openTarget(open);
      return {
        open: (gesture) => {
          if (opened !== null) {
            store.close(opened.pane._internal, opened.instanceId, gesture);
          }
        },
        href: () => here().href(),
      };
    },
    [openTarget, opened, here, store],
  );
}

/**
 * The navigator of a browser hosted inside some pane, its open file
 * previewed in the column beside it (`filePreviewBesidePane`): the folder
 * comes from the host (`dir`, moved through `go` — a new history entry, a
 * fresh route or a swapped slot, the host's call), the open file from the
 * preview column this pane opened. Every move is a link, and stays in `fs`.
 */
export function useBesidePreviewNavigator(
  fs: BrowsableFileSystem,
  dir: string,
  go: (next: ExplorerLocation) => LinkTarget,
): ExplorerNavigator {
  const entry = filePreviewBesidePane.useOpenedHere();
  // Only a preview of this file system counts as this browser's open file.
  const opened =
    entry !== null && systemOf(entry.params.fs) === fs ? entry : null;
  const openPath = opened?.params.path ?? null;
  const location = useMemo(
    () => ({ fs, dir, open: openPath }),
    [fs, dir, openPath],
  );
  const openPane = useOpenPane();
  const openTarget = useCallback(
    (open: string) =>
      openPane.to(filePreviewBesidePane, previewParams(fs, open), {
        mode: "push",
      }),
    [openPane, fs],
  );
  const openedId = opened?.instanceId;
  const openedRef = useMemo(
    () =>
      openedId === undefined
        ? null
        : { pane: filePreviewBesidePane, instanceId: openedId },
    [openedId],
  );
  const here = useCallback(() => go({ fs, dir, open: null }), [go, fs, dir]);
  const fileTo = useColumnFileTo(openTarget, openedRef, here);
  return useRoutedNavigator(location, go, fileTo);
}

/**
 * The navigator every routed explorer shares: folder moves through `go`,
 * file moves through `fileTo`, back / forward the browser history.
 */
function useRoutedNavigator(
  location: ExplorerLocation,
  go: (next: ExplorerLocation) => LinkTarget,
  fileTo: (open: string | null) => Activation,
): ExplorerNavigator {
  const { canBack, canForward } = useRoutedHistory(location);
  return useMemo(
    () => ({
      location,
      to: (dir, open = null) => go({ fs: location.fs, dir, open }),
      fileTo,
      // Back / forward are the browser history, whichever pane holds the
      // location (any pane's back() walks the same history).
      back: () => filesFolderPane.back(),
      forward: () => filesFolderPane.forward(),
      canBack,
      canForward,
    }),
    [location, go, fileTo, canBack, canForward],
  );
}

/**
 * The Files app on `location`, as a link — the way out of an explorer hosted
 * elsewhere (a pane's "Open in Files"). From another app it hands the route
 * to Files; ⌘/middle-click opens it in a new browser tab.
 */
export function useOpenInFiles(location: ExplorerLocation): LinkTarget {
  const openPane = useOpenPane();
  return locationTarget(openPane, location, { mode: "root" });
}

function FilesHome(): ReactNode {
  const home = useHomeSystem();
  switch (home.kind) {
    case "pending":
      return <Loading variant="rows" />;
    case "failed":
      return (
        <ResourceErrorInline
          variant="block"
          subject="the file systems here"
          error={home.error}
          refetch={home.refetch}
        />
      );
    case "none":
      return (
        <PaneChrome pane={filesHomePane}>
          <PaneMessage>
            <Placeholder>There are no files to browse here</Placeholder>
          </PaneMessage>
        </PaneChrome>
      );
    case "ready":
      return <FilesHomeForward fs={home.fs} />;
  }
}

/**
 * Home: the configured start folder (`filesConfig`'s `startFolder`, `~`
 * unless set), in the home system — forwarded to that folder's own address.
 */
function FilesHomeForward({ fs }: { fs: BrowsableFileSystem }): ReactNode {
  const config = useConfigResult(filesConfig);
  return foldResource(config, {
    loading: () => <Loading variant="rows" />,
    error: (error) => (
      <ResourceErrorInline
        variant="block"
        subject="the Files start folder"
        error={error}
        refetch={config.refetch}
      />
    ),
    ready: ({ startFolder }) => (
      <FilesStartForward fs={fs} startFolder={startFolder} />
    ),
  });
}

function FilesStartForward({
  fs,
  startFolder,
}: {
  fs: BrowsableFileSystem;
  startFolder: string;
}): ReactNode {
  const openPane = useOpenPane();
  useEffect(() => {
    openPane(filesFolderPane, folderParams(fs, startFolder), {
      mode: "root",
      replace: true,
    });
  }, [openPane, fs, startFolder]);
  return <Loading variant="rows" />;
}

function FilesFolder(): ReactNode {
  const { dir, fs: fsParam } = filesFolderPane.useParams();
  const fs = systemOf(fsParam);
  if (fs === null) {
    return (
      <PendingFileBrowserProvider>
        <PaneChrome pane={filesFolderPane}>
          <PaneMessage>
            <Placeholder>No file system is called “{fsParam}”</Placeholder>
          </PaneMessage>
        </PaneChrome>
      </PendingFileBrowserProvider>
    );
  }
  return <FilesFolderBrowser fs={fs} dir={dir} />;
}

/**
 * The folder column: the listing, with the file opened from it previewed in
 * the column beside it (`filesPreviewPane`). Opening a file pushes that
 * column — replacing the one open, so the row's swap motion plays — and
 * closing it closes that column; this one stays mounted throughout.
 */
function FilesFolderBrowser({
  fs,
  dir,
}: {
  fs: BrowsableFileSystem;
  dir: string;
}): ReactNode {
  // The file this column opened: the preview right of it, of this system.
  const entry = filesPreviewPane.useOpenedHere();
  const opened =
    entry !== null && systemOf(entry.params.fs) === fs ? entry : null;
  const openPath = opened?.params.path ?? null;
  const location = useMemo(
    () => ({ fs, dir, open: openPath }),
    [fs, dir, openPath],
  );
  const openPane = useOpenPane();
  // Another folder moves this column in place: its header and the preview
  // beside it stay mounted (the same file previewed is not reloaded); only the
  // listing, keyed by its folder, starts over. A swap of THIS column and those
  // right of it: the columns left of it (another folder, its preview) stay.
  const go = useCallback(
    (next: ExplorerLocation) =>
      locationTarget(openPane, next, { inPlace: true, mode: "swap" }),
    [openPane],
  );
  // A file opens as any app opens a pane: pushed right of this column
  // (replacing what stood there; ⌥ keeps it), carrying its whole path.
  const openTarget = useCallback(
    (open: string) =>
      openPane.to(filesPreviewPane, previewParams(fs, open), {
        mode: "push",
      }),
    [openPane, fs],
  );
  const openedId = opened?.instanceId;
  const openedRef = useMemo(
    () =>
      openedId === undefined
        ? null
        : { pane: filesPreviewPane, instanceId: openedId },
    [openedId],
  );
  const here = useCallback(() => go({ fs, dir, open: null }), [go, fs, dir]);
  const fileTo = useColumnFileTo(openTarget, openedRef, here);
  const navigator = useRoutedNavigator(location, go, fileTo);
  // The provider and the chrome stay mounted while the preview beside this
  // column opens, closes or changes file: only the navigator's value moves.
  return (
    <FileBrowserProvider navigator={navigator} preview="pane">
      <PaneChrome pane={filesFolderPane}>
        <FileBrowserBody />
      </PaneChrome>
    </FileBrowserProvider>
  );
}

function FilesPreview(): ReactNode {
  // Its whole address is its own: whichever column stands beside it (its
  // folder, another one, none) has no say in what it shows.
  const { path, fs: fsParam } = filesPreviewPane.useParams();
  const fs = systemOf(fsParam);
  if (fs === null) {
    return (
      <PendingFilePreviewPane pane={filesPreviewPane} name={baseName(path)}>
        <Placeholder>No file system is called “{fsParam}”</Placeholder>
      </PendingFilePreviewPane>
    );
  }
  return <FilePreviewPane pane={filesPreviewPane} fs={fs} path={path} />;
}

/**
 * The location the routed explorer on this surface is showing — for chrome
 * beside it (the Places sidebar marks the folder it is in). `null` while the
 * surface shows no folder (the index, forwarding to home).
 */
export function useExplorerLocation(): ExplorerLocation | null {
  const folder = filesFolderPane.useRouteEntry();
  const preview = filesPreviewPane.useRouteEntry();
  if (folder === null) return null;
  const fs = systemOf(folder.params.fs);
  if (fs === null) return null;
  return {
    fs,
    dir: folder.params.dir,
    open:
      preview !== null && systemOf(preview.params.fs) === fs
        ? preview.params.path
        : null,
  };
}

/**
 * The routed explorer on `dir` of `fs` — with `open` previewed beside it,
 * when given — as a link (a new history entry; ⌘/middle-click opens it in a
 * new browser tab). Moves the folder column on screen in place, as the
 * browser's own moves do.
 */
export function useExplorerFolderTarget(): (
  fs: BrowsableFileSystem,
  dir: string,
  open?: string,
) => LinkTarget {
  const openPane = useOpenPane();
  return (fs, dir, open) =>
    locationTarget(
      openPane,
      { fs, dir, open: open ?? null },
      { mode: "root", inPlace: true },
    );
}
