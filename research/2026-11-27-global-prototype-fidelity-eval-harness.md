# Prototype fidelity evals: measuring whether a primitive change makes agents implement prototypes better

Status: design only (task-1795733810-dejxg4). Nothing here is built. An independent review of a first draft found four blockers; this version is the design after them, and "Review findings" at the end says what changed. Open decisions close the doc.

## Context

The user wants to stop reviewing agent-made UI. Today nothing says whether a change to the CSS/layout primitives, or to their docs and skills, makes agents produce UI closer to the approved prototype. The spacing work of 2026-11-09 ([surface-owned inset](2026-11-09-global-surface-owned-inset.md)) changed primitives for five days on belief, needed 3-4 human review rounds per slice, and ended with results the user called uglier.

The goal is an experiment loop: a fixed set of prototypes, agents implementing each from a tree that holds no implementation of it, one variable changed (the primitives), the same prompts rerun, and a comparison the user can read without looking at every screen.

What exists and is reused:

| Piece | Where | Used for |
|---|---|---|
| Prototypes: 212 on this host, 101 declaring a `mocks` counterpart, outside git with their own history | `~/.equin/apps/prototypes/<id>/`, [`prototypes/CLAUDE.md`](../prototypes/CLAUDE.md) | The reference of a case |
| `compare-diff`: pixel ratio, colour ΔE, per-part computed-style metrics from a mapping file | `plugins/apps/plugins/prototypes/plugins/compare/e2e/` | The base of the scorer |
| An attempt's worktree reuses an existing `claude-web/<attemptId>` branch | `worktree.ts` (`attemptBranchExists`) | Starting a run from a prepared commit |
| Scratch profiles: a directory, its own MCP tool list and permissions, set by the launcher | `plugins/conversations/plugins/workspace` | The isolated run of section 2 |
| Automations: prompt template, pinned model, `push: never`, outcome report | `plugins/tasks/plugins/automations` | Launching and collecting a run |
| Per-conversation tokens and cost | `conversations_ext_usage` | The cost signal |
| `runs` union (`liveArm`), before/after viewer | `plugins/runs`, `plugins/conversations/plugins/before-after` | Listing runs, viewing pictures |

What does not exist: a launch from a declared base (`setupWorktree` writes `from: "main"`), a stored compare result (compare-diff writes files to `--out`), a single score, a record of repeated runs of one prompt, an LLM judge (`sidequests/ui-mastery` lists "can agents judge UI" as open, Phase 0).

Measured cost of the real thing, for scale: the six sessions that implemented or polished prototypes on 2026-11-26 cost $13.8 to $29.7 each on opus-5-5 (0.5-1.4M fresh tokens, 42-87M cache-read). Mail (`proto-1795656296-rtsmk5`) took four of them, about $75, and its seven commits touched 267 files outside `plugins/apps/plugins/mail/`.

## 1. What a test case is

A case is a directory in the fidelity data dir on the host, **outside git**, with its own history (as prototypes are). No part of a case is in any tree an agent works in, except what the harness copies in for a run. It holds:

- **`prototype/`**: a frozen copy of the prototype at one version. The harness installs it into the prototype store under the case's own id for the duration of a run, with `mocks` pointing at the case's route. Later edits to the original never change the case.
- **`case.json`**: the `captures` (width, state, option picks, colour scheme; a region case names the part that bounds the capture), the `split` (section 6), the `kind` (below) and the `source` (a report, a conversation, a prototype id).
- **`fixtures.ts`**: typed data per state (`default`, `empty`, `loading`, `long-content`, …), extracted from the prototype's inline data. The implementation renders from this alone: no server, no live resource.
- **`skeleton/`**: a plugin with the app and route registered, the fixtures imported and an empty screen component taking `{ data, state }`. Copied into the tree before the run, so no run spends tokens on registration or fails on scaffolding.
- **`parts.json`**: the scoring key, never shown to the agent. Per part: a name the case chooses, the mock's selector, the properties and tolerances.
- **`prompt.md`**: the fixed prompt: the prototype id, the skeleton, the states, and the part names with a one-line description each, which the implementation tags with `data-fidelity-part`. It says nothing about primitives. A run records its hash.

**Two kinds of case**, which differ only in what has to be hidden:

- **`unbuilt`**: a prototype nothing in the repo implements. Nothing to hide, so it runs in an ordinary worktree. This is the default: the pilots, most dev cases and every held-out case.
- **`landed`**: a real failure, whose implementation is on main. It needs the isolated run of section 2.

