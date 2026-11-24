import { noteRepoWrites } from "@plugins/framework/plugins/tooling/core";
import { unlinkSync, rmdirSync } from "fs";
import {
  existsSync,
  readdirSync,
} from "@plugins/packages/plugins/timed-fs/core";
import {
  joinAppPath,
  type AppPath,
} from "@plugins/infra/plugins/host-fs/plugins/user-path/core";
import { relative } from "path";
import { buildEnrichedTree } from "./enriched-tree";
import {
  computeHash,
  stringifyConfigValue,
  configFileOwner,
} from "@plugins/config_v2/core";
import type { ConfigDescriptor, JsonValue } from "@plugins/config_v2/core";
import type { FieldDef } from "@plugins/fields/core";
import {
  registerBarrelStubs,
  importBarrel,
} from "@plugins/plugin-meta/plugins/barrel-import/core";
import {
  asPath,
  asPluginId,
  type PluginId,
} from "@plugins/framework/plugins/plugin-id/core";
import { mainBundle } from "./main-bundle";
import { evaluateAllBarrels } from "./evaluated-barrels";
import { writeGenerated } from "./write-generated";
import type { CodegenPass } from "./codegen-pass";

interface DiscoveredConfig {
  hierarchyPath: string;
  descriptor: ConfigDescriptor;
}

function isConfigDescriptor(v: unknown): v is ConfigDescriptor {
  if (!v || typeof v !== "object") return false;
  const obj = v as Record<string, unknown>;
  return (
    typeof obj.name === "string" &&
    typeof obj.fields === "object" &&
    obj.fields !== null &&
    typeof obj.defaults === "object" &&
    obj.defaults !== null &&
    // Verified, not assumed: this narrows a value out of a dynamically imported
    // barrel, so every field the interface REQUIRES has to be checked here or
    // the predicate is asserting one that may not be there.
    typeof obj.originDefaultsFrom === "string"
  );
}

/**
 * Every config descriptor the bundled server halves register.
 *
 * From the build's evaluated records by default: a descriptor's name, fields,
 * defaults and legend are data, which is all an origin is rendered from — so
 * no barrel is imported when nothing changed. `live` imports the barrels
 * instead, for a reader that needs what a record cannot hold: the descriptor's
 * zod `schema` (the in-sync check validates committed files with it), or code
 * a field carries.
 */
async function discoverConfigs(
  pass: CodegenPass,
  opts?: { live?: boolean },
): Promise<DiscoveredConfig[]> {
  const { root } = pass;
  if (!opts?.live) {
    const ev = await evaluateAllBarrels(pass);
    const bundle = mainBundle(ev.tree, root);
    const results: DiscoveredConfig[] = [];
    for (const node of ev.tree.byDir.values()) {
      if (!bundle.has(node.id)) continue;
      for (const { mod, runtime } of ev.modulesOf(node)) {
        if (!(SERVER_HALF_RUNTIMES as readonly string[]).includes(runtime))
          continue;
        results.push(...configsOfModule(mod, node.id));
      }
    }
    return results;
  }

  const tree = await buildEnrichedTree(pass);
  registerBarrelStubs(root);

  // A plugin outside the app's composition is omitted from the registry, so its
  // config_v2 descriptors never register at runtime. Emitting their origins
  // would make `pruneOrphanedConfigFiles` delete user override files (a
  // generated origin with no live descriptor reads as orphaned). Skip everything
  // the main composition does not bundle.
  const bundle = mainBundle(tree, root);

  const results: DiscoveredConfig[] = [];

  for (const node of tree.byDir.values()) {
    if (!bundle.has(node.id)) continue;
    // Both server halves: a portable plugin registers its config from its
    // `machine/` barrel (until the registering plugins are split over the
    // portable config_v2 server half), exactly where
    // `config-v2:registrations-paired` looks.
    for (const runtime of SERVER_HALF_RUNTIMES) {
      // A plugin dir of this checkout's tree.
      if (!node.runtimes[runtime]) continue;
      const barrelPath = joinAppPath(node.dir, runtime, "index.ts");
      results.push(...(await configsOfBarrel(barrelPath, node.id)));
    }
  }

  return results;
}

