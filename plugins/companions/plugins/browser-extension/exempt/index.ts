import type { Exemptions } from "@plugins/framework/plugins/tooling/plugins/exempt/core";

export default [
  {
    rule: "frame/no-raw-frame",
    paths: ["browser-extension/popup.ts"],
    kind: "sanctioned",
    reason:
      "The extension's own popup, at its chrome-extension:// origin, framing the equin page it is the shell of — no React and no app origin here for the framing primitive to guard; the page accepts the bridge only from this extension's origin.",
  },
  {
    rule: "frame/no-raw-frame",
    paths: ["browser-extension/offscreen.ts"],
    kind: "sanctioned",
    reason:
      "The extension's offscreen recorder, at its chrome-extension:// origin, framing equin's own recorder relay page (the same hello → port handshake as the popup): no React and no app origin here for the framing primitive to guard; the relay accepts the port only from this extension's origin and is served under frame-ancestors of it.",
  },
  {
    rule: "audio-context/no-raw-audio-context",
    paths: ["browser-extension/offscreen.ts"],
    kind: "sanctioned",
    reason:
      "The extension shell may import only core barrels (boundary-config: `browser-extension` → core), so the web audio-context owner is out of reach; the offscreen recorder's one context is resumed and closed by its one session, each awaited.",
  },
  {
    rule: "media-element/no-raw-media-play",
    paths: ["browser-extension/offscreen.ts"],
    kind: "sanctioned",
    reason:
      "The extension shell may import only core barrels, so playMedia is out of reach; the offscreen recorder plays a muted capture stream it owns (for the thumbnail frame), awaited — a refusal fails the start loudly.",
  },
  {
    rule: "web-storage/no-raw-web-storage",
    paths: ["browser-extension/popup-trace.ts"],
    kind: "sanctioned",
    reason:
      "The popup's lifecycle trace, in the localStorage of the extension's own chrome-extension:// origin — no other plugin shares it, so the shared-origin quota the rule guards is not at stake — and the shell may import only core barrels, so defineStore is out of reach. Synchronous storage is the point: each event must land before Chrome closes the popup. Two keys, one capped trace each.",
  },
] satisfies Exemptions;
