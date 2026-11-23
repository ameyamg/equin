import { join } from "node:path";
import { CLI_NAME } from "@plugins/framework/plugins/cli/plugins/cli-name/core";
import {
  commitSnapshot,
  repoSnapshotNow,
} from "@plugins/framework/plugins/tooling/core";
import type { AppPath } from "@plugins/infra/plugins/host-fs/plugins/user-path/core";
import {
  spawnCaptured,
  spawnPassthrough,
} from "@plugins/infra/plugins/spawn/core";
import {
  envEntries,
  unsetEnv,
} from "@plugins/infra/plugins/launcher/plugins/env-names/core";
import { openRecordStore } from "@plugins/plugin-meta/plugins/plugin-records/cli";
import {
  testDigests,
  testFilesOf,
} from "@plugins/framework/plugins/cli/plugins/test/plugins/digest/core";
import { TESTS_FAILED_EXIT } from "@plugins/framework/plugins/cli/plugins/test/plugins/record/core";
import {
  buildVerdictIndex,
  describeJudgement,
  isProvingPass,
  judgeFailure,
  restsOnMergeBase,
  type FailureJudgement,
  type VerdictIndex,
} from "@plugins/framework/plugins/cli/plugins/test/plugins/main-standing/core";
import {
  mainSlug as mainNamespace,
  readTestRunRecords,
  standingLines,
  standingOnMain,
} from "@plugins/framework/plugins/cli/plugins/test/plugins/main-standing/cli";
import type { TestRunRecord } from "@plugins/framework/plugins/cli/plugins/test/plugins/record/core";
import { withScratchCheckout } from "./scratch-checkout";
import { affectedTests } from "../../core";

// A wedge-breaker for one metadata read, not a latency budget.
const GIT_TIMEOUT_MS = 30_000;

/** What the gate decided. A refusal has printed its story already. */
export type TestGateResult = { ok: true } | { ok: false };

async function git(root: AppPath, args: string[]): Promise<string> {
  const r = await spawnCaptured(["git", ...args], {
    cwd: root,
    timeoutMs: GIT_TIMEOUT_MS,
  });
  if (r.exitCode !== 0)
    throw new Error(
      `test gate: git ${args.join(" ")} failed (exit ${r.exitCode}): ${r.stderr.trim()}`,
    );
  return r.stdout.trim();
}

/** Each file's digest, path → digest. */
type Digests = Map<string, string>;

const flat = (m: Map<string, { digest: string }>): Digests =>
  new Map([...m].map(([path, d]) => [path, d.digest]));