/**
 * Every declared config migration's ledger key (`<hierarchy path>/<config
 * name>:<migration id>`, the key `applyConfigMigrations` records) — a
 * migration's id is data, so the evaluated records answer it.
 */
export async function configMigrationKeys(
  pass: CodegenPass,
): Promise<string[]> {
  return (await discoverConfigs(pass)).flatMap(
    ({ hierarchyPath, descriptor }) =>
      (descriptor.migrations ?? []).map(
        (m) => `${hierarchyPath}/${descriptor.name}:${m.id}`,
      ),
  );
}

/** The barrels a server-side `ConfigV2.Register` may live in. */
const SERVER_HALF_RUNTIMES = ["server", "machine"] as const;

/** The config descriptors one server-half barrel registers. */
async function configsOfBarrel(
  barrelPath: string,
  nodeId: PluginId,
): Promise<DiscoveredConfig[]> {
  let mod: Record<string, unknown>;
  try {
    mod = await importBarrel(barrelPath);
  } catch (err) {
    // A barrel that fails to import is a real defect — silently skipping it
    // would drop its config origins from generation and the breakage would
    // only surface later as a mysterious missing-config. Fail loudly with the
    // offending path.
    throw new Error(
      `Failed to import barrel for config-origin discovery: ${barrelPath}`,
      { cause: err },
    );
  }

  return configsOfModule(mod, nodeId);
}

/** The config descriptors one server-half module registers (live or evaluated). */
function configsOfModule(
  mod: Record<string, unknown>,
  nodeId: PluginId,
): DiscoveredConfig[] {
  // Reading `.default` off the imported module record cannot throw, so no
  // guard is needed — a missing default is simply `undefined`.
  const def = mod.default as Record<string, unknown> | undefined;
  if (!def) return [];

  const contributions = def.contributions as unknown[] | undefined;
  if (!Array.isArray(contributions)) return [];

  const results: DiscoveredConfig[] = [];
  for (const c of contributions) {
    if (!c || typeof c !== "object") continue;
    const contrib = c as Record<string, unknown>;
    if (isConfigDescriptor(contrib.descriptor)) {
      // An explicit `pluginId` on the registration wins over the node the
      // descriptor was discovered in — this lets a plugin register a descriptor
      // that belongs under a *different* defining plugin's tree. The override is
      // a dotted PluginId; config files live under the slash path, via asPath.
      const explicit =
        typeof contrib.pluginId === "string" ? contrib.pluginId : undefined;
      const id = explicit ? asPluginId(explicit) : nodeId;
      results.push({
        hierarchyPath: asPath(id),
        descriptor: contrib.descriptor,
      });
    }
  }
  return results;
}

function renderFieldLines(
  fields: Record<string, FieldDef>,
  defaults: Record<string, unknown>,
  indent: string,
): string[] {
  const lines: string[] = [];
  const entries = Object.entries(fields);
  for (let i = 0; i < entries.length; i++) {
    const [key, field] = entries[i]! as [string, FieldDef];
    const isLast = i === entries.length - 1;
    const comma = isLast ? "" : ",";
    const value = defaults[key];

    if (field.meta.description) {
      lines.push(`${indent}// ${field.meta.description}`);
    }
    if (field.meta.typeHint) {
      lines.push(`${indent}// ${field.meta.typeHint}`);
    }

    if ("subFields" in field && typeof field.subFields === "object") {
      const subFields = field.subFields as Record<string, FieldDef>;
      const subDefaults =
        value != null && typeof value === "object" && !Array.isArray(value)
          ? (value as Record<string, unknown>)
          : Object.fromEntries(
              Object.entries(subFields).map(([k, f]) => [k, f.defaultValue]),
            );
      lines.push(`${indent}"${key}": {`);
      lines.push(...renderFieldLines(subFields, subDefaults, `${indent}  `));
      lines.push(`${indent}}${comma}`);
    } else {
      lines.push(
        `${indent}"${key}": ${stringifyConfigValue(value, indent)}${comma}`,
      );
    }
  }
  return lines;
}