**A real-world failure becomes a case** through one case-authoring agent launched by the design supervisor from the user's report (a prototype id and the route that does not match):

1. Freeze the prototype version; extract the fixtures; write `parts.json` and the skeleton.
2. Work out the scrub list (section 2).
3. Validate mechanically: every mock selector resolves; the skeleton builds; the empty skeleton scores 0; the landed implementation, rendered from the fixtures where that is possible, scores what the user's complaint predicts on the parts they named.
4. **Reproduce**: run the baseline (k runs, section 5). If baseline agents now match the prototype on those parts, the failure does not reproduce on today's main, and the report says so instead of inventing a fix.

Step 4 is not extra cost: those runs are arm A of the experiment that follows.

## 2. Running both arms from a tree without the implementation

**An arm is a commit.** For each (arm, case) the harness makes one:

```
arm A = T              + skeleton        T = main at the experiment's start
arm B = T + patch      + skeleton        patch = the primitive / doc / skill change under test
```

For an `unbuilt` case this is a normal child of T. The harness creates the run's `claude-web/<attemptId>` branch at it before the launch, and the launch checks that branch out. That path exists today as crash recovery; it becomes a declared input of the worktree workspace (`{ kind: "worktree", base }`), and a declared base skips the spare-checkout pool. `merge-base HEAD main` is T, so build, format and checks work unchanged.

**Why the comparison is unbiased:**

- The arms differ by the patch and nothing else: same case version, prompt hash, skeleton and pinned model *version* (a family resolves at spawn).
- One interleaved batch (A, B, A, B, …), so host load and a silent model change hit both alike.
- The inputs outside git (composed system-prompt append, config overrides, preprompt) are hashed per run. A batch whose runs disagree on the hash is refused.
- The scorer runs from the harness's own pinned checkout against the run's URL, never from the arm's tree, so a patch cannot change how it is scored.

**`landed` cases: what has to go, and why a guard is not enough.** The user's constraint is that the rerun agent never sees the submitted implementation: its code, its history, or it as precedent. Read against the repo, the implementation is reachable through more routes than its plugin folder:

| Route | Example for Mail |
|---|---|
| The app's own files, config and theme | `plugins/apps/plugins/mail/**`, `config/apps/mail/**`, its theme |
| Docs that describe or cite it | `research/*mail*`, "used by `apps/mail`" lines in generated plugin docs |
| History and every other ref of the shared object store | `git log`, `git show main:…`, `git cat-file` |
| Other checkouts on the same disk | sibling worktrees, the main checkout |
| The running app on main, main's DB, the run's own forked DB (tasks, transcripts) | a browser tool photographing real Mail; `query_db` |
| The network | the public repository |

A PreToolUse guard shipped in the tree cannot close these: the matcher does not cover the app's own MCP tools, the agent can edit a guard in its checkout, and a broken guard falls back to main's. So a `landed` run does not use a worktree at all:

- **The run is a scratch workspace** (a `fidelity-run` scratch profile). Its directory is an export of the arm's tree with the scrub list removed, as a fresh repository of one commit: no history and no shared object store.
- **Its tools are the profile's**, set by the launcher and not editable by the agent: no `query_db`, no page or transcript reads, no web fetch, and browser tools bound to the run's own build.
- **A contamination audit** runs after every run anyway: the transcript is scanned for scrubbed paths, for symbols unique to the scrubbed files, and for any path outside the run directory and the prototype store. A contaminated run is discarded, counted and reported, never scored. The audit is the answer to the one route a profile cannot remove, which is the rest of the disk.

The open engineering question is the build: a scratch directory has no DB fork and no build today. A UI-only case needs no server, so the candidate is a hermetic build of a small composition holding the case's skeleton, served statically. Whether that works is the first spike (build order, step 3). `landed` cases wait for it; `unbuilt` cases do not.

**Primitives shaped by the failed implementation stay.** Mail's sessions also changed `Row`, the DataView list and the overlay tokens. Those are main's primitives now, and "does this patch help agents on today's main" is the question, so they stay in both arms. The price is stated on the case: it is marked `shaped`, it can only ever be a dev case, and a baseline that now passes it is reported as "already fixed on main". To ask the historical question instead (did the primitives of that day cause the failure), the same case runs with T set to the parent of the first commit citing the prototype; no patch written today applies there, so that mode only reproduces.

