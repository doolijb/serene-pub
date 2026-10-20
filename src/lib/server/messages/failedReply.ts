/**
 * 🚧 A **failed reply** (2026-10-16, Dungeon Crawler walk): a row whose run
 * failed — an error on it and no words. It is shown to people (with Retry),
 * but it is not something anybody said: no history read hands it to a
 * model, in any genre (`session-history@1`, the unplayed talk), and a
 * session card does not read past it to say "Waiting on the model". 🚧 Nor
 * does any history read a reply stopped before its first word
 * (`isEmptyReplySql`, the 100-turn walk's B19).
 *
 * A failed row that kept a partial is not one: those words were shown and
 * stand. Spelled in SQL so every read filters in the database.
 */
import { sql } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"

/** Nothing but whitespace for text. */
const blankSql = sql`btrim(coalesce(${schema.sessionMessages.content}, ''), ' ' || chr(9) || chr(10) || chr(13)) = ''`

/** True for a failed reply — an error, and nothing but whitespace for text. */
export const isFailedReplySql = sql<boolean>`(${schema.sessionMessages.error} is not null and ${schema.sessionMessages.error}::text <> 'null' and ${blankSql})`

/**
 * 🚧 True for a failed reply, or a reply **stopped before its first word**
 * (the 100-turn walk, B19: an empty "Narrator · Stopped" row went to the next
 * prompt as a bare `Narrator:` turn). Nobody said either. A stopped row
 * that kept words keeps them; a session card still says only a failure
 * failed (`isFailedReplySql`).
 */
export const isEmptyReplySql = sql<boolean>`(${isFailedReplySql} or (${schema.sessionMessages.generationOutcome} = 'stopped' and ${blankSql}))`

/** The window filter: every row that is not a failed reply nor an empty stopped one. */
export const notAFailedReplySql = sql`not ${isEmptyReplySql}`
