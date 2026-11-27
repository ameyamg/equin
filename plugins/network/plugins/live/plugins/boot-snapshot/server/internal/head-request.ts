import { APP_CODE_HOSTS } from "@plugins/framework/plugins/web-sdk/core";
import { endpointPath } from "@plugins/infra/plugins/endpoints/server";
import {
  DocumentHead,
  type HeadFragments,
} from "@plugins/shell/plugins/document-head/server";
import { declaredAppPlugins } from "@plugins/apps-core/server";
import {
  appHeadPaths,
  appRootOf,
  type HeadKeyedApp,
} from "@plugins/apps-core/plugins/app-preload/core";
import {
  asFsPath,
  asPluginId,
} from "@plugins/framework/plugins/plugin-id/core";
import { bootSnapshot } from "../../core";
import { HEAD_REQUEST_GLOBAL } from "../../shared/head-request";
import { pageIssuerHeaders } from "@plugins/primitives/plugins/networking/core";
import { headRequestScript } from "@plugins/primitives/plugins/networking/plugins/request-guard/core";

/**
 * The head script that starts the boot snapshot request at t0. An inline
 * async module: unlike a classic inline script it does not wait for the
 * render-blocking stylesheet above it, and it imports nothing, so it runs as
 * soon as the parser reaches the end of the head — while the modulepreloads
 * listed before it download. The request is the one the boot task would send
 * (`sendEndpointRequest(fetch, bootSnapshot, {}, { query })`: a plain same-origin GET,
 * naming the page as its issuer — `networking`'s request issuer, as the page
 * transport would), its path built from the endpoint's contract.
 *
 * Written through `headRequestScript`: a browser that runs it after the app
 * entry (nothing orders an async module before it) issues nothing, and the
 * boot task sends the request itself.
 *
 * `app` is the plugin subtree of the app the page's path is in (null on a
 * path outside every app): the snapshot then carries that app's own preloads
 * too. It is parked beside the request, so a second boot (Retry) asks for the
 * same app.
 *
 * The `.catch` only marks the promise handled, so a network failure before the
 * boot task takes it is not an unhandled rejection; the boot task awaits the
 * same promise and so still sees the failure (and blocks boot on it).
 */
export function bootSnapshotHeadScript(app: string | null): string {
  const query = app === null ? {} : { app };
  const path = JSON.stringify(endpointPath(bootSnapshot, {}, query));
  const name = JSON.stringify(HEAD_REQUEST_GLOBAL);
  return headRequestScript(
    `const startMs = performance.now();` +
      `const response = fetch(${path}, { headers: ${JSON.stringify(pageIssuerHeaders())} });` +
      `response.catch(() => undefined);` +
      `globalThis[${name}] = { response, startMs, app: ${JSON.stringify(app)} };`,
  );
}

/**
 * Pure: the head fragments for a set of declared apps — per app path
 * (apps-core/app-preload's `appHeadPaths`), the request naming that app's
 * plugin subtree (`appRootOf`), so its snapshot carries the app's own
 * preloads; `""` (every other path) the request naming none.
 */
export function renderBootSnapshotHead(
  apps: readonly HeadKeyedApp[],
): HeadFragments {
  const head: HeadFragments = { "": bootSnapshotHeadScript(null) };
  for (const { path, app } of appHeadPaths(apps)) {
    head[path] = bootSnapshotHeadScript(
      appRootOf(asFsPath(asPluginId(app.plugin)), APP_CODE_HOSTS),
    );
  }
  return head;
}

/** Every page of the shell boots, and every boot reads the snapshot: each app's path, and `""`. */
export const bootSnapshotHead = DocumentHead.Fragment({
  id: "boot-snapshot",
  render: () =>
    Promise.resolve(
      renderBootSnapshotHead(
        declaredAppPlugins().map(({ plugin, declaration }) => ({
          plugin,
          basePath: declaration.app.basePath,
          launch: declaration.launch,
        })),
      ),
    ),
  // A constant: the composition's apps do not change while the backend runs.
  subscribe: () => () => undefined,
});
