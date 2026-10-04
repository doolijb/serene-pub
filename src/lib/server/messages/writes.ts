/**
 * Declared writes (R-B, ruled 2026-09-17): what a session of a genre may write
 * **beyond messages**. Core owns the mechanics; the genre declares
 * availability; the check happens server-side at the write — the same doctrine
 * `verbs.ts` applies to message verbs, applied to the two writes a session
 * makes into a lorebook.
 *
 * Before this, a genre said `lorebook: optional | required` and nothing about
 * whether sessions of it may *add* to that book, so the answer was whichever
 * specs a preset happened to bind — and a user-attached pipeline or a plugin
 * hook could start rewriting a character's lorebook mid-game. A genre whose
 * book is a reference (a rulebook, a docs set) now says so, and nothing a
 * session runs can talk its way past it.
 *
 * ## The lever is about what a SESSION does
 *
 * Only the session-scoped write paths are gated. `narrativeGraph:applyProposal`
 * and a bare `entries:create` are lorebook-scoped — a person at a book, with no
 * session in the request — and are deliberately **not** gated here: a genre
 * that declares `writes.lore: false` is saying its own machinery does not write
 * to the book, not that the book is read-only to its owner. An
 * `entries:create` that names the session it writes from (`sessionId`, a
 * summarize's save) IS a session write, and asks `sessionLoreWrite` below.
 *
 * ## Absent is on, and a failed read refuses nothing
 *
 * Absent, unknown or unreadable resolves to **both on** — the standard chat's
 * posture (F29): a policy resolution that fails must never block behaviour a
 * genre never restricted. Only an explicit `false` takes a write away.
 *
 * ⚠ The shape is read as `unknown` and the policy resolved here rather than
 * imported from `@serene-pub/sdk`, exactly as `verbs.ts` reads `messageVerbs`.
 * What arrives is a stored registry row's JSON, not a typed declaration, and
 * keeping the reader local is also what lets core compile against an SDK that
 * has not been rebuilt yet.
 */

import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { sessionReadingOf } from "$lib/server/state/reading"
import { sessionLoreWriteMode } from "$lib/server/state/loreWriteMode"
import { LORE_WRITES_OFF } from "$lib/shared/lorebooks/loreWriteMode"
import {
	nextStoryDate,
	type StoryCalendar
} from "$lib/shared/lorebooks/storyDate"
import type { StoryNow } from "$lib/server/state/storyTime"

/** Availability of every switchable session write. */
export interface SessionWritePolicy {
	lore: boolean
	scenes: boolean
}

const WRITES = ["lore", "scenes"] as const

export function resolveWrites(shape: unknown): SessionWritePolicy {
	const declared =
		shape && typeof shape === "object"
			? ((shape as any).writes ?? null)
			: null
	if (!declared || typeof declared !== "object")
		return { lore: true, scenes: true }
	return Object.fromEntries(
		WRITES.map((w) => [w, declared[w] !== false])
	) as unknown as SessionWritePolicy
}

/**
 * The genre behind a session, as far as a policy read cares: its display name
 * and its shape, or `null` when there is nothing to restrict by.
 *
 * Lazily imported for the same reason `verbs.ts` does it — this module is
 * reached from the host and from socket handlers, and `sessionGenres` reads
 * the type registry.
 */
async function sessionGenre(
	db: Db,
	sessionId: number
): Promise<{ name: string; shape: unknown } | null> {
	const [session] = await db
		.select({ genreId: schema.sessions.genreId })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	if (!session?.genreId) return null
	const { getSessionGenre } = await import(
		"$lib/server/pipelines/entities/sessionGenres"
	)
	const genre = await getSessionGenre(db, session.genreId)
	if (!genre) return null
	return { name: genre.name, shape: genre.shape }
}

/**
 * Refusal sentence when this session's genre keeps its lorebook as reference,
 * else `null`. Best-effort on the reads (the F29 posture above).
 */
export async function loreWriteRefusal(
	db: Db,
	sessionId: number
): Promise<string | null> {
	try {
		const genre = await sessionGenre(db, sessionId)
		if (!genre) return null
		if (resolveWrites(genre.shape).lore) return null
		return (
			`This session's genre ('${genre.name}') keeps its lorebook as ` +
			`reference — nothing a session does writes to it.`
		)
	} catch {
		return null
	}
}

/**
 * Refusal sentence when this session's genre opens no scenes, else `null`.
 * Same posture as `loreWriteRefusal`.
 */
