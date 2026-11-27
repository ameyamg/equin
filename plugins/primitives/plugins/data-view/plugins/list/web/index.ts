import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";
import { boolField } from "@plugins/fields/plugins/bool/plugins/config/core";
import { DataViewSlots } from "@plugins/primitives/plugins/data-view/web";
import { LIST_SLOTS, ListView } from "./components/list-view";
import { symbol } from "@plugins/ui/plugins/icons/core";

export type {
  ListDetailControls,
  ListStep,
  ListStepper,
  ListStepResult,
  ListViewOptions,
} from "../core";
export { defineListStepper, useListStepper } from "./components/list-stepper";

export default {
  description:
    "List view child for the data-view primitive: a compact single-row-per-item list (Row primitive) with field-driven label/subtitle/trailing, active-row highlight, and hover item actions. j / k step the rows (`stepKeys`); with a stepper (`defineListStepper`) the step is published to the rest of the surface (`useListStepper`) — a reader pane's Done opening the next item.",
  contributions: [
    DataViewSlots.View({
      type: "list",
      companion: true,
      title: "List",
      icon: symbol("view-list"),
      loadingVariant: "rows",
      component: ListView,
      slots: LIST_SLOTS,
      // Opts into flat manual-order (rank-based drag reorder); active only when
      // the consumer supplies `manualOrder`.
      supportsManualOrder: true,
      // Draws the rows a source attaches beneath others (`attach`) under them.
      nestsAttach: true,
      // Per view instance, from its settings: a caption row over the list —
      // the title field's label, and each trailing field's over its slot.
      configSchema: {
        columnCaptions: boolField({
          label: "Column captions",
          description:
            "Show a caption row over the list: the title field's label, and each trailing field's label over its column.",
        }),
      },
    }),
  ],
} satisfies PluginDefinition;
