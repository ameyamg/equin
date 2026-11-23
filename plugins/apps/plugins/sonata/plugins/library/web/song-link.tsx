import { type ReactNode, useCallback, useEffect, useState } from "react";
import { rowOrStale, useLiveReader } from "@plugins/network/plugins/live/web";
import { useFetchEndpoint } from "@plugins/infra/plugins/endpoints/web";
import { useOpenDialog } from "@plugins/primitives/plugins/overlay/plugins/imperative-dialog/web";
import { IconButton } from "@plugins/primitives/plugins/icon-button/web";
import { browserTabUrl } from "@plugins/primitives/plugins/link-gesture/web";
import { useToast } from "@plugins/shell/plugins/notifications/web";
import { symbol } from "@plugins/ui/plugins/icons/core";
import { sonataApp } from "@plugins/apps/plugins/sonata/plugins/shell/core";
import { Button } from "@plugins/primitives/plugins/css/plugins/ui-kit/web";
import { Icon } from "@plugins/ui/plugins/icons/web";
import type {
  FileIdentity,
  SettingValue,
} from "@plugins/apps/plugins/sonata/plugins/document/web";
import {
  fromLinkText,
  SONG_LINK_KEYS,
  sonataPlayerRoute,
  type SongId,
  type SongLinkKey,
  songIdKind,
  toLinkText,
} from "../core";
import { Library, type LinkPreviewResult, type SongLinkValue } from "./slots";
import { useCurrentSong } from "./use-current-song";
import { useOpenSong } from "./open-song";

/** The player route's params, as the pane hands them over. */
export interface PlayerParams {
  songId: string;
  bar?: string;
  lens?: string;
  title?: string;
  grid?: string;
  ug?: string;
  groove?: string;
}

type SongLinkPart = ReturnType<
  typeof Library.SongLink.useContributions
>[number];

/** The song link's own keys (the shareable content) with their values. */
type LinkParams = Partial<Record<SongLinkKey | "title", string>>;

/** A link's title when it carries none. */
const UNTITLED = "Shared song";

const shareIcon = symbol("share");
const addIcon = symbol("add");

/** Whether `params` carry any of the song link's own keys (a share link). */
export function carriesSongLink(params: PlayerParams): boolean {
  return (
    params.title !== undefined ||
    SONG_LINK_KEYS.some((key) => params[key] !== undefined)
  );
}

/**
 * The params with the song link's own keys dropped — `bar` and `lens` (views
 * of the song) kept: the plain address of the song a share link opened.
 */
export function withoutLink(params: PlayerParams): PlayerParams {
  return {
    songId: params.songId,
    ...(params.bar !== undefined && { bar: params.bar }),
    ...(params.lens !== undefined && { lens: params.lens }),
  };
}

/**
 * Every `Library.SongLink` part's value for the loaded song, as its own hook
 * reads it: `readers` must be rendered (each part reads through its own hook,
 * so each is one {@link LinkPartReader} element reporting its value up — a
 * contributed set cannot be looped over with hooks), and `link` is the link
 * the song spells now — `null` while a part is not known yet.
 */
function useCurrentLink(): {
  readers: ReactNode;
  link: CurrentLink | null;
} {
  const parts = Library.SongLink.useContributions();
  const [values, setValues] = useState<
    Partial<Record<SongLinkKey, SongLinkValue>>
  >({});
  const report = useCallback((key: SongLinkKey, value: SongLinkValue) => {
    setValues((prev) => {
      const old = prev[key];
      if (
        old !== undefined &&
        old.known === value.known &&
        (!old.known || !value.known || old.value === value.value)
      ) {
        return prev;
      }
      return { ...prev, [key]: value };
    });
  }, []);

  let link: CurrentLink | null = { params: {}, creator: null };
  for (const part of parts) {
    const value = values[part.key];
    if (value === undefined || !value.known) {
      link = null;
      break;
    }
    if (value.value === null) continue;
    link.params[part.key] = value.value;
    if (link.creator === null && isCreator(part)) {
      link.creator = { part, value: value.value };
    }
  }

  const readers = parts.map((part) => (
    <LinkPartReader key={part.key} part={part} report={report} />
  ));
  return { readers, link };
}

/** The link the loaded song spells now (see {@link useCurrentLink}). */
interface CurrentLink {
  /** Every part's value, by key — a part at its default carries none. */
  params: LinkParams;
  /** The first part that can recreate the song elsewhere, with its value. */
  creator: LinkCreator | null;
}

function isCreator(part: SongLinkPart): part is CreatorPart {
  return part.create !== undefined && part.usePreview !== undefined;
}

/**
 * The open song's Share button: copies a link that recreates the song on
 * another library — every `Library.SongLink` part's value (`;grid`, `;ug`,
 * `;groove`, …) and the song's title — and says so with a toast. Shown only
 * for a song a link can recreate (a `create` part has a value: a chord grid,
 * an Ultimate Guitar tab), and only once every part knows its value, so a
 * link never leaves out a part still loading. The address bar itself stays
 * the song's plain address.
 */
export function ShareSongButton(): ReactNode {
  const toast = useToast();
  const { readers, link: current } = useCurrentLink();
  const song = rowOrStale(useCurrentSong());

  // The link the song spells now, or null while a part (or the song) is not
  // known yet, or when no part can recreate the song elsewhere.
  const link =
    current === null ||
    current.creator === null ||
    song === undefined ||
    song === null
      ? null
      : current.params;

  const copy = async () => {
    if (link === null || song === undefined || song === null) return;
    const path = sonataPlayerRoute.link(sonataApp, {
      songId: song.id,
      title: toLinkText(song.title),
      ...link,
    });
    // The address that shows the song where the user is: inside an embed
    // (the website's live demo) its host page at that place, not the app's
    // own path on this origin.
    const url = browserTabUrl(path);
    await navigator.clipboard.writeText(url);
    toast({
      type: "sonata-song-link-copied",
      variant: "success",
      title: "Link copied",
      description: `Opening it restores “${song.title}” as it is now.`,
      category: "confirmations",
    });
  };

  return (
    <>
      {readers}
      {link !== null && (
        <IconButton
          icon={shareIcon}
          label="Copy a link to this song"
          onClick={copy}
        />
      )}
    </>
  );
}