function minutes(ms: number): string {
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))} s`;
  return `${(ms / 60_000).toFixed(1)} min`;
}

/**
 * `./equin test <files>`, its output passed through. Its verdicts are read
 * back from the harvest, never from its exit code: exit 0 and the
 * tests-failed exit are both a run that happened; anything else is a run that
 * could not be done.
 */
async function runTests(
  root: AppPath,
  files: readonly string[],
): Promise<{ ran: true } | { ran: false; exitCode: number }> {
  console.log(`\n$ (${root}) ./${CLI_NAME} test <${files.length} files>`);
  // Never the foreground hand-off: the gate waits for the verdict itself, and
  // a handed-off run would exit before it had one.
  // The gate judges each failure against main itself (and prints main's
  // report for it): the run need not print its own standing lines too.
  const env = { ...process.env, ...envEntries({ TEST_NO_STANDING: "1" }) };
  unsetEnv("FOREGROUND_DEADLINE", env);
  const { exitCode } = await spawnPassthrough(
    [join(root, CLI_NAME), "test", ...files],
    { cwd: root, env },
  );
  if (exitCode === 0 || exitCode === TESTS_FAILED_EXIT) return { ran: true };
  return { ran: false, exitCode };
}

/**
 * `files` run at `commit`: `./equin test` in a throwaway detached checkout of
 * it, removed afterwards. Its harvest records each file under the digest of
 * that commit's code — exactly the key `judgeFailure` reads the merge base's
 * verdicts by, so the judgement then rests on the base itself.
 */
async function runAtCommit(
  root: AppPath,
  commit: string,
  files: readonly string[],
): Promise<{ ran: true } | { ran: false; exitCode: number }> {
  return withScratchCheckout(root, commit, (dir) => runTests(dir, files));
}

/**
 * The verdicts the runs since `before` recorded at exactly HEAD's tree: a run
 * the gate's `./equin test` led, or the identical in-flight run it joined
 * (whose leader writes the record). A run on any other tree — the checkout
 * edited mid-run, whose harvest is skipped anyway — is not this code's.
 */
async function newRunsAt(
  headTree: string,
  before: ReadonlySet<string>,
  mainSlug: string,
): Promise<VerdictIndex> {
  const records = await readTestRunRecords();
  return buildVerdictIndex(
    records.filter((r) => r.treeHash === headTree && !before.has(r.opId)),
    mainSlug,
  );
}

const opIdsOf = (records: readonly TestRunRecord[]): Set<string> =>
  new Set(records.map((r) => r.opId));

/** One failing file, judged, with its failing cases at HEAD. */
interface Failing {
  file: string;
  headCases: readonly string[];
  judgement: FailureJudgement;
  /**
   * Cases failing here that the merge-base run the gate made did not see fail
   * (the file failed there too) — set when that is what made it a suspect.
   */
  casesOnlyHere?: readonly string[];
}

/**
 * The push's test gate (see this plugin's CLAUDE.md): every test file whose
 * digest moved between the merge base with `main` and HEAD is run — unless a
 * proving pass is already recorded at its HEAD digest — and the push is
 * refused when one fails that did not already fail on main, and fails again
 * when run on its own.
 *
 * Runs on the committed HEAD of a clean tree, and refuses a dirty one: its
 * verdicts are about HEAD's tree and nothing else.
 */
export async function runTestGate(root: AppPath): Promise<TestGateResult> {
  const t0 = performance.now();
  if ((await git(root, ["status", "--porcelain"])) !== "") {
    console.error(
      "Push refused by the test gate: the checkout has uncommitted changes, so the tests would not run the code that lands.",
    );
    return { ok: false };
  }
  const mergeBase = await git(root, ["merge-base", "HEAD", "main"]);
  if (mergeBase === (await git(root, ["rev-parse", "HEAD"]))) {
    console.log("Test gate: nothing to land past main — no tests to run.");
    return { ok: true };
  }
  const headTree = await git(root, ["rev-parse", "HEAD^{tree}"]);

  const store = openRecordStore();
  const [headSnap, baseSnap] = await Promise.all([
    repoSnapshotNow(root),
    commitSnapshot(root, mergeBase),
  ]);
  // One after the other: both graphs share the store's file facts by blob.
  const head = flat(await testDigests(headSnap, store, testFilesOf(headSnap)));
  const base = flat(await testDigests(baseSnap, store, testFilesOf(baseSnap)));
  await store.flush();
  const affected = affectedTests(head, base);
  console.log(
    `Test gate: ${affected.length} of ${head.size} test files affected since the merge base ${mergeBase.slice(0, 10)} ` +
      `(digests in ${Math.round(performance.now() - t0)} ms).`,
  );
  if (affected.length === 0) return { ok: true };

  const mainSlug = mainNamespace();
  let records = await readTestRunRecords();
  const known = buildVerdictIndex(records, mainSlug);
  const toRun = affected.filter((f) => {
    const newest = known
      .at(f, head.get(f)!)
      .find((v) => v.outcome !== "not-loaded");
    return newest === undefined || !isProvingPass(newest);
  });
  const reused = affected.length - toRun.length;
  const knownMs = toRun.reduce((s, f) => s + (known.durationOf(f) ?? 0), 0);
  const untimed = toRun.filter((f) => known.durationOf(f) === null).length;
  console.log(
    `  ${reused} already passed at this exact code (a recorded run) — not run again.\n` +
      `  ${toRun.length} to run: ~${minutes(knownMs)} of test time` +
      (untimed > 0 ? ` plus ${untimed} never timed` : "") +
      ".",
  );
  if (toRun.length === 0) return { ok: true };

  const first = await runTests(root, toRun);
  if (!first.ran) return refuseUnrun(first.exitCode);
  const firstRun = await newRunsAt(headTree, opIdsOf(records), mainSlug);
  const missing: string[] = [];
  const failing: Failing[] = [];
  for (const f of toRun) {
    // `not-loaded`: the runner never reached the file (it crashed or
    // wedged first) — nothing ran at HEAD, so there is nothing to judge.
    const v = firstRun.at(f, head.get(f)!)[0];
    if (v === undefined || v.outcome === "not-loaded") missing.push(f);
    else if (v.outcome !== "passed")
      failing.push({
        file: f,
        headCases: v.failedCaseIds,
        judgement: judgeFailure(f, base.get(f), v.failedCaseIds, known),
      });
  }

  // A failure no verdict at the merge base's code settles (main's last run of
  // the file is about another digest, or there is none) is settled here:
  // the file runs at the merge base, then is judged again on that verdict.
  const unsettled = failing.filter((f) => !restsOnMergeBase(f.judgement));
  const unknownAtBase: string[] = [];
  if (unsettled.length > 0) {
    console.log(
      `\nTest gate: ${unsettled.length} failing file(s) have no recorded verdict at the merge base's code — ` +
        `running them at ${mergeBase.slice(0, 10)} in a scratch checkout, to tell whether this change broke them.`,
    );
    const atBase = await runAtCommit(
      root,
      mergeBase,
      unsettled.map((f) => f.file),
    );
    if (!atBase.ran) return refuseUnrun(atBase.exitCode);
    records = await readTestRunRecords();
    const withBase = buildVerdictIndex(records, mainSlug);
    for (const f of unsettled) {
      f.judgement = judgeFailure(
        f.file,
        base.get(f.file),
        f.headCases,
        withBase,
      );
      if (!restsOnMergeBase(f.judgement)) unknownAtBase.push(f.file);
      // A merge base the gate ran itself counts as "already failing" only if
      // it failed every case that fails here: its checkout is fresh (another
      // directory, a database forked from main's), so a failure there can be
      // its environment's, and a case failing only here is this change's
      // until it fails alone too.
      else if (
        f.judgement.kind === "pre-existing" &&
        f.judgement.newCases.length > 0
      )
        f.casesOnlyHere = f.judgement.newCases;
    }
  }
  const settled = failing.filter((j) => !unknownAtBase.includes(j.file));
  const suspects = settled.filter(
    (j) => j.judgement.kind === "new" || j.casesOnlyHere !== undefined,
  );
  const preExisting = settled.filter((j) => !suspects.includes(j));

  // Each suspect runs once more, ON ITS OWN (its own runner process): a
  // failure caused by another file's state leaking into the shared bun process
  // passes there. Both verdicts are recorded, so Debug → Tests shows it flaky.
  const confirmed: Failing[] = [];
  const batchOnly: Failing[] = [];
  if (suspects.length > 0)
    console.log(
      `\nTest gate: ${suspects.length} file(s) failed that did not already fail on main — running each again on its own to confirm.`,
    );
  for (const s of suspects) {
    records = await readTestRunRecords();
    const again = await runTests(root, [s.file]);
    if (!again.ran) return refuseUnrun(again.exitCode);
    const alone = (await newRunsAt(headTree, opIdsOf(records), mainSlug)).at(
      s.file,
      head.get(s.file)!,
    )[0];
    if (alone === undefined || alone.outcome === "not-loaded")
      missing.push(s.file);
    else if (alone.outcome === "passed") batchOnly.push(s);
    else confirmed.push(s);
  }

  console.log("");
  if (preExisting.length > 0)
    // Judged on every record so far — the merge-base run's included — so
    // its lines say what the gate decided.
    await printPreExisting(
      root,
      preExisting,
      base,
      buildVerdictIndex(await readTestRunRecords(), mainSlug),
    );
  if (batchOnly.length > 0)
    console.error(
      [
        "WARNING — failed in the batch but passed on its own: another file's state leaks into it. Not blocking, but",
        "if this change made a file leak state (a registry, a global, an env var), it breaks every batched run on main:",
        ...batchOnly.map((b) => `  ${b.file}`),
        "",
      ].join("\n"),
    );

  const noVerdict = [...new Set(missing)];
  if (
    confirmed.length === 0 &&
    noVerdict.length === 0 &&
    unknownAtBase.length === 0
  ) {
    console.log(
      `Test gate passed in ${minutes(performance.now() - t0)}: no affected test newly fails.`,
    );
    return { ok: true };
  }
  if (confirmed.length > 0)
    console.error(
      [
        "NEWLY FAILING — this change breaks these tests (failed in the batch and on their own, and did not fail on main):",
        ...confirmed.map((c) =>
          c.casesOnlyHere === undefined
            ? `  ${c.file}\n    ${describeJudgement(c.judgement)}`
            : [
                `  ${c.file}`,
                `    it fails at the merge base too, but not these ${c.casesOnlyHere.length} case(s), which fail here:`,
                ...c.casesOnlyHere.slice(0, 10).map((k) => `      ${k}`),
              ].join("\n"),
        ),
        "",
      ].join("\n"),
    );
  if (noVerdict.length > 0) {
    const edited = (await git(root, ["status", "--porcelain"])) !== "";
    console.error(
      [
        edited
          ? "NO VERDICT — the checkout was edited while the tests ran, so their results are not about the code that lands:"
          : "NO VERDICT — the test run recorded nothing for these files at this code (a runner that wedged or crashed,\n" +
            "or a harvest that failed — see the test output above); the push cannot tell they pass:",
        ...noVerdict.map((f) => `  ${f}`),
        "",
      ].join("\n"),
    );
  }
  if (unknownAtBase.length > 0)
    console.error(
      [
        `NO VERDICT AT THE MERGE BASE — these fail at this change, and running them at the merge base ${mergeBase.slice(0, 10)}`,
        "recorded nothing for its code (see the test output above), so the push cannot tell this change did not break them:",
        ...unknownAtBase.map((f) => `  ${f}`),
        "",
      ].join("\n"),
    );
  const blocking = [
    ...confirmed.map((c) => c.file),
    ...noVerdict,
    ...unknownAtBase,
  ];
  console.error(
    [
      `Push refused by the test gate. Reproduce with:`,
      `  ./${CLI_NAME} test ${blocking.join(" ")}`,
      ``,
      `Fix the change (or the test, if the change is intended — update what it asserts), then re-run ./${CLI_NAME} push.`,
      `Each failure above was judged against the merge base's own code (run there when no verdict was recorded):`,
      `one that fails there too is not refused. If main fixed it since, rebase onto main and push again; if you are`,
      `still sure a failure is not this change's, STOP and report it to the user — do not work around the gate.`,
    ].join("\n"),
  );
  return { ok: false };
}