export async function sceneWriteRefusal(
	db: Db,
	sessionId: number
): Promise<string | null> {
	try {
		const genre = await sessionGenre(db, sessionId)
		if (!genre) return null
		if (resolveWrites(genre.shape).scenes) return null
		return `This session's genre ('${genre.name}') does not open scenes.`
	} catch {
		return null
	}
}

/** A session write refused, as a sentence a person can read. */
export class SessionWriteRefusal extends Error {}

/**
 * The refusal sentence when the book owner's lore write mode is **Off** for
 * this session's book (plan A22), else `null` — asked beside
 * `loreWriteRefusal` by every session write that saves into the book.
 */
export async function loreWritesOffRefusal(db: Db, sessionId: number): Promise<string | null> {
	return (await sessionLoreWriteMode(db, sessionId)) === "off" ? LORE_WRITES_OFF : null
}

/**
 * Where a session's write into its lorebook lands, once it may write at all.
 */
export interface SessionLoreWrite {
	sessionId: number
	lorebookId: number
	/** The session's line: a branch session writes its branch. Null is main. */
	branchId: number | null
	/**
	 * Where the session's story stands (`sessionStoryNowOf`): its own clock,
	 * else its line's present. Null when nothing on its line is dated.
	 */
	storyNow: StoryNow | null
}

/**
 * 🚧 **A session write into its lorebook**: may this session write the book,
 * and where does the row land (plan A12). Every session-originated book write
 * that names its session asks here first — today a summarize's saved lore and
 * the history entry it files a scene under (`entries:create` with
 * `sessionId`).
 *
 * Refused, in a sentence (`SessionWriteRefusal`), when the session is not the
 * writer's own — a guest does not write the host's book — when it does not
 * read this book, when its genre keeps its book as reference
 * (`loreWriteRefusal`), and when the book owner's **lore write mode** is Off
 * (plan A22). Full and Review changes both save: these writes come from a
 * review screen, and the screen IS the review.
 *
 * The row lands where the session reads: on its line — never main for a
 * branch session, which would leak the branch's story onto every line — and,
 * when it is dated, at the session's story now (`historyDateOfSessionWrite`).
 */
export async function sessionLoreWrite(
	db: Db,
	{
		sessionId,
		userId,
		lorebookId
	}: { sessionId: number; userId: number; lorebookId: number }
): Promise<SessionLoreWrite> {
	const [session] = await db
		.select({
			userId: schema.sessions.userId,
			lorebookId: schema.sessions.lorebookId
		})
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	if (!session) throw new SessionWriteRefusal("That session no longer exists.")
	if (session.userId !== userId)
		throw new SessionWriteRefusal(
			"Only the session's owner can save lore from it."
		)
	if (session.lorebookId !== lorebookId)
		throw new SessionWriteRefusal("That session does not read this lorebook.")
	const noLore = await loreWriteRefusal(db, sessionId)
	if (noLore) throw new SessionWriteRefusal(noLore)
	const offRefusal = await loreWritesOffRefusal(db, sessionId)
	if (offRefusal) throw new SessionWriteRefusal(offRefusal)

	// Lazily, like `sessionGenre` above: the story-time reader reaches the
	// book's calendar and clocks, and this module is imported by the host.
	const { sessionStoryNowOf } = await import("$lib/server/state/storyTime")
	const reading = await sessionReadingOf(db, sessionId)
	return {
		sessionId,
		lorebookId,
		branchId: reading?.branchId ?? null,
		storyNow: await sessionStoryNowOf(db, sessionId)
	}
}

/**
 * The date a history entry filed by a session write is given: the session's
 * story now — its own clock, or its line's stored clock, time of day dropped
 * because entries are dated by day. When the line's present is only its
 * newest history entry, the new one is the step after it (`nextStoryDate`,
 * rolled over by the book's calendar); a line with no dates at all starts at
 * Year 1, Month 1, Day 1.
 */
export function historyDateOfSessionWrite(
	write: Pick<SessionLoreWrite, "storyNow">,
	calendar?: StoryCalendar | null
): { year: number; month: number | null; day: number | null } {
	const now = write.storyNow
	if (!now) return { year: 1, month: 1, day: 1 }
	const date = {
		year: now.year,
		month: now.month ?? null,
		day: now.month != null ? (now.day ?? null) : null
	}
	return now.from === "history" ? nextStoryDate(date, calendar) : date
}
