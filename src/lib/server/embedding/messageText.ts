import { sql } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"

/**
 * A message with something to embed: a character that is not whitespace. A
 * reply cut off before its first word (a crash, a failed run, a Regenerate
 * that cleared its text) has none, and embedding it is a paid call for no
 * text; some embedding APIs refuse empty input outright. So the queue never
 * embeds such a message nor counts it as waiting (`vectorizationQueue.ts`),
 * and it is never a retrieval candidate (`ragContext.ts`), whatever vector it
 * kept.
 *
 * A module of its own so the many tests that stand the queue in with a mock
 * still read the real rule.
 */
export const messageHasText = sql`${schema.sessionMessages.content} ~ '[^[:space:]]'`
