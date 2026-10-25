/**
 * 🚧 **The book lock** (owner ruling 2026-10-21, PLAN-lorebook-kinds §A): a
 * session's lorebook is fixed once play has written. Until then it may be
 * chosen, switched or removed — and a book taken before play also gives the
 * session its Rules, as choosing it at creation does.
 *
 * Why: a session's notes (the phantom) are written against the book they
 * overlay. Moving them onto another book (as `phantomLorebookFor` would on a
 * switch) lays one book's changes over a book they were never made against.
 *
 * **Play has written** = a message that is not a greeting, on any channel, or
 * anything in the session's notes. Greetings do not count: a session posts
 * them when it is made, before anyone has played.
 *
 * The refusals are worded for what the person can do next (ruling 7).
 */
import { and, eq, sql } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { phantomOf } from "$lib/server/lorebooks/phantom"

/** The session has a line of play, or its notes hold something. */
export async function playHasWritten(db: Db, sessionId: number): Promise<boolean> {
	const m = schema.sessionMessages
	const [line] = await db
		.select({ id: m.id })
		.from(m)
		.where(
			and(
				eq(m.sessionId, sessionId),
				sql`coalesce(${m.metadata}::jsonb ->> 'isGreeting', '') <> 'true'`
			)
		)
		.limit(1)
	if (line) return true
	const notes = await phantomOf(db, sessionId)
	if (!notes) return false
	const [entry] = await db
		.select({ id: schema.lorebookEntries.id })
		.from(schema.lorebookEntries)
		.where(eq(schema.lorebookEntries.lorebookId, notes.id))
		.limit(1)
	if (entry) return true
	const [member] = await db
		.select({ id: schema.lorebookBindings.id })
		.from(schema.lorebookBindings)
		.where(eq(schema.lorebookBindings.lorebookId, notes.id))
		.limit(1)
	return !!member
}

/** Said when a session that reads a book is asked to read another, or none. */
export function bookFixedSentence(bookName: string): string {
	return `This story is underway with ${bookName}, so it keeps reading it. Start a new session to read another book.`
}

/** Said when a session with no book, already under way, is asked to read one. */
export const NOTES_KEEP_THE_WORLD =
	"This story is underway in its own notes. Make them a lorebook to keep them and build on them."

/**
 * Why this session may not move from its book to `nextLorebookId`, or null
 * when it may (nothing changes, or nothing has been played yet).
 */
export async function bookChangeRefusal(
	db: Db,
	session: { id: number; lorebookId: number | null },
	nextLorebookId: number | null
): Promise<string | null> {
	if ((session.lorebookId ?? null) === (nextLorebookId ?? null)) return null
	if (!(await playHasWritten(db, session.id))) return null
	if (session.lorebookId == null) return NOTES_KEEP_THE_WORLD
	const [book] = await db
		.select({ name: schema.lorebooks.name })
		.from(schema.lorebooks)
		.where(eq(schema.lorebooks.id, session.lorebookId))
		.limit(1)
	return bookFixedSentence(book?.name ? `'${book.name}'` : "its lorebook")
}

/**
 * The Rules a book gives a session that takes it before play (ruling 6): the
 * columns `sessions:create` copies when the book is chosen at the start, and
 * How strict clamped the same way — rules that roll no dice play Words only.
 * Null when the book is gone, or brings no rules of its own (Freeform, every
 * book's default: `adoptedBookRules`), when the session keeps its own — as
 * choosing that book at the start does (fix7, 2026-10-23).
 */
export async function rulesFromBook(
	db: Db,
	session: { genreId: string; rigour: string | null },
	lorebookId: number
): Promise<{
	primaryRuleset: string
	rulesetVersion: string | null
	rigour?: string
} | null> {
	const [book] = await db
		.select({
			primaryRuleset: schema.lorebooks.primaryRuleset,
			rulesetVersion: schema.lorebooks.rulesetVersion
		})
		.from(schema.lorebooks)
		.where(eq(schema.lorebooks.id, lorebookId))
		.limit(1)
	if (!book) return null
	const { adoptedBookRules, rigoursPlayed } = await import("$lib/shared/rulesets/rulesOffer")
	if (!adoptedBookRules(book.primaryRuleset)) return null
	const { getGenre, getRuleset } = await import("@serene-pub/sdk")
	const { rulesetDecides } = await import("$lib/server/rulesets/methods")
	const options = [...(getGenre(session.genreId)?.rigour?.options ?? ["prose"])]
	const played = rigoursPlayed(rulesetDecides(getRuleset(book.primaryRuleset)), options)
	const rigour =
		played && session.rigour && !played.includes(session.rigour)
			? played[0]
			: undefined
	return { ...book, ...(rigour ? { rigour } : {}) }
}
