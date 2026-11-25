import { expect, test } from "bun:test";
import type { SystemPromptSection } from "./registry";

// Instructions are config, not code: a section whose body is a string written
// in code does not type-check — only a prompt field's PromptText does.
test("a section cannot render a literal", () => {
  const section: SystemPromptSection = {
    id: "x",
    label: "X",
    heading: "X",
    followsMandate: false,
    // @ts-expect-error — a string is not a PromptText
    render: async () => "Always do the thing.",
  };
  // A generated listing is data, and says so by its key.
  const listing: SystemPromptSection = {
    id: "y",
    label: "Y",
    heading: "Y",
    followsMandate: false,
    listing: async () => "- task-1 A — open",
  };
  expect([section.id, listing.id]).toEqual(["x", "y"]);
});
