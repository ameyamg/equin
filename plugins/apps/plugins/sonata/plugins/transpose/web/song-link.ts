import {
  settingValue,
  transposeSetting,
  useSongDocument,
  useSongSetting,
} from "@plugins/apps/plugins/sonata/plugins/document/web";
import {
  Library,
  type SongLinkValue,
} from "@plugins/apps/plugins/sonata/plugins/library/web";
import { setTransposeEndpoint } from "../shared/endpoints";
import {
  decodeTransposeLink,
  encodeTransposeLink,
} from "../shared/transpose-link";

/**
 * The open song's transpose as its link spells it (`;transpose=`) — none in
 * its original key. Not known while the song or its offset is still loading
 * (or the read failed).
 */
function useTransposeLinkValue(): SongLinkValue {
  const contentReady = useSongDocument().content.kind === "ready";
  const transpose = useSongSetting(transposeSetting);
  if (!contentReady || transpose.kind !== "settled") return { known: false };
  return { known: true, value: encodeTransposeLink(transpose.value) };
}

/**
 * The transpose's part of a song's link: the semitone shift — played by the
 * link's preview, and written as the song's once it is added. A value that is
 * not an offset in range is skipped (the song plays in its original key).
 */
export const transposeSongLink = Library.SongLink({
  key: "transpose",
  useValue: useTransposeLinkValue,
  previewSetting: (value) => {
    const semitones = decodeTransposeLink(value);
    return semitones === null
      ? null
      : settingValue(transposeSetting, semitones);
  },
  apply: async ({ fetchEndpoint }, { id, value }) => {
    const semitones = decodeTransposeLink(value);
    if (semitones === null) return;
    await fetchEndpoint(setTransposeEndpoint, { id }, { body: { semitones } });
  },
});
