import noRawAudioContext from "./no-raw-audio-context";
import type { LintContribution } from "@plugins/framework/plugins/tooling/plugins/lint/core";

export default {
  name: "audio-context",
  rules: {
    "no-raw-audio-context": noRawAudioContext,
  },
} satisfies LintContribution;
