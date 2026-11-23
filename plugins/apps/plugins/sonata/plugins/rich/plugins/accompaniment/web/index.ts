import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";
import { Sonata } from "@plugins/apps/plugins/sonata/plugins/shell/web";
import { symbol } from "@plugins/ui/plugins/icons/core";
import {
  AccompanimentActions,
  AccompanimentSection,
  useAccompanimentAvailable,
} from "./components/accompaniment-section";

export default {
  description:
    "Sonata Section: Accompaniment — the song's chords played through its groove (RhythmControls in the body). A chord-only song (chord grid, chord sheet) always plays it; a song with notes of its own (MIDI, MusicXML, a transcription) turns it on and off with the chord-mode switch (ChordModeSwitch) in the header. Available whenever the song's chords are voiced (a shared link previewed included, its groove edited in memory until added), and for a library song when chord mode can be offered.",
  contributions: [
    Sonata.Section({
      id: "accompaniment",
      label: "Accompaniment",
      icon: symbol("graphic-eq"),
      area: "player",
      component: AccompanimentSection,
      actions: AccompanimentActions,
      useAvailable: useAccompanimentAvailable,
    }),
  ],
} satisfies PluginDefinition;
