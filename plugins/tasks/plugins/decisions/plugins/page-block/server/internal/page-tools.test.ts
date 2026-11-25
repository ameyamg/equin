/**
 * `<task-decisions>` through the agent page tools: the same page read by the
 * agent whose task owns the decisions (one stub line) and by another agent
 * (every decision in full), both round-tripping through `edit_page` with the
 * block untouched; and a document minting one at a task that does not exist
 * refused with nothing written.
 *
 * Boots agent-access's portable closure plus this block (and the text block)
 * on PGlite, in a FRESH bun process (this file re-run as a child), as
 * agent-access's own `page-tools.test.ts` does, for its reason: a boot
 * registers its graph process-wide.
 *
 * Run: `./equin test plugins/tasks/plugins/decisions/plugins/page-block`.
 */

import { beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { sql } from "drizzle-orm";
import { bootTestHost } from "@plugins/framework/plugins/server-core/core/testing";
import {
  registryClosureOf,
  withPortableHost,
} from "@plugins/framework/plugins/browser-server/plugins/test-host/server/testing";
import { REPO_ROOT } from "@plugins/infra/plugins/paths/plugins/repo-root/core";
import { spawnCaptured } from "@plugins/infra/plugins/spawn/core";
import { HttpError } from "@plugins/infra/plugins/endpoints/server";
import { db } from "@plugins/database/server";
import { FALLBACK_MODEL } from "@plugins/conversations/plugins/model-provider/core";
import { pageTools } from "@plugins/page/plugins/annotations/plugins/agent-access/server";

setDefaultTimeout(300_000);

const IN_CHILD = process.env.TASK_DECISIONS_BOOT_CHILD === "1";

if (!IN_CHILD) {
  test("<task-decisions> through the page tools (in a fresh process)", async () => {
    const result = await spawnCaptured(
      [process.execPath, "test", import.meta.path],
      {
        cwd: REPO_ROOT,
        env: {
          ...process.env,
          TASK_DECISIONS_BOOT_CHILD: "1",
          BOOTS_OWN_PLUGIN_GRAPH: "1",
        },
        timeoutMs: 240_000,
      },
    );
    if (result.exitCode !== 0) {
      throw new Error(
        `task-decisions boot child exited ${result.exitCode}\n--- stdout ---\n${result.stdout}\n--- stderr ---\n${result.stderr}`,
      );
    }
    expect(result.exitCode).toBe(0);
  });
}

const OWNER_TASK = "task-1795560312-ownerx";
const OTHER_TASK = "task-1795560313-otherx";
const OWNER = "conv-1795560312-ownerx";
const OTHER = "conv-1795560313-otherx";
const DEC = "dec-1795560312-abcdef";
const text = (s: string) => ({ text: [{ text: s }] });

/**
 * PAGE (page)                 — "Session"
 * └── CARD <agent-inline>
 *     ├── TD   <task-decisions task=OWNER_TASK>
 *     └── LINE "Status: working."
 */
const ROWS = [
  {
    id: "PAGE",
    parent: null,
    page: null,
    type: "page",
    rank: "a0",
    data: { title: "Session", icon: null },
  },
  {
    id: "CARD",
    parent: "PAGE",
    page: "PAGE",
    type: "agent-note",
    rank: "a0",
    data: {},
  },
  {
    id: "TD",
    parent: "CARD",
    page: "PAGE",
    type: "task-decisions",
    rank: "a0",
    data: { taskId: OWNER_TASK },
  },
  {
    id: "LINE",
    parent: "CARD",
    page: "PAGE",
    type: "text",
    rank: "a1",
    data: text("Status: working."),
  },
];

async function seedTask(id: string, title: string, conversationId: string) {
  await db.execute(sql`
    INSERT INTO tasks (id, cluster_id, title, title_auto, rank, folder_id, created_at, updated_at, mandate_ref, author_kind)
    VALUES (${id}, ${id}, ${title}, false, ${id}, NULL, now(), now(), 'interactive', 'human')`);
  const attemptId = `att-${id.slice(5)}`;
  await db.execute(sql`
    INSERT INTO attempts (id, task_id, worktree_path)
    VALUES (${attemptId}, ${id}, ${`/tmp/${attemptId}`})`);
  await db.execute(sql`
    INSERT INTO conversations (id, attempt_id, status, runtime, model, launch_cause)
    VALUES (${conversationId}, ${attemptId}, 'working', 'sdk', ${FALLBACK_MODEL}, 'direct')`);
}

const textOf = async (conversationId: string): Promise<string> =>
  (await pageTools.read({ block_id: "PAGE" }, { conversationId })).content[0]!
    .text;

describe.if(IN_CHILD)("<task-decisions> through the page tools", () => {
  beforeAll(async () => {
    await bootTestHost({
      entries: await withPortableHost(
        registryClosureOf([
          "page/plugins/annotations/plugins/agent-access",
          "page/plugins/text",
          "tasks/plugins/decisions/plugins/page-block",
        ]),
      ),
    });
    await seedTask(OWNER_TASK, "Phase 5", OWNER);
    await seedTask(OTHER_TASK, "Supervisor", OTHER);
    await db.execute(sql`
      INSERT INTO decisions (id, task_id, opened_by_conversation_id, label, state, question, body, options)
      VALUES (${DEC}, ${OWNER_TASK}, ${OWNER}, 'D1', 'decision', 'Ship it?', 'Context.',
              ${JSON.stringify([{ key: "A", text: "Yes.", recommended: true }])}::jsonb)`);
    for (const r of ROWS) {
      await db.execute(
        sql`INSERT INTO page_blocks (id, parent_id, page_id, type, rank, data)
            VALUES (${r.id}, ${r.parent}, ${r.page}, ${r.type}, ${r.rank},
                    ${JSON.stringify(r.data)}::jsonb)`,
      );
    }
  });

  test("the owner reads one stub line; another agent every decision in full", async () => {
    const own = await textOf(OWNER);
    expect(own).toContain(
      `<task-decisions title="Phase 5" own="1 open, 0 closed" task="${OWNER_TASK}"/>`,
    );
    expect(own).not.toContain("<decision ");
    const other = await textOf(OTHER);
    expect(other).toContain(
      `<task-decisions title="Phase 5" task="${OWNER_TASK}">`,
    );
    expect(other).toContain(`<decision id="${DEC}" label="D1"`);
    expect(other).toContain("> Context.");
    expect(other).toContain('<option key="A" text="Yes." recommended="true"/>');
  });

  test("both projections round-trip through edit_page: only the edited line is written", async () => {
    for (const [conversationId, line] of [
      [OWNER, "Status: done."],
      [OTHER, "Status: reviewed."],
    ] as const) {
      const before = (await textOf(conversationId)).match(/Status: \w+\./)![0];
      const result = JSON.parse(
        (
          await pageTools.edit(
            {
              block_id: "PAGE",
              old_string: before,
              new_string: line,
              replace_all: false,
            },
            { conversationId },
          )
        ).content[0]!.text,
      );
      expect(result.created).toBe(0);
      expect(result.deleted).toBe(0);
      expect(result.text_edited).toBe(1);
      const td = (
        await db.execute<{ data: unknown }>(
          sql`SELECT data FROM page_blocks WHERE id = 'TD' AND deleted_at IS NULL`,
        )
      ).rows[0];
      expect(td?.data).toEqual({ taskId: OWNER_TASK });
      expect(await textOf(conversationId)).toContain(line);
    }
  });

  test("a document minting one at a task that does not exist is refused, nothing written", async () => {
    const refusal = await pageTools
      .edit(
        {
          block_id: "PAGE",
          old_string: "Status: reviewed.",
          new_string:
            'Status: reviewed.\n<task-decisions task="task-1795560399-nonexx"/>',
          replace_all: false,
        },
        { conversationId: OTHER },
      )
      .then(
        () => null,
        (err: unknown) => err,
      );
    expect(refusal).toBeInstanceOf(HttpError);
    expect((refusal as HttpError).message).toContain(
      "names no task that exists",
    );
    const counted = await db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM page_blocks WHERE type = 'task-decisions' AND deleted_at IS NULL`,
    );
    expect(counted.rows[0]?.n).toBe(1);
  });

  test("…and one naming a real task is minted", async () => {
    await pageTools.edit(
      {
        block_id: "PAGE",
        old_string: "Status: reviewed.",
        new_string: `Status: reviewed.\n<task-decisions task="${OTHER_TASK}"/>`,
        replace_all: false,
      },
      { conversationId: OTHER },
    );
    // The supervisor's own block reads as its stub.
    expect(await textOf(OTHER)).toContain(
      `<task-decisions title="Supervisor" own="0 open, 0 closed" task="${OTHER_TASK}"/>`,
    );
  });
});
