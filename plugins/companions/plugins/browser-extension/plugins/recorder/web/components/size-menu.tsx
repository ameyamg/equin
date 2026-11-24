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
  presetFit,
  RECORD_PRESETS,
  recordPreset,
  sizeRefusalText,
  type RecordPreset,
  type RecordPresetId,
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

/** The entry's second line: its video size, what As is keeps, or why not. */
function presetDetail(preset: RecordPreset, measure: TabMeasure): string {
  const fit = presetFit(preset, measure);
  if (!fit.ok) return sizeRefusalText(fit.reason);
  return preset.video === null
    ? "Current window size"
    : `${preset.video.width} × ${preset.video.height}`;
}

/** The tooltip of an entry: the page layout it records and the video. */
function presetTitle(preset: RecordPreset): string {
  if (preset.page === null || preset.video === null)
    return "Keep the window as it is; the video is the page’s own size";
  const shorts =
    preset.page.height > preset.page.width ? "Shorts / Reels: " : "";
  return `${shorts}page ${preset.page.width} × ${preset.page.height}, video ${preset.video.width} × ${preset.video.height}`;
}

/**
 * The size dropdown: 720p, 1080p, 1440p, 9:16 and As is — each with its
 * video size, an entry this tab cannot record disabled with the reason
 * (doesn't fit the screen, needs a Retina display, a zoomed page).
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
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="rec-dd" title={presetTitle(current)}>
        <Icon icon={presetIcon(current)} />
        {current.label}
        <Icon icon={moreIcon} />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(v: string) => onChange(v as RecordPresetId)}
        >
          {RECORD_PRESETS.map((preset) => (
            <DropdownMenuRadioItem
              key={preset.id}
              value={preset.id}
              disabled={!presetFit(preset, measure).ok}
              title={presetTitle(preset)}
            >
              <span className="rec-ddopt">
                <Icon icon={presetIcon(preset)} />
                <span className="rec-ddl">
                  <b>{preset.label}</b>
                  <i>{presetDetail(preset, measure)}</i>
                </span>
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
