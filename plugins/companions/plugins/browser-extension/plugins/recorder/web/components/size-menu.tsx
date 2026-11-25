import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@plugins/primitives/plugins/css/plugins/ui-kit/web";
import { symbol } from "@plugins/ui/plugins/icons/core";
import { Icon } from "@plugins/ui/plugins/icons/web";
import {
  outputFor,
  presetFit,
  presetSizeText,
  RECORD_PRESETS,
  recordPreset,
  sizeRefusalText,
  type RecordPreset,
  type RecordPresetId,
  type SizeRefusal,
  type TabMeasure,
} from "@plugins/companions/plugins/browser-extension/core";

const landscapeIcon = symbol("crop-landscape");
const portraitIcon = symbol("crop-portrait");
const freeIcon = symbol("crop-free");
const moreIcon = symbol("expand-more");

function presetIcon(preset: RecordPreset) {
  return preset.page === null
    ? freeIcon
    : preset.page.height > preset.page.width
      ? portraitIcon
      : landscapeIcon;
}

/** The entry's second line: the preset's common name and the video it
 *  records on this display. */
function presetDetail(preset: RecordPreset, measure: TabMeasure): string {
  const out = outputFor(preset, measure);
  const video = out.ok ? `video ${out.value.width} × ${out.value.height}` : "";
  if (preset.page === null) return video || "Current window size";
  return video ? `${preset.label} · ${video}` : preset.label;
}

/** The tooltip of an entry: the page layout, the video it records here, and
 *  why it cannot record now. */
function presetTitle(preset: RecordPreset, measure: TabMeasure): string {
  const fit = presetFit(preset, measure);
  const why = fit.ok ? "" : ` — ${sizeRefusalText(fit.reason)}`;
  const out = outputFor(preset, measure);
  const video = out.ok
    ? `video ${out.value.width} × ${out.value.height} on this display`
    : "";
  if (preset.page === null)
    return `Keep the window as it is; ${video || "the video is the page’s own size"}${why}`;
  const shorts =
    preset.page.height > preset.page.width ? "Shorts / Reels: " : "";
  return `${shorts}page ${preset.page.width} × ${preset.page.height}${video ? `, ${video}` : ""}${why}`;
}

/** The short badge of an entry this tab cannot record now. */
function refusalBadge(reason: SizeRefusal): string {
  switch (reason) {
    case "does-not-fit":
      return "Too big";
    case "zoomed":
      return "Zoomed";
  }
}

/**
 * The size dropdown: each entry named by the page size it lays the tab out
 * at (1280 × 720, 1920 × 1080, 2560 × 1440, 540 × 960, As is), its common
 * name (720p…) and the video it records on this display beneath. An entry this tab cannot record now (too big
 * for this screen, a zoomed page) stays choosable, badged, so it can be
 * picked here and recorded once the window is on a bigger screen; Record and
 * Apply say why they are off.
 */
export function SizeMenu({
  value,
  measure,
  onChange,
}: {
  value: RecordPresetId;
  measure: TabMeasure;
  onChange: (id: RecordPresetId) => void;
}) {
  const current = recordPreset(value);
  const currentFit = presetFit(current, measure);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="rec-dd"
        title={presetTitle(current, measure)}
        data-refused={currentFit.ok ? undefined : ""}
      >
        <Icon icon={presetIcon(current)} />
        {presetSizeText(current)}
        <Icon icon={moreIcon} />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(v: string) => onChange(v as RecordPresetId)}
        >
          {RECORD_PRESETS.map((preset) => {
            const fit = presetFit(preset, measure);
            return (
              <DropdownMenuRadioItem
                key={preset.id}
                value={preset.id}
                title={presetTitle(preset, measure)}
              >
                <span className="rec-ddopt">
                  <Icon icon={presetIcon(preset)} />
                  <span className="rec-ddl">
                    <b>{presetSizeText(preset)}</b>
                    <i>{presetDetail(preset, measure)}</i>
                  </span>
                  {!fit.ok && (
                    <span className="rec-ddbadge">
                      {refusalBadge(fit.reason)}
                    </span>
                  )}
                </span>
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