/**
 * Build-time hook that injects extra JSONC comment lines into a generated
 * `.origin.jsonc`. Each returned string is one comment's *text* (the renderer
 * prefixes `// `). Comments do not affect the config hash, so annotations can
 * change every build for free (e.g. a live catalog of available contributions).
 */
export type OriginAnnotationsProvider = (
  descriptor: ConfigDescriptor,
  hierarchyPath: string,
) => string[];

/**
 * Process-wide default annotations provider. Both the build step and the
 * `config-origins-in-sync` check resolve their provider through
 * {@link resolveOriginAnnotations}, so whatever the build wiring registers here
 * is applied identically on both sides — keeping the committed origin text and
 * the check's expected text byte-for-byte equal. Defaults to `undefined`
 * (no annotations → output identical to before this hook existed).
 */
let defaultOriginAnnotations: OriginAnnotationsProvider | undefined;

export function setDefaultOriginAnnotations(
  provider: OriginAnnotationsProvider | undefined,
): void {
  defaultOriginAnnotations = provider;
}

/** Explicit provider wins; otherwise fall back to the registered default. */
export function resolveOriginAnnotations(
  explicit?: OriginAnnotationsProvider,
): OriginAnnotationsProvider | undefined {
  return explicit ?? defaultOriginAnnotations;
}

/**
 * Async, root-aware default-annotations *preparer*. Some annotation providers
 * (e.g. reorder's contribution catalog) can only be built after walking the
 * enriched plugin tree — an async operation. A sync `OriginAnnotationsProvider`
 * can't do that itself, so a preparer module registers a function here that,
 * given the codegen pass, builds whatever it needs (the tree is already cached by
 * the time `renderConfigOriginContent` runs) and returns the resolved sync
 * provider.
 *
 * Critical for build↔check symmetry: `./equin build` and the standalone
 * `./equin check` run in SEPARATE processes, so a `setDefaultOriginAnnotations`
 * call made inside the build command is invisible to the check. The preparer is
 * instead registered as a side effect of *importing* a shared module that BOTH
 * the build step and the `config-origins-in-sync` check import — so both
 * processes resolve identical annotation comments.
 */
export type OriginAnnotationsPreparer = (
  pass: CodegenPass,
) => Promise<OriginAnnotationsProvider | undefined>;

let defaultOriginAnnotationsPreparer: OriginAnnotationsPreparer | undefined;

export function setDefaultOriginAnnotationsPreparer(
  preparer: OriginAnnotationsPreparer | undefined,
): void {
  defaultOriginAnnotationsPreparer = preparer;
}

/**
 * Build-time hook that *overrides* a generated origin's default value. Unlike
 * annotations (pure comments), the returned defaults feed BOTH the JSON body and
 * the `@hash`, so changing them shifts the committed origin and marks existing
 * overrides stale. Returning `undefined` (the no-provider path) falls back to
 * `descriptor.defaults` — byte-identical to before this hook existed. Used by
 * reorder to materialize each slot's full contribution catalog as the default.
 */
export type OriginDefaultsProvider = (
  descriptor: ConfigDescriptor,
  hierarchyPath: string,
) => Record<string, unknown> | undefined;

/**
 * Process-wide default defaults provider. Mirrors {@link defaultOriginAnnotations}:
 * both the build step and the `config-origins-in-sync` check resolve their
 * provider through {@link resolveOriginDefaults}, so whatever the build wiring
 * registers here is applied identically on both sides — keeping the committed
 * origin defaults/hash and the check's expected ones byte-for-byte equal.
 * Defaults to `undefined` (→ uses `descriptor.defaults`, identical to before
 * this hook existed).
 */
let defaultOriginDefaults: OriginDefaultsProvider | undefined;

export function setDefaultOriginDefaults(
  provider: OriginDefaultsProvider | undefined,
): void {
  defaultOriginDefaults = provider;
}

/** Explicit provider wins; otherwise fall back to the registered default. */
export function resolveOriginDefaults(
  explicit?: OriginDefaultsProvider,
): OriginDefaultsProvider | undefined {
  return explicit ?? defaultOriginDefaults;
}