/**
 * Failures that are not this change's doing — said loudly anyway, with main's
 * report (and task, if any) for each (`standingLines`, the same lines `./equin
 * test` prints), so a file that is red on main is never silently waved
 * through, and a case the evidence never saw fail is named.
 */
async function printPreExisting(
  root: AppPath,
  items: readonly Failing[],
  base: ReadonlyMap<string, string>,
  index: VerdictIndex,
): Promise<void> {
  const standing = await standingOnMain(
    root,
    items.map((i) => ({
      path: i.file,
      failedCaseIds:
        i.judgement.kind === "pre-existing" ? i.judgement.newCases : [],
    })),
    { index, baseDigests: base },
  );
  const lines = ["Not blocking:", ...standingLines(standing)];
  for (const i of items) {
    if (i.judgement.kind === "pre-existing" && i.judgement.newCases.length > 0)
      lines.push(
        `WARNING: ${i.file} — ${i.judgement.newCases.length} failing case(s) no run on main saw fail; check they are not this change's:`,
        ...i.judgement.newCases.slice(0, 10).map((c) => `  ${c}`),
      );
  }
  lines.push("");
  console.error(lines.join("\n"));
}

function refuseUnrun(exitCode: number): TestGateResult {
  console.error(
    `\nPush refused by the test gate: \`./${CLI_NAME} test\` could not run the affected tests (exit ${exitCode}) — see its output above.`,
  );
  return { ok: false };
}