**Rerun both arms now, or compare with an old recorded run?** Rerun both. An old run differs from a new one by the model (an alias moves; a version can change behind its id), by a hundred commits of repo drift and by the system prompt. Each can exceed the effect of a primitive change, and none can be subtracted afterwards. Recorded runs serve two purposes only:

- **Screening.** While the supervisor iterates on one patch, an A run is reused when its key matches exactly (tree hash, case version, prompt hash, model version, system-prompt hash). A screening result is labelled as such.
- **Trend.** The baseline score over weeks is a chart.

A verdict always comes from a fresh interleaved batch.

## 3. UI-only implementations instead of full ones

Every eval run is UI-only: one screen or region, rendered from `fixtures.ts` in the skeleton. Expected cost per run is $5-12 against $14-30 for a real session; the pilot measures it.

**Why it should give the same verdict.** The failures the user reported are in the view layer: insets, gaps, which primitive was picked, type, colour. Logic reaches the picture only through states, and the fixtures carry the states.

**What it gets wrong.** An agent with no logic to write spends all its attention on the picture, so UI-only scores are higher than real ones. An absolute UI-only score is therefore never read as "how good agents are". Only differences between arms are.

**That UI-only predicts full is an assumption until tested**, and every report says so until it is. Two tests, in order of cost:

1. **Against real work, at no agent cost.** Section 7 records a fidelity reading for every real prototype implementation. When a patch lands, the eval predicted a direction; the readings before and after either agree or not. This accumulates slowly and is confounded by everything else that lands, so it can refute the proxy but not prove it.
2. **A direct calibration.** One case, full implementation (real plugin, seeded data) against UI-only, baseline against the control arm of section 5, with the number of runs sized from the measured noise. It is run once the noise is known, if its cost is then acceptable (open decision 3).

If either disagrees, UI-only is dropped for that kind of case and those cases run as full implementations.

## 4. Scoring without the user

Each run produces four numbers.

**Fidelity F (primary).** The part-metrics pass of compare-diff, once per capture, with three changes it needs first:

- A mapping may name its own parts. Today the names are the closed list `DATA_VIEW_PARTS` plus two pane parts, so only a DataView screen can be scored.
- A part missing in the app scores 0 on all its properties. Today it ends the run with no metrics file.
- Only `data-fidelity-part`, which the agent places, is read. `data-part` is emitted by the primitives themselves, so scoring on it would measure "used DataView" and would move whenever a redesign renames an attribute.

F is the share of (part, property) checks within tolerance, averaged over captures. Box position and size are among the properties, so tagging the wrong element fails. The pixel ratio and the colour ΔE are recorded beside F.

**Judge preference J (blind, tag-independent).** A fresh agent on a pinned model gets the mock's picture and two unlabelled pictures, one run from each arm, sides randomised, same capture. It answers which is closer to the reference, or a tie, with the differences it used. J is the share of pairings an arm wins. It is pairwise and reference-based because an absolute "is this good" from a model is unvalidated here. Two checks run with every batch: the same pair with sides swapped must give the same answer, and A-against-A pairs must come out near 50%. J does not depend on tags, so it catches a run that games F.

**Escapes E.** A scan of the run's diff by the harness, independent of the arm's lint rules (which the patch may change): arbitrary-value classes, inline `style`, raw CSS declarations, `eslint-disable` comments, new `exempt/` entries. E is how much the agent wrote around the primitives.

**Cost C.** Fresh and cache-read tokens, dollars, turns, builds, wall time.

**One-shot or iterating: both, in one protocol of two fixed messages.**

1. The case prompt. The agent works as a real one does, with everything in its tree, including compare-diff's pixel and colour passes against the prototype. It does not have `parts.json`. When its turn ends the harness scores the build: **F₁, the first-submission score**. This is what the user meets in a review today, and it is the primary outcome.
2. The harness sends its parts report (which parts and properties are off) with a fixed instruction, for at most two rounds. The final score is **F₂**, and the rounds needed replace "3-4 human review rounds" as a measured quantity.

**The verdict** is fixed before the batch runs:

- One statistic: the mean paired difference in F₁ across dev cases, tested by permuting arm labels within each case.
- *Better*: that difference is above the noise bound, E is not above its own bound, and J has the same sign.
- *Worse*: the difference is below the negative bound.
- *Within noise*: everything else. Most small changes will land here, and that is a result: the change is not supported by evidence.
- Per-case numbers are shown as description. They do not gate, because three or five per-case tests would call a null patch worse by chance.