/**
 * Async, root-aware default-defaults *preparer*, symmetric to
 * {@link OriginAnnotationsPreparer}. Reorder's materialized catalog can only be
 * built after walking the enriched plugin tree (async), so a preparer module
 * registers a function here that, given the codegen pass, builds the provider. As
 * with annotations, the preparer must be registered as a side effect of
 * *importing* a shared module that BOTH the build step and the
 * `config-origins-in-sync` check import, so both separate processes resolve
 * identical defaults.
 */
export type OriginDefaultsPreparer = (
  pass: CodegenPass,
) => Promise<OriginDefaultsProvider | undefined>;

let defaultOriginDefaultsPreparer: OriginDefaultsPreparer | undefined;

export function setDefaultOriginDefaultsPreparer(
  preparer: OriginDefaultsPreparer | undefined,
): void {
  defaultOriginDefaultsPreparer = preparer;
}

/**
 * Exported for its own unit test only — NOT part of the codegen barrel. Callers
 * render origins through {@link renderConfigOriginContent}, which resolves the
 * providers both the build and the `config-origins-in-sync` check must share.
 */
export function renderOriginJsonc(
  descriptor: ConfigDescriptor,
  hierarchyPath: string,
  originAnnotations?: OriginAnnotationsProvider,
  originDefaults?: OriginDefaultsProvider,
): string {
  // An override provider supplies the materialized defaults; with no provider
  // this is `descriptor.defaults` — same value for both the body and the hash,
  // byte-identical to before the hook existed.
  //
  // Both directions are checked, because the descriptor's `originDefaultsFrom`
  // is a CLAIM and the provider decides applicability on its own (by catalog
  // membership, which this file knows nothing about). Every generated origin
  // flows through here, in the build process and in the `config-origins-in-sync`
  // check process alike, so this one pair of asserts covers the whole surface —
  // and it fires while rendering, before a disagreement can be written to disk
  // as a hash some later reader trusts.
  const address = `${hierarchyPath}/${descriptor.name}`;
  const materialized = originDefaults?.(descriptor, hierarchyPath);
  if (materialized && descriptor.originDefaultsFrom === "descriptor") {
    throw new Error(
      `Config origin "${address}": an OriginDefaultsProvider materialized its defaults, ` +
        `but the descriptor declares originDefaultsFrom: "descriptor". ` +
        `Change the defineConfig call to originDefaultsFrom: "build" — a reader that hashes ` +
        `descriptor.defaults to test this origin's freshness would always be told it is stale.`,
    );
  }
  if (!materialized && descriptor.originDefaultsFrom === "build") {
    throw new Error(
      `Config origin "${address}": the descriptor declares originDefaultsFrom: "build", ` +
        `but no OriginDefaultsProvider supplied defaults for it, so this origin would be ` +
        `rendered from the descriptor's placeholder defaults. Either the descriptor should ` +
        `declare originDefaultsFrom: "descriptor", or its provider is not installed in this ` +
        `process — reorder's catalog preparer registers itself as a SIDE EFFECT of importing ` +
        `the codegen core barrel, so a caller that renders origins without that import trips this.`,
    );
  }
  const defaults = materialized ?? descriptor.defaults;
  const hash = computeHash(defaults as unknown as JsonValue);
  const lines: string[] = [];
  lines.push(`// @hash ${hash}`);
  lines.push("{");

  // Annotation comments live inside the object, before the fields. They are
  // pure comments so they never alter the parsed JSON or its hash.
  if (originAnnotations) {
    for (const line of originAnnotations(descriptor, hierarchyPath)) {
      lines.push(`  // ${line}`);
    }
  }

  lines.push(
    ...renderFieldLines(
      descriptor.fields as Record<string, FieldDef>,
      defaults as Record<string, unknown>,
      "  ",
    ),
  );

  lines.push("}");
  return lines.join("\n") + "\n";
}

