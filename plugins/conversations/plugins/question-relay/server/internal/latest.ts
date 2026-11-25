import { and, desc, eq, lte, max } from "drizzle-orm";
import { db } from "@plugins/database/server";
import { _pendingQuestions } from "./tables";

const t = _pendingQuestions;

/**
 * When the user last answered one of this conversation's held questions, or
 * null when they never did — up to `asOf` when given (a resolved row is
 * swept after a week, so an older answer reads as none).
 */
export async function latestAnswerAt(
  conversationId: string,
  asOf?: Date,
): Promise<Date | null> {
  const [row] = await db
    .select({ at: max(t.resolvedAt) })
    .from(t)
    .where(
      and(
        eq(t.conversationId, conversationId),
        eq(t.state, "answered"),
        asOf === undefined ? undefined : lte(t.resolvedAt, asOf),
      ),
    );
  return row?.at ?? null;
}

/**
 * The questions of this conversation's newest held (`open`) AskUserQuestion
 * call, their text alone, or null while it holds none.
 */
export async function openQuestionsOf(
  conversationId: string,
): Promise<string[] | null> {
  const [row] = await db
    .select({ questions: t.questions })
    .from(t)
    .where(and(eq(t.conversationId, conversationId), eq(t.state, "open")))
    .orderBy(desc(t.createdAt))
    .limit(1);
  return row ? row.questions.map((q) => q.question) : null;
}
