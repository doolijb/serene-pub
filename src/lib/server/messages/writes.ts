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
 * and `entries:create` are lorebook-scoped — a person at a book, with no
 * session in the request — and are deliberately **not** gated here: a genre
 * that declares `writes.lore: false` is saying its own machinery does not write
 * to the book, not that the book is read-only to its owner.
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
