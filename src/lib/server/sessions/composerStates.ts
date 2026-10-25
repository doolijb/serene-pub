/**
 * 🚧 A session's **composer states** (owner ruling 2026-10-15): whether a
 * person's composer is open on a channel lane, kept on the session row
 * (`sessions.composer_states`). The genre owns open and closed — this writes
 * only what `core:outlet/set-composer-state@1` hands it, and core opens and
 * closes nothing on its own. The document and its resolvers are the SDK's
 * (`composerStates.ts`), so the door, the page and a widget read one answer.
 *
 * The door: `composerRefusal` — a send on a closed composer is refused with
 * the reason in its sentence (the owner too: the genre decides). Turn
 * controls are not the composer's and never ask.
 */
import { eq } from "drizzle-orm"
import {
	applyComposerState,
	composerClosedRefusal,
	composerClosureFor,
	composerStatePerson,
	readComposerStates,
	COMPOSER_STATE_ANY,
	type ComposerStatesV1
} from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"
import { sessionArchivedRefusal } from "$lib/server/sessions/archive"

/** Thrown with the sentence a run halts on. */
export class ComposerStateRefusal extends Error {}

/** Read a port's `open`: a boolean, or its one obvious spelling. */
function readOpen(raw: unknown): boolean | null {
	if (typeof raw === "boolean") return raw
	if (raw === "true" || raw === "open") return true
	if (raw === "false" || raw === "closed") return false
	return null
}

/**
 * Open or close one composer, and return the session's whole document after
 * it. One statement under the row's lock, so two writes in flight never
 * drop each other's closures.
 */
export async function writeComposerState(
	db: Db,
	sessionId: number,
	change: { channel: unknown; open: unknown; reason?: unknown; person?: unknown }
): Promise<ComposerStatesV1> {
	const channel =
		typeof change.channel === "string" && change.channel.trim()
			? change.channel.trim()
			: null
	if (!channel)
		throw new ComposerStateRefusal(
			"no channel was named, so no composer was opened or closed (a slug, a lane like 'parley:2', or '*')"
		)
	const open = readOpen(change.open)
	if (open === null)
		throw new ComposerStateRefusal(
			`'${String(change.open)}' is neither open (true) nor closed (false), so the composer was left as it was`
		)
	if (composerStatePerson(change.person) === null)
		throw new ComposerStateRefusal(
			`'${String(change.person)}' is not a person (user:<id>), so no composer was opened or closed`
		)
	const reason = typeof change.reason === "string" ? change.reason : undefined
	const person =
		typeof change.person === "string" && change.person.trim() ? change.person.trim() : null

	return await db.transaction(async (tx) => {
		const [row] = await tx
			.select({ composerStates: schema.sessions.composerStates })
			.from(schema.sessions)
			.where(eq(schema.sessions.id, sessionId))
			.limit(1)
			.for("update")
		if (!row) throw new ComposerStateRefusal("the session is gone, so no composer was changed")
		const next = applyComposerState(row.composerStates, { channel, open, reason, person })
		await tx
			.update(schema.sessions)
			.set({ composerStates: next })
			.where(eq(schema.sessions.id, sessionId))
		return next
	})
}

/** The session's document, read. */
export async function readSessionComposerStates(
	db: Db,
	sessionId: number
): Promise<ComposerStatesV1> {
	const [row] = await db
		.select({ composerStates: schema.sessions.composerStates })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	return readComposerStates(row?.composerStates)
}

/**
 * The door's question: the sentence a send by `userId` on `channel` is
 * refused with, or null when that composer is open.
 */
export async function composerRefusal(
	db: Db,
	sessionId: number,
	channel: string,
	userId: number
): Promise<string | null> {
	// 🚧 pr-6 R-k: an archived session is read-only — every composer, everyone.
	const archived = await sessionArchivedRefusal(db, sessionId)
	if (archived) return composerClosedRefusal({ reason: archived })
	const states = await readSessionComposerStates(db, sessionId)
	if (!Object.keys(states).length) return null
	const closure = composerClosureFor(states, channel, userId)
	return closure ? composerClosedRefusal(closure) : null
}

export { COMPOSER_STATE_ANY }
