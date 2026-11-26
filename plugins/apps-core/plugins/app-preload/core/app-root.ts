const APP_ROOT_RE = /^(apps\/plugins\/[^/]+)\//;

/**
 * The app subtree a plugin lies in — `apps/plugins/<app>/` (trailing slash, so
 * it is a path prefix that cannot match a sibling app) — or `null` for a
 * plugin outside every app. A plugin path is the repo path below `plugins/`
 * (`apps/plugins/website/plugins/shell`).
 *
 * The unit the boot loads an app's code by: every deferred plugin under the
 * active app's root is its priority batch (web-core's `App.tsx`), and the same
 * root keys the batch's preloads in the served dist ({@link AppPreloads}).
 */
export function appRootOf(pluginPath: string): string | null {
  const m = APP_ROOT_RE.exec(pluginPath);
  return m ? m[1] + "/" : null;
}

/** An app as the per-app head keys it: its contributing web plugin, base path and launch kind. */
export interface HeadKeyedApp {
  /** The web plugin contributing the app (dot-form). */
  plugin: string;
  basePath: string;
  launch: "tab" | "surface";
}

/**
 * The paths a per-app head fragment keys, each with the app whose page it is:
 * every app's base path, and — a surface-mode app's base path prefixes the
 * pages of the apps it shows (`/desktop/agents/c/x`) — each tab app under
 * every surface app's. Every app gets its own key, so a base path nested in
 * another app's (`/home/menu-bar` in `/home`) never inherits that app's
 * fragment by longest match. The one keying of every per-app head source
 * (the app's module preloads, its boot snapshot request).
 */
export function appHeadPaths<A extends HeadKeyedApp>(
  apps: readonly A[],
): { path: string; app: A }[] {
  const out: { path: string; app: A }[] = apps.map((app) => ({
    path: app.basePath,
    app,
  }));
  for (const surface of apps) {
    if (surface.launch !== "surface") continue;
    for (const app of apps) {
      if (app.launch !== "tab") continue;
      out.push({ path: surface.basePath + app.basePath, app });
    }
  }
  return out;
}
