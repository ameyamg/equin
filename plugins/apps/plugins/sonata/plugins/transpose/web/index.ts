import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";
import {
  SonataDocument,
  transposeSetting,
} from "@plugins/apps/plugins/sonata/plugins/document/web";
import { sonataPlayerPane } from "@plugins/apps/plugins/sonata/plugins/library/web";
import { TransposeObserver } from "./components/transpose-observer";
import { TransposeControl } from "./components/transpose-control";
import { transposeSongLink } from "./song-link";

export { saveTranspose } from "./actions";

export default {
  description:
    "Per-song global transpose offset: persists a semitone shift, registers it with the song document's score pipeline as a per-song setting (SonataDocument.SongSetting) settled by a headless observer, and exposes a toolbar transpose popover (stepper, key line, Play-in grid). Library.SongLink `transpose`: the offset in a song's share link, previewed and applied on Add to library; a previewed link's offset is edited in memory.",
  contributions: [
    SonataDocument.SongSetting({
      id: "transpose-sync",
      setting: transposeSetting,
      component: TransposeObserver,
    }),
    sonataPlayerPane.Actions({ id: "transpose", component: TransposeControl }),
    transposeSongLink,
  ],
} satisfies PluginDefinition;
