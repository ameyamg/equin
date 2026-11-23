import { defineApp } from "@plugins/primitives/plugins/pane/core";
import { symbol } from "@plugins/ui/plugins/icons/core";

export const studioApp = defineApp({
  id: "studio",
  name: "Plugins",
  basePath: "/plugins",
  formerBasePaths: ["/studio"],
  icon: symbol("extension"),
  category: "create",
  audience: "developer",
});
