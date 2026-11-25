import { useState } from "react";
import { PanelSection, PanelTile } from "@plugins/companions/plugins/panel/web";
import {
  useExtensionHost,
  type ExtensionHost,
  type ExtensionRecorder,
} from "@plugins/companions/plugins/browser-extension/web";
import {
  presetFit,
  presetSizeText,
  recordedMs,
  recordPreset,
  sizeRefusalText,
  stopCauseText,
  windowBoundsFor,
  type RecordPreset,
  type RecorderOptions,
  type RecorderSnapshot,
  type RecorderState,
  type SavedRecording,
  type TabFit,
  type TabMeasure,
} from "@plugins/companions/plugins/browser-extension/core";
import { Row } from "@plugins/primitives/plugins/css/plugins/row/web";
import { Line } from "@plugins/primitives/plugins/css/plugins/line/web";
import { Stack } from "@plugins/primitives/plugins/css/plugins/spacing/web";
import { Text } from "@plugins/primitives/plugins/css/plugins/text/web";
import { Spinner } from "@plugins/primitives/plugins/css/plugins/spinner/web";
import { yieldClass } from "@plugins/primitives/plugins/css/plugins/yield/web";
import { IconButton } from "@plugins/primitives/plugins/icon-button/web";
import { Loading } from "@plugins/primitives/plugins/loading/web";
import { symbol, type SymbolRef } from "@plugins/ui/plugins/icons/core";
import { Icon } from "@plugins/ui/plugins/icons/web";
import {
  clock,
  sizeText,
  useRecorder,
  useTicking,
} from "../internal/use-recorder";
import { useSavedActions } from "../internal/saved-actions";
import { SizeMenu } from "./size-menu";
import "../internal/record.css";

const icons = {
  tile: symbol("videocam"),
  apply: symbol("fit-screen"),
  tabOn: symbol("volume-up"),
  tabOff: symbol("volume-off"),
  micOn: symbol("mic"),
  micOff: symbol("mic-off"),
  clicks: symbol("ads-click"),
  timerOn: symbol("timer"),
  timerOff: symbol("timer-off"),
  discard: symbol("delete"),
  pause: symbol("pause"),
  resume: symbol("play-arrow"),
  stop: symbol("stop"),
  reveal: symbol("folder-open"),
  trash: symbol("delete"),
  error: symbol("error"),
};

/**
 * The extension's Record section (`BrowserExtension.Section` "record"): the
 * prototype's "Record this tab" row — the size dropdown, the tab audio / mic /
 * clicks / countdown toggles and the round Record button (⌥⇧R) —, the live
 * recording card while one runs (timer, Discard, Pause, Stop), and the last
 * recording saved (Show in Files, Delete). Absent on a shell from before the
 * recorder.
 */
export function RecordSection() {
  const host = useExtensionHost();
  if (host.kind !== "present" || host.recorder === null) return null;
  return <RecorderBody host={host} recorder={host.recorder} />;
}

type PresentHost = Extract<ExtensionHost, { kind: "present" }>;

function RecorderBody({
  host,
  recorder,
}: {
  host: PresentHost;
  recorder: ExtensionRecorder;
}) {
  const view = useRecorder(recorder);
  const [note, setNote] = useState<{
    tone: "error" | "success";
    text: string;
  } | null>(null);
  /** Run a bridge call from a click: a refusal is said under the row, and a
   *  `done` line once it went through. */
  const run: Run = (work, done) => {
    setNote(null);
    work().then(
      () => {
        if (done !== undefined) setNote({ tone: "success", text: done });
      },
      (err: unknown) =>
        setNote({
          tone: "error",
          text: err instanceof Error ? err.message : String(err),
        }),
    );
  };
  return (
    <PanelSection label="Record">
      <div className="rec">
        {view.kind === "pending" ? (
          <Loading variant="rows" />
        ) : (
          <Body
            host={host}
            recorder={recorder}
            snapshot={view.snapshot}
            fit={view.fit}
            remeasure={view.remeasure}
            run={run}
          />
        )}
        {note !== null && <Note tone={note.tone} text={note.text} />}
      </div>
    </PanelSection>
  );
}

type Run = (work: () => Promise<void>, done?: string) => void;

