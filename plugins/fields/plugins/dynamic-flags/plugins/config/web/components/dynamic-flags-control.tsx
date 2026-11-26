import { Cluster } from "@plugins/primitives/plugins/css/plugins/cluster/web";
import { ToggleChip } from "@plugins/primitives/plugins/css/plugins/toggle-chip/web";
import type { Hook } from "@plugins/framework/plugins/hook-value/core";
import { flagValue } from "../../core";
import { DynamicFlags, type DynamicFlagOption } from "../internal/slots";

type Flags = Readonly<Record<string, boolean>>;
type ChipLook = "ghost" | "tinted";

/**
 * The options-resolving control, handed to the panel as ONE element.
 *
 * A component rather than part of the field's `useShape` for the same reason
 * as dynamic-enum's control: the options come from a contributed HOOK, and
 * whether a contribution matches is only known at render — calling it from
 * `useShape` would be a conditional hook call the moment a contribution
 * appears under a mounted field. Two component TYPES make that a remount.
 *
 * The consequence is that the switches are drawn here, as the chip cluster the
 * panel itself draws for a many-option multi-select (`FieldShapeView`'s
 * `choice select="many"` past its row threshold) — the same control, so a
 * dynamic set of toggles reads exactly like a static one.
 */
export function DynamicFlagsControl({
  field,
  value,
  onChange,
  chip,
}: {
  field: unknown;
  value: Flags;
  onChange: (value: Record<string, boolean>) => void;
  /** The chips' look: the host's (tinted in a form, ghost in a menu). */
  chip: ChipLook;
}) {
  const contributions = DynamicFlags.Options.useContributions();
  const match = contributions.find((c) => c.field === field);
  if (!match)
    return <UnresolvedFlags value={value} onChange={onChange} chip={chip} />;
  return (
    <ResolvedFlags
      useOptions={match.useOptions}
      value={value}
      onChange={onChange}
      chip={chip}
    />
  );
}

function ResolvedFlags({
  useOptions,
  value,
  onChange,
  chip,
}: {
  useOptions: Hook<() => readonly DynamicFlagOption[]>;
  value: Flags;
  onChange: (value: Record<string, boolean>) => void;
  chip: ChipLook;
}) {
  const options = useOptions();
  return (
    <FlagChips
      flags={options.map((opt) => ({
        key: opt.value,
        label: opt.label,
        on: flagValue(value, opt.value, opt.defaultOn),
      }))}
      value={value}
      onChange={onChange}
      chip={chip}
    />
  );
}

/**
 * No host contributed the option set (its plugin is not loaded): the switches
 * the user did set are still shown — and editable — under their raw keys, so
 * the stored value is never hidden.
 */
function UnresolvedFlags({
  value,
  onChange,
  chip,
}: {
  value: Flags;
  onChange: (value: Record<string, boolean>) => void;
  chip: ChipLook;
}) {
  return (
    <FlagChips
      flags={Object.entries(value).map(([key, on]) => ({
        key,
        label: key,
        on,
      }))}
      value={value}
      onChange={onChange}
      chip={chip}
    />
  );
}

function FlagChips({
  flags,
  value,
  onChange,
  chip,
}: {
  flags: readonly { key: string; label: string; on: boolean }[];
  value: Flags;
  onChange: (value: Record<string, boolean>) => void;
  chip: ChipLook;
}) {
  return (
    <Cluster gap="2xs">
      {flags.map((flag) => (
        <ToggleChip
          key={flag.key}
          variant={chip}
          active={flag.on}
          // Writes the key explicitly, so a toggled option keeps its state
          // even if its default later changes.
          onClick={() => onChange({ ...value, [flag.key]: !flag.on })}
        >
          {flag.label}
        </ToggleChip>
      ))}
    </Cluster>
  );
}
