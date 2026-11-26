import fetchEndpointBindingName from "./fetch-endpoint-binding-name";
import noAssetPathRead from "./no-asset-path-read";
import noRawContentDisposition from "./no-raw-content-disposition";
import noRawEndpointCall from "./no-raw-endpoint-call";
import noRawWebFetch from "./no-raw-web-fetch";
import noVoidFetchEndpoint from "./no-void-fetch-endpoint";
import type { LintContribution } from "@plugins/framework/plugins/tooling/plugins/lint/core";

export default {
  name: "endpoints",
  rules: {
    "fetch-endpoint-binding-name": fetchEndpointBindingName,
    "no-asset-path-read": noAssetPathRead,
    "no-raw-content-disposition": noRawContentDisposition,
    "no-raw-endpoint-call": noRawEndpointCall,
    "no-raw-web-fetch": noRawWebFetch,
    "no-void-fetch-endpoint": noVoidFetchEndpoint,
  },
  noDebt: [
    "no-raw-web-fetch",
    "no-asset-path-read",
    "no-raw-content-disposition",
  ],
} satisfies LintContribution;