A prototype is free and may ask for what the tokens cannot say (a 13px gap on a 12/16 ramp). The parts report names those properties, and the supervisor sorts them into "the vocabulary cannot express it" and "the primitive is missing or misdocumented". The scorer reads only computed styles and the agent's own tags, so it knows nothing about the current primitives and a from-scratch redesign is one more patch.

## 5. Noise, sample size and the pilots

How much F varies between two runs of the same arm is unknown, and every bound above depends on it. So the first experiment changes nothing.

**Pilot 1: A against A.** 3 `unbuilt` cases × 8 baseline runs, UI-only, one feedback round. It needs only the scorer and the ledger, not the isolated run.

- It measures: the spread of F₁, F₂ and E per case; the noise bound for a difference between two arms of k runs (by resampling k-against-k from the 8); the judge's A/A rate and swap consistency; the real cost per run; how many runs fail for harness reasons.
- It decides k for a chosen minimum detectable effect. If k would exceed about 6, the fix is in the cases (more parts, more captures, a tighter prompt), not more runs.
- Eight runs per case, because four give three ways to split into two arms, which is not a distribution, and a spread known only within a factor of three.
- Cost: 24 runs at $5-12 is $120-290, plus three case-authoring sessions ($15-30) and judging (under $15). **About $150-335.** The per-run figure is an estimate from real sessions with the logic taken out.