function LinkPartReader({
  part,
  report,
}: {
  part: SongLinkPart;
  report: (key: SongLinkKey, value: SongLinkValue) => void;
}): null {
  const value = part.useValue();
  const known = value.known;
  const text = value.known ? value.value : null;
  useEffect(() => {
    report(part.key, known ? { known: true, value: text } : { known: false });
  }, [part.key, known, text, report]);
  return null;
}

/** A creating link part: one whose song a link can preview and add. */
type CreatorPart = SongLinkPart & {
  usePreview: NonNullable<SongLinkPart["usePreview"]>;
  create: NonNullable<SongLinkPart["create"]>;
};

/** The link's creating part, with the value the link carries for it. */
export interface LinkCreator {
  part: CreatorPart;
  value: string;
}

/**
 * The part of a link that can bring its song into being (a `create` part
 * whose key the link carries), with its value — or `null` when the link
 * names no song this library could create.
 */
export function useLinkCreator(params: PlayerParams): LinkCreator | null {
  const parts = Library.SongLink.useContributions();
  for (const part of parts) {
    const value = params[part.key];
    if (isCreator(part) && value !== undefined) return { part, value };
  }
  return null;
}

/** The title a link carries for its song, readable (`Shared song` for none). */
export function linkTitle(params: PlayerParams): string {
  return params.title === undefined ? UNTITLED : fromLinkText(params.title);
}

/**
 * The document a link to a song this library does not have is previewed as:
 * a file document (nothing of it persisted, no setting writable), keyed by the
 * link's song id and named by its title.
 */
export function linkPreviewIdentity(
  songId: SongId,
  params: PlayerParams,
): FileIdentity {
  return { kind: "file", key: `song-link:${songId}`, name: linkTitle(params) };
}

/**
 * What a link carries beside its song, as the preview plays it: every other
 * part's setting (`previewSetting` — the groove), so the song sounds as it
 * will once added. A value a part cannot read is skipped.
 */
export function useLinkPreviewSettings(
  params: PlayerParams,
  creator: LinkCreator,
): SettingValue[] {
  const parts = Library.SongLink.useContributions();
  const values: SettingValue[] = [];
  for (const part of parts) {
    const value = params[part.key];
    if (part === creator.part || value === undefined) continue;
    const setting = part.previewSetting?.(value);
    if (setting !== undefined && setting !== null) values.push(setting);
  }
  return values;
}

/**
 * The song a link carries, as its creating part reads it (an Ultimate Guitar
 * tab is fetched): one hook, so it is its own element — keyed by the part by
 * whoever renders it, since another link's creator is another hook.
 */
export function LinkPreviewReader({
  creator,
  children,
}: {
  creator: LinkCreator;
  children: (preview: LinkPreviewResult) => ReactNode;
}): ReactNode {
  return children(creator.part.usePreview(creator.value));
}

/**
 * "Add to library", beside a previewed link's title: creates the song under
 * the link's id from the creating part, then hands every other part its
 * value. What it keeps is the preview AS IT IS NOW — every part's value read
 * from the loaded document, like the Share button's (the grid edited, the
 * groove changed in the Accompaniment section), not the link's original
 * values. A link id that is not a song id gets a fresh one. Asked, never done on open, so a link only ever writes to the
 * library because its reader chose to keep it. Once the song exists, the
 * player opens it like any other. A failure (UG refusing the tab) is said in
 * a toast.
 */
export function AddToLibraryButton({
  songId,
  params,
}: {
  songId: SongId;
  params: PlayerParams;
}): ReactNode {
  const parts = Library.SongLink.useContributions();
  const { readers, link } = useCurrentLink();
  const fetchEndpoint = useFetchEndpoint();
  const readLive = useLiveReader();
  const openDialog = useOpenDialog();
  const openSong = useOpenSong();
  const toast = useToast();
  const title = linkTitle(params);

  if (link !== null && link.creator === null) {
    throw new Error(
      "AddToLibraryButton: the previewed song spells no part that can create it",
    );
  }

  const add = async () => {
    if (link === null || link.creator === null) return;
    const creator = link.creator;
    const ctx = { fetchEndpoint, readLive, openDialog, openSong };
    // A link's id is typed or pasted: one that is not a song id (a
    // hand-written `song-demo-01`) cannot be stored, so the song is made
    // under a fresh id and opened there instead.
    const id = songIdKind.is(songId) ? songId : songIdKind.mint();
    try {
      await creator.part.create(ctx, { id, title, value: creator.value });
      for (const part of parts) {
        const value = link.params[part.key];
        if (part === creator.part || value === undefined) continue;
        await part.apply?.(ctx, { id, value });
      }
      if (id !== songId) openSong({ id, title });
    } catch (err) {
      if (!(err instanceof Error)) throw err;
      toast({
        type: "sonata-song-link-add-failed",
        variant: "error",
        title: "Could not add the song",
        description: err.message,
        category: "other",
      });
    }
  };

  return (
    <>
      {readers}
      <Button onClick={add} disabled={link === null}>
        <Icon icon={addIcon} />
        Add to library
      </Button>
    </>
  );
}
