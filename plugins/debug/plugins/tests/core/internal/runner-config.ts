import { defineConfig } from "@plugins/config_v2/core";
import { boolField } from "@plugins/fields/plugins/bool/plugins/config/core";

/**
 * Main's test runner switch. OFF by default: the runner spends the host's CPU
 * on running tests after every push, which an install opts into. With it off,
 * main runs no test on its own and files no `test-failing` report; agents'
 * own `./equin test` runs and the push gate are unaffected.
 */
export const testRunnerConfig = defineConfig({
  name: "test-runner",
  fields: {
    enabled: boolField({
      default: false,
      label: "Run main's tests after each push",
      description:
        "When on, main runs the test files each push affected (at low priority) and files a test-failing report for each file a second run confirms broken. Off by default: no test runs on its own and no test-failing report is filed.",
    }),
  },
});
