import { liveCollection } from "@plugins/network/plugins/live/core";
import { compositeKey } from "@plugins/network/plugins/live/plugins/query-resource/core";
import { islePlotEntityRef } from "./schemas";

/**
 * Every plot of one world (`world` = the seed, as text), in the order they were
 * made: a scoped whole set (`all: { by: ["world"] }`), because the pure world
 * needs ALL of them to place, lay out and walk — a window would move buildings
 * past its edge. Bounded by construction: the archipelago is finite (18
 * islands of at most 5 districts, each holding a few dozen plots at most), so
 * `max` is a checked cap, not a hope — a load past it is a loud error.
 * Writes reach it through the change feed (the table is ordinary).
 */
export const islePlots = liveCollection("isle.plots", {
  from: islePlotEntityRef,
  carry: {
    pick: [
      "world",
      "plotId",
      "slot",
      "n",
      "seq",
      "group",
      "region",
      "geometry",
      "occupant",
      "movedByUser",
      "wild",
      "retired",
    ],
  },
  id: compositeKey(["world", "plotId"]),
  all: {
    by: ["world"],
    orderBy: [["seq", "asc"]],
    max: 2000,
  },
});

/**
 * The generation of the buildings' footprints. A plot is cut for the building
 * that first stood on it and kept forever, so when the bespoke buildings are
 * redrawn at other sizes the stored plots no longer fit them: a new generation
 * lays every town out afresh (the old plots stay under their old scope).
 * 6: districts became one category group each (the `group` / `region` columns).
 * 7: back to kin-leaning placement — the one-group districts spread too thin.
 * 9: one dense district per region (top-level category), home island first.
 */
const LAYOUT_GENERATION = 9;

/** The `world` scope of a seed: one set of plots per seed and layout generation. */
export const worldOfSeed = (seed: number): string =>
  `${seed}/${LAYOUT_GENERATION}`;
