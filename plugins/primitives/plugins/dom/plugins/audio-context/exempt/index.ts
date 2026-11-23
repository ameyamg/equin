import type { Exemptions } from "@plugins/framework/plugins/tooling/plugins/exempt/core";

export default [
  {
    rule: "audio-context/no-raw-audio-context",
    paths: ["web/internal/owned-audio-context.ts"],
    kind: "sanctioned",
    reason:
      "The primitive's one new AudioContext and its owner's one resume(), whose own-teardown rejection it answers as closed.",
  },
] satisfies Exemptions;