function Body({
  host,
  recorder,
  snapshot,
  fit,
  remeasure,
  run,
}: {
  host: PresentHost;
  recorder: ExtensionRecorder;
  snapshot: RecorderSnapshot;
  fit: TabFit;
  remeasure: () => Promise<void>;
  run: Run;
}) {
  const { state, options } = snapshot;
  switch (state.kind) {
    case "recording":
      return <RecordingCard state={state} recorder={recorder} run={run} />;
    case "starting":
      return <Busy label="Getting ready…" />;
    case "saving":
      return <Busy label="Saving…" />;
    case "idle":
      return (
        <>
          {state.last?.kind === "saved" && (
            <SavedRow
              host={host}
              recording={state.last.recording}
              onForget={() => recorder.command("forget-last")}
              run={run}
            />
          )}
          {state.last?.kind === "saved" &&
            state.last.stoppedBy !== null &&
            state.last.stoppedBy !== "user" && (
              <Note
                tone="error"
                text={`It stopped on its own: ${stopCauseText(state.last.stoppedBy)}.`}
              />
            )}
          {state.last?.kind === "failed" && (
            <Note tone="error" text={state.last.error} />
          )}
          <RecordRow
            options={options}
            fit={fit}
            mic={snapshot.mic}
            onOptions={(next) => run(() => recorder.setOptions(next))}
            onApplySize={() => {
              const preset = recordPreset(options.preset);
              run(
                async () => {
                  await recorder.applySize(preset.id);
                  await remeasure();
                },
                `Window sized: the page is ${presetSizeText(preset)}`,
              );
            }}
            onMicOn={(next) =>
              run(async () => {
                await recorder.setOptions(next);
                if (snapshot.mic !== "granted")
                  await recorder.requestMicrophone();
              })
            }
            onRecord={() =>
              run(async () => {
                await recorder.start(options);
                // The page is about to resize and count down: get out of the way.
                await host.close?.();
              })
            }
          />
        </>
      );
  }
}

function Busy({ label }: { label: string }) {
  return (
    <div className="rec-row">
      <Spinner shape="ring" className="size-3.5" />
      <Text tone="muted">{label}</Text>
    </div>
  );
}

function Note({ tone, text }: { tone: "error" | "success"; text: string }) {
  return (
    <div className="rec-note" data-tone={tone} key={text}>
      <Icon icon={tone === "error" ? icons.error : icons.trash} />
      <Text variant="caption">{text}</Text>
    </div>
  );
}

// ── Idle: the Record row ───────────────────────────────────────────────────

function RecordRow({
  options,
  fit,
  mic,
  onOptions,
  onApplySize,
  onMicOn,
  onRecord,
}: {
  options: RecorderOptions;
  fit: TabFit;
  mic: RecorderSnapshot["mic"];
  onOptions: (next: RecorderOptions) => void;
  onApplySize: () => void;
  onMicOn: (next: RecorderOptions) => void;
  onRecord: () => void;
}) {
  const set = (patch: Partial<RecorderOptions>) =>
    onOptions({ ...options, ...patch });
  // Why Record is off: a tab Chrome lets no extension record, or a size this
  // tab cannot take (said on the button, as the dropdown says it).
  const refusal =
    fit.kind === "unrecordable"
      ? "Chrome doesn’t let extensions record this page"
      : (() => {
          const ok = presetFit(recordPreset(options.preset), fit.measure);
          return ok.ok
            ? null
            : `${presetSizeText(recordPreset(options.preset))}: ${sizeRefusalText(ok.reason)}`;
        })();
  return (
    <div className="rec-row">
      <PanelTile symbol={icons.tile} color="rose" />
      <div className="rec-main">
        <Line>
          <Text>Record this tab</Text>
        </Line>
        {fit.kind === "measured" ? (
          <div className="rec-opts">
            <SizeMenu
              value={options.preset}
              measure={fit.measure}
              onChange={(preset) => set({ preset })}
            />
            <ApplySize
              preset={recordPreset(options.preset)}
              measure={fit.measure}
              onClick={onApplySize}
            />
            <span className="rec-vsep" />
            <Toggle
              on={options.tabAudio}
              icon={options.tabAudio ? icons.tabOn : icons.tabOff}
              title={options.tabAudio ? "Tab audio: on" : "Tab audio: off"}
              onClick={() => set({ tabAudio: !options.tabAudio })}
            />
            <Toggle
              on={options.mic}
              icon={options.mic ? icons.micOn : icons.micOff}
              title={
                options.mic
                  ? mic === "granted"
                    ? "Microphone: on"
                    : "Microphone: on — allow it in the tab that opened"
                  : "Microphone: off"
              }
              onClick={() =>
                options.mic
                  ? set({ mic: false })
                  : onMicOn({ ...options, mic: true })
              }
            />
            <Toggle
              on={options.clicks}
              icon={icons.clicks}
              title={
                options.clicks
                  ? "Clicks: a ripple on each click (the pointer is always in the video while it moves)"
                  : "Clicks: not shown (the pointer is always in the video while it moves)"
              }
              onClick={() => set({ clicks: !options.clicks })}
            />
            <Toggle
              on={options.countdown}
              icon={options.countdown ? icons.timerOn : icons.timerOff}
              title={
                options.countdown
                  ? "Countdown: 3 s before recording"
                  : "Countdown: off — starts at once"
              }
              onClick={() => set({ countdown: !options.countdown })}
            />
          </div>
        ) : (
          <Line>
            <Text variant="caption" tone="muted" title={fit.reason}>
              Chrome doesn’t let extensions record this page
            </Text>
          </Line>
        )}
      </div>
      <button
        type="button"
        className="rec-go"
        title={refusal ?? "Record  ⌥⇧R"}
        aria-label="Record"
        disabled={refusal !== null}
        onClick={onRecord}
      >
        <span className="rec-go-dot" />
      </button>
    </div>
  );
}

