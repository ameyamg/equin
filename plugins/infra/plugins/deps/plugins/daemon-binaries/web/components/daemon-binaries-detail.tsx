import { ResourceView } from "@plugins/network/plugins/live/plugins/live-state/web";
import { useLive } from "@plugins/network/plugins/live/web";
import { CopyButton } from "@plugins/primitives/plugins/copy-to-clipboard/web";
import { Inline } from "@plugins/primitives/plugins/css/plugins/inline/web";
import { Stack } from "@plugins/primitives/plugins/css/plugins/spacing/web";
import { Text } from "@plugins/primitives/plugins/css/plugins/text/web";
import {
  daemonBinaries,
  installLabel,
  retryCommand,
  type DaemonDepRow,
} from "../../core";

// The Daemon binaries row's expanded detail: per daemon dependency, what the
// live daemon runs against what main declares, and — after a start fell back
// — why, with the command that retries it. Mounted only while the row is
// expanded.
//
// Not a DataView: the daemon dependencies are a closed handful (the database
// daemons' binaries), shown as a paragraph each, nothing to sort or filter.

function Command({ command }: { command: string }) {
  return (
    <Inline gap="2xs">
      <Text variant="caption" tone="strong" className="font-mono">
        {command}
      </Text>
      <CopyButton text={command} tooltip="Copy the command" aspect="inline" />
    </Inline>
  );
}

function DaemonDep({ row, mainRoot }: { row: DaemonDepRow; mainRoot: string }) {
  const running =
    row.running === null
      ? "not started yet"
      : `runs ${installLabel(row.running)}`;
  const d = row.declared;
  switch (d.kind) {
    case "same":
      return (
        <Text variant="caption" tone="muted">
          The daemon {running}, as main declares.
        </Text>
      );
    case "unreadable":
      return (
        <Text variant="caption" tone="muted">
          The daemon {running}. Couldn't read what main declares: {d.message}
        </Text>
      );
    case "differs": {
      const to = installLabel(d.install);
      if (d.failed === null) {
        return (
          <Text variant="caption" tone="muted">
            The daemon {running}; main declares {to}, which it runs from{" "}
            {row.appliesAt}.
          </Text>
        );
      }
      return (
        <Stack gap="2xs">
          <Text variant="caption" tone="destructive">
            {to} failed to start on {d.failed.at.slice(0, 16).replace("T", " ")}{" "}
            — the daemon {running}.
          </Text>
          <Text variant="caption" tone="muted" className="font-mono">
            {d.failed.error}
          </Text>
          <Text variant="caption" tone="muted">
            Once fixed, remove the failed install so the next start tries it
            again:
          </Text>
          <Command command={retryCommand(mainRoot, row.id)} />
        </Stack>
      );
    }
  }
}

export function DaemonBinariesDetail() {
  // The row's summary already says why when the value is not `checked`.
  return (
    <ResourceView resource={useLive(daemonBinaries)}>
      {(value) =>
        value.kind === "checked" ? (
          <Stack gap="sm">
            {value.rows.map((row) => (
              <Stack key={row.id} gap="2xs">
                <Text variant="label">{row.id}</Text>
                <DaemonDep row={row} mainRoot={value.mainRoot} />
              </Stack>
            ))}
          </Stack>
        ) : null
      }
    </ResourceView>
  );
}