export async function renderConfigOriginContent(opts: {
  pass: CodegenPass;
  originAnnotations?: OriginAnnotationsProvider;
  originDefaults?: OriginDefaultsProvider;
}): Promise<Map<string, string>> {
  const configs = await discoverConfigs(opts.pass);
  const result = new Map<string, string>();
  // Prefer an explicit/sync default provider; otherwise, if an async preparer
  // is registered (e.g. reorder's catalog), build the provider now. The
  // enriched tree `discoverConfigs` just walked is cached, so the preparer is
  // cheap. Resolving here — the single shared entry point for both the build
  // step and the in-sync check — keeps the emitted comments byte-identical.
  let annotations = resolveOriginAnnotations(opts.originAnnotations);
  if (!annotations && defaultOriginAnnotationsPreparer) {
    annotations = await defaultOriginAnnotationsPreparer(opts.pass);
  }
  // Same explicit→sync→async-preparer chain for the defaults override. With no
  // provider registered this stays `undefined`, so `renderOriginJsonc` falls
  // back to `descriptor.defaults` — byte-identical to today.
  let originDefaults = resolveOriginDefaults(opts.originDefaults);
  if (!originDefaults && defaultOriginDefaultsPreparer) {
    originDefaults = await defaultOriginDefaultsPreparer(opts.pass);
  }

  for (const { hierarchyPath, descriptor } of configs) {
    const relPath = `${hierarchyPath}/${descriptor.name}.origin.jsonc`;
    result.set(
      relPath,
      renderOriginJsonc(descriptor, hierarchyPath, annotations, originDefaults),
    );
  }

  return result;
}

/**
 * Map every config's origin relPath (`<hierarchyPath>/<name>.origin.jsonc`) to
 * its owning {@link ConfigDescriptor}, so callers can validate on-disk content
 * against `descriptor.schema`. Same discovery + keying as
 * {@link renderConfigOriginContent}, so the two maps zip by key.
 */
export async function loadConfigDescriptorsByOriginPath(opts: {
  pass: CodegenPass;
  /**
   * Import the barrels for LIVE descriptors (their zod `schema`, their code),
   * rather than reading the evaluated records' data — see `discoverConfigs`.
   */
  live?: boolean;
}): Promise<Map<string, ConfigDescriptor>> {
  const configs = await discoverConfigs(opts.pass, { live: opts.live });
  const result = new Map<string, ConfigDescriptor>();
  for (const { hierarchyPath, descriptor } of configs) {
    result.set(`${hierarchyPath}/${descriptor.name}.origin.jsonc`, descriptor);
  }
  return result;
}

/** Every `*.jsonc` under `dir`, as paths relative to `baseDir` (forward slashes). */
export function walkJsoncFiles(
  dir: AppPath,
  baseDir: AppPath,
  out: string[],
): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = joinAppPath(dir, entry.name);
    if (entry.isDirectory()) walkJsoncFiles(full, baseDir, out);
    else if (entry.isFile() && entry.name.endsWith(".jsonc"))
      out.push(relative(baseDir, full).split("\\").join("/"));
  }
}

function removeEmptyDirs(dir: AppPath, rootDir: AppPath): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory())
      removeEmptyDirs(joinAppPath(dir, entry.name), rootDir);
  }
  if (dir === rootDir) return;
  if (readdirSync(dir).length > 0) return;
  try {
    rmdirSync(dir);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOTEMPTY" && code !== "ENOENT") throw err;
  }
}

/**
 * Whether a config file's bytes are GENERATED — reproducible from source on the
 * next build, so deleting one costs nothing.
 *
 * `.origin.jsonc` is the rendered code/git default; `.ancestor.jsonc` is the
 * transient three-way-merge base captured from an origin. Everything else is a
 * bare `.jsonc` — a HAND-AUTHORED override, whose bytes exist nowhere but that
 * file.
 */
function isGeneratedConfigFile(relPath: string): boolean {
  return (
    relPath.endsWith(".origin.jsonc") || relPath.endsWith(".ancestor.jsonc")
  );
}

function renderStrandedReport(stranded: readonly string[]): string {
  return [
    `[config-v2] ${stranded.length} hand-authored config override(s) have no live ` +
      `defineConfig descriptor:`,
    "",
    ...stranded.map((p) => `  config/${p}`),
    "",
    "Their contents exist nowhere else, so this build refuses to delete them.",
    "",
    "If the descriptor was RENAMED, move the file to its new name (and its",
    "`.origin.jsonc` twin) before rebuilding — the hash is computed over content",
    "alone, so a rename carries the `// @hash` header across unchanged.",
    "If the descriptor was REMOVED for good, delete the file yourself and rebuild.",
  ].join("\n");
}

