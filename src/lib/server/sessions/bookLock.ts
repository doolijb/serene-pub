/**
 * 🚧 **The book lock** (owner ruling 2026-11-08 ★B-5, PLAN-sdk-creation-seams
 * §34.3; supersedes the 2026-10-21 "until play has written" lock): a session
 * keeps the lorebook it started with. The book is chosen when the session is
 * made and never moved after — not before play, not after.
 *
 * Why: a session's own book is written against the book it overlays, so moving
 * it onto another book would lay one book's changes over a book they were never
 * made against; and ★27-10 ("no swapping lorebooks") keeps the SDK's data
 * storage predictable. Making a session, importing a chat, a branch and a next
 * chapter each start a session with its book, so none of them is a move.
 *
 * The one refusal is `BOOK_LOCK_REFUSAL`, said by the server, an old client and
 * the Guide alike. Share as a lorebook is the way to build on a session's notes
 * elsewhere.
 *
 * **Play has written** (`playHasWritten`) is a separate question, read by the
 * close-out and the catch-up: a message that is not a greeting, on any channel,
 * or anything in the session's own book. Greetings do not count: a session
 * posts them when it is made, before anyone has played.
 */
import { and, eq, sql } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { rawRows } from "$lib/server/db/rawRows"
import { ownBookOf } from "$lib/server/lorebooks/ownBook"
import { BOOK_LOCK_REFUSAL, bookDeleteSentence } from "$lib/shared/lorebooks/sessionNotes"

/** Play has written: the session has a line of play, or its notes hold something (closeOut and the catch-up read it; not the lock). */
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
	const notes = await ownBookOf(db, sessionId)
	if (!notes) return false
	const [entry] = await db
		.select({ id: schema.lorebookEntries.id })
		.from(schema.lorebookEntries)
		.where(eq(schema.lorebookEntries.lorebookId, notes.id))
		.limit(1)
	if (entry) return true
	// A member this session's own seat holds is the seat, not play: the
	// own-book mint (★B-5, s4-f-pass) gives a seat its member at seating, and
	// that must not end the catch-up offer before anyone has played (★f-pass-1).
	const b = schema.lorebookBindings
	const [member] = await db
		.select({ id: b.id })
		.from(b)
		.where(
			and(
				eq(b.lorebookId, notes.id),
				sql`not exists (select 1 from ${schema.sessionCharacters} sc where sc.session_id = ${sessionId} and sc.cast_member_id = ${b.id})`,
				sql`not exists (select 1 from ${schema.sessionPersonas} sp where sp.session_id = ${sessionId} and sp.cast_member_id = ${b.id})`
			)
		)
		.limit(1)
	return !!member
}

export { BOOK_LOCK_REFUSAL } from "$lib/shared/lorebooks/sessionNotes"

/**
 * Why a session may not move from its book to `nextLorebookId`, or null when
 * nothing changes (a null own book stays null; old clients post every field).
 */
export function bookChangeRefusal(
	session: { lorebookId: number | null },
	nextLorebookId: number | null
): string | null {
	return (session.lorebookId ?? null) === (nextLorebookId ?? null)
		? null
		: BOOK_LOCK_REFUSAL
}

/** 🚧 Why `lorebookId` may not be deleted (D50), or null when no session plays on it. `askerId`'s own sessions are named; anyone else's are counted; sessions of deleted accounts are left out. */
export async function bookDeleteRefusal(
	db: Db,
	lorebookId: number,
	askerId: number | null
): Promise<string | null> {
	const readers = rawRows<{ id: number; name: string | null; userId: number | null }>(await db.execute(sql`
		select distinct s.id, s.name, s.user_id as "userId", s.updated_at
		from sessions s
		join users u on u.id = s.user_id and not u.is_deleted
		where (s.lorebook_id = ${lorebookId}
		   or exists (
			select 1 from lorebooks n
			where n.overlay_of = ${lorebookId}
			  and (n.session_id = s.id
			    or s.branch_ancestry @> jsonb_build_array(jsonb_build_object('sessionId', n.session_id)))
		   ))
		order by s.updated_at desc, s.id desc
	`))
	if (!readers.length) return null
	const [book] = await db
		.select({ name: schema.lorebooks.name })
		.from(schema.lorebooks)
		.where(eq(schema.lorebooks.id, lorebookId))
		.limit(1)
	const mine = readers.filter((r) => askerId != null && r.userId === askerId)
	return bookDeleteSentence(book?.name ?? "", {
		named: mine.map((r) => ({ id: r.id, name: r.name })),
		others: readers.length - mine.length
	})
}
