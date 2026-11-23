import type {
  DataTableColumnMenu,
  DataTableProps,
} from "@plugins/primitives/plugins/data-table/web";
import type { DataViewRenderProps } from "@plugins/primitives/plugins/data-view/web";
import type { TableViewOptions } from "../../core";

/** The title column's default width: the narrowest it gets before the table
 *  scrolls sideways (it takes the spare room past it). */
export const TITLE_COLUMN_WIDTH = "minmax(280px, 1fr)";

/**
 * The view's column layout as `DataTable` props, read from and written to the
 * view instance's stored options: each column's width (`columnWidths`, a
 * drag or Fit to content merges one in), the frozen columns (every column up
 * to `frozenUpTo`, by its place among the columns drawn) and the column menu
 * (sort, freeze, hide) over the view's own writers. The flat and the nested
 * table share it.
 */
export function columnLayout(
  options: Pick<TableViewOptions, "columnWidths" | "frozenUpTo">,
  columnIds: readonly string[],
  writers: Pick<
    DataViewRenderProps<unknown>,
    "updateViewOptions" | "setSortDirection" | "hideField"
  >,
): Pick<
  DataTableProps<unknown>,
  "columnWidths" | "onColumnResize" | "frozenColumns" | "columnMenu"
> {
  const { updateViewOptions, setSortDirection, hideField } = writers;
  const columnWidths = options.columnWidths;
  const frozenAt =
    options.frozenUpTo === undefined
      ? -1
      : columnIds.indexOf(options.frozenUpTo);
  const columnMenu: DataTableColumnMenu = {
    onSort: setSortDirection,
    onFreeze: (columnId) =>
      updateViewOptions({ frozenUpTo: columnId ?? undefined }),
    onHide: hideField,
  };
  return {
    columnWidths,
    onColumnResize: (columnId, px) =>
      updateViewOptions({
        columnWidths: { ...columnWidths, [columnId]: px },
      }),
    frozenColumns: frozenAt + 1,
    columnMenu,
  };
}