/**
 * Delete config files (`config/`, git-committed layer) whose owning
 * `defineConfig` descriptor is no longer live — closing the footgun where
 * removing a descriptor left orphaned `.origin.jsonc`, `.jsonc`, and `@app/`
 * scoped deltas committed on disk, displacing a `config-origins-in-sync` failure
 * onto the next unrelated pusher. Safe to run unconditionally: discovery is
 * all-or-nothing (it throws on any barrel-import failure), so `liveOriginRelPaths`
 * is always the complete live set — never a partial view that could delete a real
 * config. Returns the pruned paths (relative to `config/`) for logging.
 *
 * ONLY GENERATED FILES ARE PRUNED. An orphaned hand-authored override is a
 * THROW, not a delete: its bytes are the only copy of a human's decision, and a
 * descriptor losing its name is far more often a rename in progress than a
 * deliberate removal. Deleting it here would be silent, and it would be silent
 * at the worst possible moment — the build deletes long before it runs any check
 * (`app-artifacts.ts`: codegen → seedAuthoredOverrides → propagate → runChecks),
 * and the same codegen runs from `.githooks/post-rewrite` after a rebase or
 * amend, followed by `git add -A && git commit --amend`. So a delete here lands
 * in a commit with nothing to object to it.
 *
 * Classification happens BEFORE any unlink, so a build that throws leaves the
 * tree exactly as it found it and can simply be re-run after the fix.
 */
export function pruneOrphanedConfigFiles(opts: {
  configDir: AppPath;
  liveOriginRelPaths: Set<string>;
}): string[] {
  if (!existsSync(opts.configDir)) return [];

  // Live descriptors grouped by hierarchy → the set of names that keep files alive.
  const liveByHier = new Map<string, Set<string>>();
  for (const relPath of opts.liveOriginRelPaths) {
    const owner = configFileOwner(relPath);
    if (!owner) continue;
    let names = liveByHier.get(owner.hier);
    if (!names) liveByHier.set(owner.hier, (names = new Set()));
    names.add(owner.name);
  }

  const onDisk: string[] = [];
  walkJsoncFiles(opts.configDir, opts.configDir, onDisk);

  const prunable: string[] = [];
  const stranded: string[] = [];
  for (const relPath of onDisk) {
    const owner = configFileOwner(relPath);
    if (!owner) continue;
    if (liveByHier.get(owner.hier)?.has(owner.name)) continue;
    (isGeneratedConfigFile(relPath) ? prunable : stranded).push(relPath);
  }

  // Decide the whole batch before touching the disk.
  if (stranded.length > 0) throw new Error(renderStrandedReport(stranded));

  for (const relPath of prunable) {
    const file = joinAppPath(opts.configDir, relPath);
    unlinkSync(file);
    noteRepoWrites([file]);
  }

  if (prunable.length > 0) removeEmptyDirs(opts.configDir, opts.configDir);
  return prunable;
}

export async function generateConfigOrigins(opts: {
  pass: CodegenPass;
  originAnnotations?: OriginAnnotationsProvider;
  originDefaults?: OriginDefaultsProvider;
}): Promise<void> {
  const rendered = await renderConfigOriginContent(opts);
  // `root`: the checkout root the caller works in.
  const configDir = joinAppPath(opts.pass.root, "config");

  for (const [relPath, content] of rendered) {
    // `.jsonc` is not in the format allowlist, so the funnel returns these bytes
    // unchanged — routing through it anyway is what keeps one write idiom for
    // every generated artifact. It also creates the parent dir on the write path.
    await writeGenerated({ file: joinAppPath(configDir, relPath), content });
  }

  // Prune anything whose descriptor disappeared, so removing a `defineConfig`
  // never leaves committed orphans that break the repo-wide check downstream.
  const pruned = pruneOrphanedConfigFiles({
    configDir,
    liveOriginRelPaths: new Set(rendered.keys()),
  });
  if (pruned.length > 0) {
    console.warn(
      `[config-v2] pruned ${pruned.length} orphaned config file(s) no longer backed by defineConfig:`,
    );
    for (const p of pruned) console.warn(`  config/${p}`);
  }
}
