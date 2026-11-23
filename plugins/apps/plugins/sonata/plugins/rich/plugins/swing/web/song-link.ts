import {
  settingValue,
  swingSetting,
  useSongDocument,
  useSongSetting,
} from "@plugins/apps/plugins/sonata/plugins/document/web";
import {
  Library,
  type SongLinkValue,
} from "@plugins/apps/plugins/sonata/plugins/library/web";
import { setSwingEndpoint } from "../shared/endpoints";
import { decodeSwingLink, encodeSwingLink } from "../shared/swing-link";

/**
 * The open song's swing as its link spells it (`;swing=`) — none while it
 * plays its content's own feel. Not known while the song or its swing is
 * still loading (or the read failed).
 */
function useSwingLinkValue(): SongLinkValue {
  const contentReady = useSongDocument().content.kind === "ready";
  const swing = useSongSetting(swingSetting);
  if (!contentReady || swing.kind !== "settled") return { known: false };
  return { known: true, value: encodeSwingLink(swing.value) };
}

/**
 * The swing's part of a song's link: the feel chosen over the song's own —
 * played by the link's preview, and written as the song's once it is added.
 * A value that is not a swing is skipped (the song keeps its own feel).
 */
export const swingSongLink = Library.SongLink({
  key: "swing",
  useValue: useSwingLinkValue,
  previewSetting: (value) => {
    const override = decodeSwingLink(value);
    return override === null ? null : settingValue(swingSetting, override);
  },
  apply: async ({ fetchEndpoint }, { id, value }) => {
    const override = decodeSwingLink(value);
    if (override === null) return;
    await fetchEndpoint(setSwingEndpoint, { id }, { body: override });
  },
});