**Pilot 2: a control with a known sign.** A harness that cannot see a change known to hurt cannot be trusted on one hoped to help. The control patch scrambles the spacing ramp (each named step given another step's value): an agent that trusts the tokens gets the wrong gaps (F down), and one that notices and works around them writes raw values (E up). Either is a detection. 2 cases × k runs per arm in a fresh interleaved batch, about $50-150. An arm with the `css` skill and the primitive docs removed runs beside it as a question, not a control: nobody knows its sign, and the answer says how much the docs matter.

Only then does a real primitive change run: `cases × k × 2 arms × cost per run`, about $120-290 for 3 dev cases at k = 4.

With three cases, a result holds for those cases. The set has to grow before a result says something about agents in general.

## 6. Not overfitting the primitives to the test prototypes

- **Split.** A case is `dev` or `held-out`. The supervisor designs against dev cases and reads their parts reports. A held-out case reports only its aggregate, never the parts.
- **Held-out cases stay out of sight.** They live in the data dir, and their prototype is installed in the store only while their runs are in flight. The tree the patch is designed in never holds them.
- **Held-out is spent.** One held-out evaluation per patch line, at the end, however many candidates came before it. A held-out case that has been read three times becomes a dev case.
- **Fresh cases keep arriving.** Unbuilt prototypes are the supply for held-out. A real failure enters as dev (it is `shaped` or soon will be).
- **The patch is checked for the answer.** A patch whose docs or code contain a case's prototype id, part names or fixture strings is refused.
- **The last line is real work**: section 7's reading over prototypes no primitive was tuned for.

## 7. Where runs are recorded and how a comparison is read

A new sub-plugin, `plugins/apps/plugins/prototypes/plugins/fidelity/`, beside `compare`:

- `cases`: the case format and its store in the data dir.
- `runs`: the ledger. One row per run: experiment, case and version, arm and tree hash, prompt hash, model version, system-prompt hash, conversation and attempt, F₁, F₂, rounds, E, cost, status (`scored | contaminated | failed`). The captures, the metrics JSON and the run's diff are attachments, so the workspace can be reaped. Contributed to the Runs list as a `liveArm`.
- `scoring`: the scorer (compare-diff's passes, writing rows instead of files), the escapes scan, the contamination audit, the judge.
- `experiments`: an experiment is a batch with a verdict. Its pane in the Prototypes app is a DataView of case × arm (mean, spread, difference, and one verdict chip for the experiment). A row opens the pictures (the mock, A's runs, B's runs) and the parts that moved.
- `in-the-wild`: a reading of real work, below.

The design supervisor is a supervisor role with a prompt that fixes the order: reproduce, patch, screen on dev, fresh batch, one held-out evaluation, report. The user reads one outcome report per experiment: the verdict, the two or three pictures that show it, the cost.

**The in-the-wild reading.** A real implementation renders live data, has no fixtures, no tags and no `parts.json`, so F cannot be computed on it. What can be, with no authoring: when a session that cites a prototype with a `mocks` counterpart ends a turn with a build, the harness photographs the mock and the session's own build and asks the calibrated judge for the list of mismatches, ignoring differences in data. The count at the first such turn is the session's first-submission reading; the count at the push is the final one. This costs a judge call per turn, and nothing is run twice.

## 8. What "trust" means

Two measured conditions.

**The judge agrees with the user.** The user labels blind pairs ("which is closer to the mock"), ten at the end of each experiment report, drawn from arms that differ (baseline against control, baseline against a patch) and including the screens they called uglier. The judge is trusted when, over at least 100 labelled pairs that are not ties, the lower 95% bound of its agreement is at least 80%. Until then every verdict still ranks arms, but none is a reason to skip a review. Disagreements are the next work item.

**Agents pass in the wild.** A threshold τ is the first-submission mismatch count of sessions the user accepted without a comment. The user stops reviewing prototype implementations when the last 10 consecutive real sessions were at or under τ on their first submission. After that:

- The user audits a random 1 in 5. A rejected audit becomes a case and restarts the count.
- A session over τ files a report to the design supervisor by itself, in place of the user noticing.

**What this does not cover.** Fidelity to a prototype is not beauty. A screen with no prototype, and a primitive migration that moves existing screens (last week's failure), have no reference here. The second has a cheap one, the screen before the change, and belongs to a screenshot-regression gate over exhibits: a separate design.

## Build order (when approved)

1. Scorer changes (own part names, missing part scores 0, `data-fidelity-part`), the ledger, the case store. A declared `base` on the worktree workspace.
2. Three `unbuilt` cases; pilot 1. Judge with its two checks; pilot 2.
3. Spike: a hermetic, statically served build inside a scratch directory. Then the `fidelity-run` profile, the scrub and the audit; the first `landed` case (Mail).
4. Experiments pane and the supervisor role; the first real patch.
5. The in-the-wild reading and τ.

Checks of the harness itself: the empty skeleton scores 0; a run that reads a scrubbed path is caught by the audit; A against A reports "within noise"; the control patch is detected.

## Review findings and what changed

An opus agent reviewed the first draft against the code. Verified and fixed in this version:

- F could not be computed: part names are a closed DataView list, a missing part aborts the run, and `data-part` is emitted by primitives (section 4's three scorer changes; the scorer now runs from the harness's checkout).
- An orphan commit has no merge-base with main, which build, format and push require; and a base override has to skip spare checkouts (section 2: a normal child of T for `unbuilt`, a scratch export for `landed`).
- A mask could not remove a landed implementation (267 files outside the app for Mail, docs citing it, dev cases stored in the repo), and a guard in the tree could not deny the app's MCP tools or the network and could be edited (cases moved out of git; `unbuilt` as the default kind; the scratch profile and its tool list; `shaped`).
- The statistics did not hold at four runs, per-case gates multiplied false alarms, and E had no bound (section 5; one pre-registered statistic).
- The docs-removed arm had no known sign (now a question; the control is the scrambled ramp).
- Pushes cannot show a first submission, and F cannot be computed on a real app (section 7's judge reading at turn ends).
- Thirty labels cannot support a 90% claim (section 8).
- Held-out cases were visible in the store and reused per candidate (section 6).

## Open decisions

1. **Pilot budget.** Pilot 1 (about $150-335) and pilot 2 (about $50-150). Recommended: both.
2. **`landed` cases.** They need the scratch-profile run, whose build is unproven (build order, step 3). Recommended: start with `unbuilt` cases only and spike in parallel. The alternative is to accept worktree runs with the audit alone for `landed` cases, which is weaker than the constraint asks.
3. **Direct calibration of UI-only against full implementations.** Its cost depends on the measured noise; a full run is about $14-30. Recommended: decide after pilot 1.
4. **Model.** Evals pin the model real work uses (opus-5-5 today). An upgrade invalidates the noise bound, so pilot 1 is rerun on each one. Recommended: accept.
5. **Which prototypes are the first three cases.** They should be unbuilt, approved, and differ in kind (a DataView screen, a form, a free page). The user knows which of the 212 are worth building.
6. **The user's labels** (ten pairs per report, to 100). The only step that needs the user. Without it the harness ranks arms but cannot justify dropping a review.
7. **Compare-diff in message 1.** Left available, as real agents have it. The alternative is to remove it for a pure one-shot score.
