import type { FieldDef } from "@plugins/primitives/plugins/data-view/web";
import { Text } from "@plugins/primitives/plugins/css/plugins/text/web";
import { mediaFieldDef } from "@plugins/fields/plugins/media/plugins/table/web";
import {
  MediaRefSchema,
  mediaFieldType,
} from "@plugins/fields/plugins/media/core";
import type { SiteFeedDecl } from "@plugins/apps/plugins/deploy/plugins/site-feeds/core";
import type { SiteFeedItemRow } from "../../core";
import { SiteFeedEditor } from "../slots";
import { ItemPublicationChips } from "../components/destinations";

/** A text value's first line, for a one-line cell. */
function firstLine(value: unknown): string {
  return typeof value === "string" ? (value.split(/\r?\n/, 1)[0] ?? "") : "";
}

/**
 * The list's columns derived from the feed's own fields: each media field as
 * the media cell (its first file and how many more), each field holding text
 * as its first line — the first one the row's title. A field of any other
 * shape is edited in the form but has no column (no generic one-line cell).
 * Display only: the values are one jsonb, so nothing sorts or filters by them.
 *
 * `withElsewhere`: a trailing column drawing `SiteFeedEditor.ItemStatus` —
 * where else the item went (its contributors' chips), only when one exists.
 */
export function feedItemFields(
  feed: SiteFeedDecl,
  { withElsewhere }: { withElsewhere: boolean },
): FieldDef<SiteFeedItemRow>[] {
  const fields: FieldDef<SiteFeedItemRow>[] = [];
  let titled = false;
  for (const [key, field] of Object.entries(feed.fields)) {
    const id = `values.${key}`;
    const label = field.meta.label ?? key;
    if (field.type.id === mediaFieldType.id) {
      fields.push(
        mediaFieldDef<SiteFeedItemRow>({
          id,
          label,
          media: (row) => MediaRefSchema.array().parse(row.values[key] ?? []),
        }),
      );
      continue;
    }
    // A defaultless field throws on `defaultValue`; it holds no text either way here.
    if (field.defaultless === true || typeof field.defaultValue !== "string")
      continue;
    const primary = !titled;
    titled = true;
    fields.push({
      id,
      label,
      type: "text",
      value: (row) => firstLine(row.values[key]),
      cell: (row) => {
        const text = firstLine(row.values[key]);
        return text === "" ? (
          <Text tone="faint">{primary ? "Untitled" : ""}</Text>
        ) : (
          <Text>{text}</Text>
        );
      },
      primary,
      sortable: false,
      filterable: false,
      width: primary ? "minmax(0,1fr)" : "minmax(0,16rem)",
    });
  }
  // Where the item is: a chip per copy of the site holding (or getting) it.
  fields.push({
    id: "publishedTo",
    label: "Published to",
    type: "text",
    value: () => "",
    cell: (row) => <ItemPublicationChips item={row} />,
    sortable: false,
    filterable: false,
    width: "minmax(0,14rem)",
  });
  if (withElsewhere) {
    fields.push({
      id: "elsewhere",
      label: "Elsewhere",
      type: "text",
      value: () => "",
      cell: (row) => (
        <SiteFeedEditor.ItemStatus.Render>
          {(part) => <part.component item={row} feed={feed} />}
        </SiteFeedEditor.ItemStatus.Render>
      ),
      sortable: false,
      filterable: false,
      width: "minmax(0,12rem)",
    });
  }
  return fields;
}
