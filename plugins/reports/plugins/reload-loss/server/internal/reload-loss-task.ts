import type { ReportRow } from "@plugins/reports/server";
import { ReloadLossPayloadSchema, type ReloadLossPayload } from "../../core";

// The same state is lost on every unload of its tab: re-arm the bell daily,
// not every 10 minutes.
export const RELOAD_LOSS_NOTIF_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export function renderReloadLossTask(row: ReportRow): {
  title: string;
  description: string;
} {
  // Validated by the schema at ingest: a failure here is a corrupted row.
  const data = ReloadLossPayloadSchema.parse(row.data);
  const noisePrefix = row.noise ? "[noise] " : "";
  if (data.origin === "scroll")
    return renderScrollLossTask(row, data, noisePrefix);
  const where = data.source ?? data.uiOwner ?? data.owners.join(" › ");
  const rawTitle = `${noisePrefix}[reload-loss] ${data.component} loses state #${data.stateIndex} on a remount`;
  const title =
    rawTitle.length > 120 ? `${rawTitle.slice(0, 117)}...` : rawTitle;
  const lines = [
    `**React state the user changed was thrown away by a remount.** The dev unmount detector (\`primitives/kept-state/plugins/loss-detector\`) saw \`${data.component}\` unmount with its useState / useReducer #${data.stateIndex} (counting from 0, in call order) holding a value the user set — ${data.value} — that is neither kept (\`useKept\` / \`useDraft\`) nor marked \`useTransient("<why>")\`. A hidden tab unloaded by tab residency, a reload and an upgrade all remount, so the user loses it on each.`,
    "",
    `**State**`,
    `- **Component:** \`${data.component}\``,
    ...(data.owners.length > 0
      ? [`- **Under:** ${data.owners.map((o) => `\`${o}\``).join(" › ")}`]
      : []),
    `- **Which:** useState / useReducer #${data.stateIndex}`,
    `- **Value when lost:** ${data.value}`,
    ...(data.source
      ? [`- **First element it renders:** \`${data.source}\``]
      : []),
    ...(data.uiOwner ? [`- **Owner stamp:** \`${data.uiOwner}\``] : []),
    `- **Place:** \`${data.scope}\``,
    `- **Where to look:** ${where ? `\`${where}\`` : "the component above"}`,
    "",
    ...reportLines(row),
    "",
    `**How to fix**`,
    `Classify the state (\`primitives/kept-state/CLAUDE.md\`, "Classify a piece of state"). Work the user made → \`useKept\` work tier with a \`subject\`; where the user was looking (expanded, sub-tab, selection, query) → \`useKept\` view tier; throwaway by design (hover, busy, a menu's open flag) → \`useTransient("<why>")\`. Never mark state the user would miss as transient to silence this.`,
  ];
  return { title, description: lines.join("\n") };
}

function reportLines(row: ReportRow): string[] {
  return [
    `**Report**`,
    `- **Source:** ${row.source}`,
    `- **Worktree:** ${row.worktree}`,
    `- **Fingerprint:** ${row.fingerprint}`,
    `- **Count:** ${row.count}`,
    `- **First seen:** ${row.firstSeenAt.toISOString()}`,
    `- **Last seen:** ${row.lastSeenAt.toISOString()}`,
    ...(row.url ? [`- **URL:** ${row.url}`] : []),
  ];
}

function renderScrollLossTask(
  row: ReportRow,
  data: Extract<ReloadLossPayload, { origin: "scroll" }>,
  noisePrefix: string,
): { title: string; description: string } {
  const who = data.uiOwner ?? data.source ?? `pane ${data.pane}`;
  const rawTitle = `${noisePrefix}[reload-loss] ${who} scroller opens at its top after a reload`;
  const title =
    rawTitle.length > 120 ? `${rawTitle.slice(0, 117)}...` : rawTitle;
  const lines = [
    `**A pane's main scroller the user scrolled keeps nothing across a reload.** The dev scroll watch (\`primitives/kept-state/plugins/loss-detector\`, \`watchScrollLoss\`) saw a \`<Scroll>\` filling at least half its pane settle at ${data.offset} with no keep: not \`PaneScroll\`, no \`<Scroll keep="…">\`, no persisting \`useStickyScroll\`, not \`keep={transient("<why>")}\`. A reload, a tab unload and an upgrade all open it at its top.`,
    "",
    `**Scroller**`,
    ...(data.uiOwner ? [`- **Rendered by:** \`${data.uiOwner}\``] : []),
    ...(data.source ? [`- **Element:** \`${data.source}\``] : []),
    `- **Pane:** \`${data.pane}\``,
    `- **Where it was:** ${data.offset}`,
    "",
    ...reportLines(row),
    "",
    `**How to fix**`,
    `A body that is the pane's reading surface keeps its offset: render it as the pane's \`PaneScroll\`, or name it under the pane's keep scope — \`<Scroll keep="<name>">\`, the name unique among the pane's kept scrollers (\`primitives/dom/auto-scroll/CLAUDE.md\`, "Every scroller of a pane"). A follower that should come back to the row being read passes \`useStickyScroll({ persist })\`. Only a scroller whose offset is throwaway by design says so: \`keep={transient("<why>")}\`.`,
  ];
  return { title, description: lines.join("\n") };
}