/**
 * Apply, beside the size dropdown: size the window to the chosen preset's
 * page now, without recording (to lay the page out, or check it, first).
 * Off for As is (nothing to apply), a size this screen or zoom refuses, and
 * a page already at that size — each said in its tooltip.
 */
function ApplySize({
  preset,
  measure,
  onClick,
}: {
  preset: RecordPreset;
  measure: TabMeasure;
  onClick: () => void;
}) {
  const page = preset.page;
  const off =
    page === null
      ? "As is keeps the window as it is"
      : measure.innerWidth === page.width && measure.innerHeight === page.height
        ? `Already sized: the page is ${page.width} × ${page.height}`
        : (() => {
            const bounds = windowBoundsFor(page, measure);
            return bounds.ok ? null : sizeRefusalText(bounds.reason);
          })();
  const title =
    off ??
    `Resize the window so the page is ${presetSizeText(preset)} now, without recording`;
  return (
    <button
      type="button"
      className="rec-tg rec-apply"
      title={title}
      aria-label={title}
      disabled={off !== null}
      onClick={onClick}
    >
      <Icon icon={icons.apply} />
    </button>
  );
}

function Toggle({
  on,
  icon,
  title,
  onClick,
}: {
  on: boolean;
  icon: SymbolRef;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="rec-tg"
      aria-pressed={on}
      title={title}
      aria-label={title}
      onClick={onClick}
    >
      <Icon icon={icon} />
    </button>
  );
}

// ── Recording: the card ────────────────────────────────────────────────────

function audioLabel(o: RecorderOptions): string {
  return (
    [o.tabAudio && "tab audio", o.mic && "mic"].filter(Boolean).join(" + ") ||
    "no audio"
  );
}

function sizeLabel(
  state: Extract<RecorderState, { kind: "recording" }>,
): string {
  const page = recordPreset(state.options.preset).page;
  return page === null
    ? `current size · video ${state.width} × ${state.height}`
    : `${page.width} × ${page.height} · video ${state.width} × ${state.height}`;
}

function RecordingCard({
  state,
  recorder,
  run,
}: {
  state: Extract<RecorderState, { kind: "recording" }>;
  recorder: ExtensionRecorder;
  run: Run;
}) {
  const paused = state.pausedAt !== null;
  const now = useTicking(!paused);
  return (
    <div className="rec-card" data-paused={paused ? "" : undefined}>
      <div className="rec-card-top">
        <span className="rec-dot" />
        <div>
          <div className="rec-clock">{clock(recordedMs(state, now))}</div>
          <div className="rec-meta">
            {paused ? "Paused" : "Recording this tab"} · {sizeLabel(state)} ·{" "}
            {audioLabel(state.options)}
          </div>
        </div>
      </div>
      <div className="rec-btns">
        <button
          type="button"
          className="rec-btn"
          data-icon=""
          title="Discard"
          aria-label="Discard"
          onClick={() => run(() => recorder.command("discard"))}
        >
          <Icon icon={icons.discard} />
        </button>
        <button
          type="button"
          className="rec-btn"
          onClick={() =>
            run(() => recorder.command(paused ? "resume" : "pause"))
          }
        >
          <Icon icon={paused ? icons.resume : icons.pause} />
          {paused ? "Resume" : "Pause"}
        </button>
        <button
          type="button"
          className="rec-btn"
          data-stop=""
          title="Stop  ⌥⇧R"
          onClick={() => run(() => recorder.command("stop"))}
        >
          <Icon icon={icons.stop} />
          Stop
        </button>
      </div>
    </div>
  );
}

// ── The saved recording ────────────────────────────────────────────────────

function SavedRow({
  host,
  recording,
  onForget,
  run,
}: {
  host: PresentHost;
  recording: SavedRecording;
  onForget: () => Promise<void>;
  run: Run;
}) {
  const actions = useSavedActions(host, recording, onForget);
  const duration = clock(recording.durationMs);
  return (
    <div className="rec-fresh">
      <Row
        icon={
          <span className="rec-shot">
            {recording.thumbnail !== null && (
              <img src={recording.thumbnail} alt="" />
            )}
            <i>{duration}</i>
          </span>
        }
        title={recording.path}
        onClick={() => run(actions.reveal)}
        actions={
          <>
            <IconButton
              icon={icons.reveal}
              label="Show in Files"
              onClick={() => run(actions.reveal)}
            />
            <IconButton
              icon={icons.trash}
              label="Delete (moves it to the Trash)"
              onClick={() => run(actions.trash, "Moved to the Trash")}
            />
          </>
        }
      >
        <Stack gap="none" className={yieldClass("x")}>
          <Line>
            <Text>{recording.name}</Text>
          </Line>
          <Line>
            <Text variant="caption" tone="muted">
              {recording.width} × {recording.height} · {duration} ·{" "}
              {sizeText(recording.bytes)}
            </Text>
          </Line>
        </Stack>
      </Row>
    </div>
  );
}
