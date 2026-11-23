import type { ReactElement } from "react";
import { useConfigResult } from "@plugins/config_v2/web";
import { ConfigGearButton } from "@plugins/config_v2/plugins/config-link/web";
import { ResourceErrorInline } from "@plugins/network/plugins/live/plugins/live-state/web";
import { Badge } from "@plugins/primitives/plugins/css/plugins/badge/web";
import { Inline } from "@plugins/primitives/plugins/css/plugins/inline/web";
import { StatusDot } from "@plugins/primitives/plugins/css/plugins/status-dot/web";
import { Loading } from "@plugins/primitives/plugins/loading/web";
import { testRunnerConfig } from "../../core";

const RULE =
  "Main's test runner runs, after each push, the test files that push changed (at low priority), confirms a failure with one more run, and files a test-failing report per broken file. It never re-runs unchanged code, runs on main only, and is off unless turned on.";

/** Whether main's test runner is turned on, with the gear to its setting. */
export function RunnerPill(): ReactElement {
  const config = useConfigResult(testRunnerConfig);
  if (config.status === "loading")
    return <Loading label="Reading the test runner's setting…" />;
  if (config.status === "error")
    return (
      <ResourceErrorInline
        variant="inline"
        subject="the test runner's setting"
        error={config.error}
        refetch={config.refetch}
      />
    );
  const on = config.data.enabled;
  return (
    <Inline gap="xs">
      <Badge
        shape="pill"
        variant={on ? "success" : "muted"}
        icon={
          <StatusDot colorClass={on ? "bg-success" : "bg-muted-foreground"} />
        }
        tooltip={RULE}
      >
        {on
          ? "Test runner on · runs what each push changes"
          : "Test runner off"}
      </Badge>
      <ConfigGearButton
        descriptor={testRunnerConfig}
        label="Test runner settings"
      />
    </Inline>
  );
}
