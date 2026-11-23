import { useState, type ReactElement, type ReactNode } from "react";
import {
  Button,
  ControlSizeProvider,
} from "@plugins/primitives/plugins/css/plugins/ui-kit/web";
import { subThemeScope } from "@plugins/primitives/plugins/css/plugins/ui-kit/core";
import { Theme } from "@plugins/primitives/plugins/css/plugins/theme-boundary/web";
import { Line } from "@plugins/primitives/plugins/css/plugins/line/web";
import { Stack } from "@plugins/primitives/plugins/css/plugins/spacing/web";
import { Text } from "@plugins/primitives/plugins/css/plugins/text/web";
import { InlinePopover } from "@plugins/primitives/plugins/overlay/plugins/popover/web";
import { Loading } from "@plugins/primitives/plugins/loading/web";
import { ActionFormShield } from "@plugins/primitives/plugins/action-presentation/web";
import { matchResource } from "@plugins/network/plugins/live/plugins/live-state/web";
import { useLive } from "@plugins/network/plugins/live/web";
import {
  prototypeHistory,
  type PrototypeMeta,
} from "@plugins/apps/plugins/prototypes/plugins/files/core";
import { prototypesIcons } from "@plugins/apps/plugins/prototypes/plugins/icons/core";
import { symbol } from "@plugins/ui/plugins/icons/core";
import { Icon } from "@plugins/ui/plugins/icons/web";
import type { FrameId, SourceFrame } from "../internal/canvas-model";
import { versionForStep, versionSteps } from "../internal/version-steps";
import { frameChipsTheme } from "../internal/sub-themes";
import { FrameSource, type FrameResolution } from "../slots";
import { usePrototypeDetail } from "../context";
import { VersionList } from "./version-list";

const appIcon = prototypesIcons.icon("app");
const checkIcon = symbol("check");
const chevronDownIcon = symbol("keyboard-arrow-down");

/**
 * The rows of a frame's "what this frame shows" popover that are NOT the
 * prototype: one per frame source that resolves here ("Real app"), turning
 * frame `frameId` into it in place. A source that does not resolve (no
 * counterpart declared, or none found) has no row — there is nothing to show.
 * A source shown in another frame is disabled (one frame per source); the one
 * this frame shows is checked.
 */
export function SourceChoices({
  frameId,
  meta,
  close,
}: {
  frameId: FrameId;
  meta: PrototypeMeta;
  close: () => void;
}): ReactElement {
  const { canvas, sources, dispatch } = usePrototypeDetail();
  return (
    <>
      {sources.map((source) => {
        const shownBy = canvas.frames.find(
          (f) => f.kind === "source" && f.source === source.id,
        );
        return (
          <FrameSource.Dispatch key={source.id} source={source.id} meta={meta}>
            {(resolution: FrameResolution) => {
              if (resolution.status !== "found") return null;
              const here = shownBy?.id === frameId;
              const elsewhere = shownBy !== undefined && !here;
              return (
                <Button
                  variant="ghost"
                  disabled={shownBy !== undefined}
                  tooltip={
                    elsewhere
                      ? `${source.addLabel} is already on the canvas`
                      : resolution.tag
                  }
                  onClick={() => {
                    close();
                    dispatch({
                      type: "showSource",
                      id: frameId,
                      source: source.id,
                    });
                  }}
                >
                  <Icon icon={appIcon} />
                  {source.addLabel}
                  <Text variant="caption" tone="muted">
                    {resolution.tag}
                  </Text>
                  {here ? <Icon icon={checkIcon} /> : null}
                </Button>
              );
            }}
          </FrameSource.Dispatch>
        );
      })}
    </>
  );
}

/**
 * A source frame's name as a picker: its app glyph and name ("Real app") open
 * the same choices a prototype frame's version list holds — any version of the
 * prototype (the frame turns back into a prototype frame showing it, in
 * place) or another source.
 */
export function SourceShows({
  frame,
  meta,
  name,
  detail,
}: {
  frame: SourceFrame;
  meta: PrototypeMeta;
  name: string;
  /** What the source resolved to, as the tooltip. */
  detail: string | null;
}): ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <ActionFormShield>
      <Theme name={subThemeScope(frameChipsTheme)} surface="none" as={Line}>
        <ControlSizeProvider size="sm">
          <InlinePopover
            open={open}
            onOpenChange={setOpen}
            side="bottom"
            align="center"
            width="described"
            resetOnClose
            tooltip={detail ?? undefined}
            trigger={
              <Button variant="ghost" className="text-muted-foreground">
                <Icon icon={appIcon} className="size-3.25" />
                <Text variant="group">{name}</Text>
                <Icon
                  icon={chevronDownIcon}
                  className="size-2.75 text-faint-foreground"
                />
              </Button>
            }
          >
            <Stack gap="2xs">
              <SourceVersionList
                frameId={frame.id}
                name={meta.name}
                close={() => setOpen(false)}
              />
              <SourceChoices
                frameId={frame.id}
                meta={meta}
                close={() => setOpen(false)}
              />
            </Stack>
          </InlinePopover>
        </ControlSizeProvider>
      </Theme>
    </ActionFormShield>
  );
}

/** The prototype's versions; picking one shows it in this frame instead. */
function SourceVersionList({
  frameId,
  name,
  close,
}: {
  frameId: FrameId;
  name: string;
  close: () => void;
}): ReactNode {
  const { dispatch } = usePrototypeDetail();
  const history = useLive(prototypeHistory, { name });
  return matchResource(history, {
    loading: () => <Loading variant="block" className="h-24 w-full" />,
    error: (err) => (
      <Text variant="caption" tone="destructive" title={err.message}>
        History unavailable
      </Text>
    ),
    ready: (h) => (
      <VersionList
        history={h}
        picks={undefined}
        selected={undefined}
        onPick={(version) => {
          // The newest version of a clean folder IS the live stop.
          const step = versionSteps(h, version.sha).steps.find(
            (s) => s.kind === "version" && s.version.sha === version.sha,
          );
          close();
          dispatch({
            type: "showPrototype",
            id: frameId,
            version: step ? versionForStep(step) : version,
          });
        }}
      />
    ),
  });
}
