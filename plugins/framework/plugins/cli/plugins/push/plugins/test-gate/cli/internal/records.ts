import { join } from "node:path";
import { readdir, readFile } from "@plugins/packages/plugins/timed-fs/core";
import {
  TEST_RUN_RECORD_VERSION,
  TestRunRecordSchema,
  testRunRecordOpId,
  type TestRunRecord,
} from "@plugins/framework/plugins/cli/plugins/test/plugins/record/core";
import { testRunRecordsDir } from "@plugins/framework/plugins/cli/plugins/test/data-dirs";

/**
 * Every harvested test run on this host (the `test-runs` dir, 14 days). A
 * record of another version is skipped — a newer writer's, left for a newer
 * reader, exactly as the Debug → Tests ingest does. A file that is not a
 * record (truncated, malformed) is named on stderr and left out.
 */
export async function readTestRunRecords(): Promise<TestRunRecord[]> {
  const dir = testRunRecordsDir.path;
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const unreadable: string[] = [];
  const records = await Promise.all(
    names
      .filter((name) => testRunRecordOpId(name) !== null)
      .map(async (name): Promise<TestRunRecord | null> => {
        let raw: string;
        try {
          raw = await readFile(join(dir, name), "utf8");
        } catch (err) {
          // Pruned between the listing and the read: no record.
          if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
          throw err;
        }
        let json: unknown;
        try {
          json = JSON.parse(raw);
        } catch (err) {
          if (!(err instanceof SyntaxError)) throw err;
          unreadable.push(name);
          return null;
        }
        if (
          typeof json === "object" &&
          json !== null &&
          (json as { v?: unknown }).v !== TEST_RUN_RECORD_VERSION
        )
          return null;
        const parsed = TestRunRecordSchema.safeParse(json);
        if (!parsed.success) {
          unreadable.push(name);
          return null;
        }
        return parsed.data;
      }),
  );
  // Said, never silent — and never fatal: one truncated file in the shared
  // dir must not refuse every push on the machine. A record the gate needs
  // (its own run's) that is unreadable reads as NO VERDICT, which refuses.
  if (unreadable.length > 0)
    console.error(
      `test gate: ${unreadable.length} unreadable test-run record(s) in ${dir} ignored (truncated or not a record): ${unreadable.slice(0, 5).join(", ")}`,
    );
  return records.filter((r): r is TestRunRecord => r !== null);
}
