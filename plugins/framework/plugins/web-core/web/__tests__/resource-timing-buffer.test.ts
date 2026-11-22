// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { RESOURCE_TIMING_BUFFER_SIZE } from "@plugins/primitives/plugins/perfs/plugins/boot-trace/core";

const html = readFileSync(join(__dirname, "..", "index.html"), "utf8");

it("the shell gives Resource Timing boot-trace's room, before it loads a file", () => {
  const script = /<script id="resource-timing">([\s\S]*?)<\/script>/.exec(html);
  expect(script?.[1]).toContain(
    `setResourceTimingBufferSize(${RESOURCE_TIMING_BUFFER_SIZE})`,
  );
  expect(script!.index).toBeLessThan(html.indexOf('<script type="module"'));
});
