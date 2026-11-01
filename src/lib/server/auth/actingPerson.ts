/**
 * 🚧 The acting-person resolver (M2b, PLAN-sdk-creation-seams §8).
 *
 * A plugin's authority is its granted permissions ∩ its ownership ∩ the
 * ACTING PERSON's own rights. This file answers the third term, once: who the
 * acting person is (`actingPersonFor`) and what they may do to a thing
 * (`personMay`). It mirrors what the app already lets that person do by
 * clicking — it delegates to the existing helpers where they take a `db`, and
 * carries a db-taking twin of `checkSessionAccess` where they do not. It is no
 * second rights table; per-handler checks stay as they are (convergence is a
 * later pass).
 *
 * Every function takes `db` — the module-level handle bypasses `vi.mock`, and
 * inside a transaction only `tx` may be used.
 */
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { isSharedWith } from "$lib/server/utils/shares"
import { findOwnedBook, lorebookAccessFor } from "$lib/server/utils/ownedBook"

/** 🚧 (M2b) What caused the work: a press, a send, a view, a routine, an install. */
export type ActingVia = "press" | "send" | "view" | "routine" | "install"
/** 🚧 (M2b) The person a step runs as. */
export interface ActingPerson {
	userId: number
	isAdmin: boolean
	via: ActingVia
}
/** 🚧 (M2b) What to resolve a person from. */
export type ActingCause =
	| { via: "press" | "send" | "view"; userId: number }
	| { via: "routine"; sessionId: number }
	| { via: "install"; pluginId: string }

async function liveUser(db: Db, userId: number | null | undefined) {
	if (userId == null) return null
	const [u] = await db
		.select({ id: schema.users.id, isAdmin: schema.users.isAdmin, isDeleted: schema.users.isDeleted })
		.from(schema.users)
		.where(eq(schema.users.id, userId))
		.limit(1)
	return u && !u.isDeleted ? u : null
}

/**
 * 🚧 (M2b) The person a cause runs as; null when nobody can (gone, demoted,
 * never enabled). A routine runs as its session's owner; install-time work as
 * the admin who enabled the plugin, only while still an admin.
 */
export async function actingPersonFor(db: Db, cause: ActingCause): Promise<ActingPerson | null> {
	if (cause.via === "routine") {
		const [s] = await db
			.select({ userId: schema.sessions.userId })
			.from(schema.sessions)
			.where(eq(schema.sessions.id, cause.sessionId))
			.limit(1)
		const u = await liveUser(db, s?.userId)
		return u ? { userId: u.id, isAdmin: u.isAdmin, via: "routine" } : null
	}
	if (cause.via === "install") {
		const [p] = await db
			.select({ enabledBy: schema.plugins.enabledBy })
			.from(schema.plugins)
			.where(eq(schema.plugins.pluginId, cause.pluginId))
			.limit(1)
		const u = await liveUser(db, p?.enabledBy)
		return u && u.isAdmin ? { userId: u.id, isAdmin: true, via: "install" } : null
	}
	const u = await liveUser(db, cause.userId)
	return u ? { userId: u.id, isAdmin: u.isAdmin, via: cause.via } : null
}

/** 🚧 (M2b) Something a person may or may not touch. */
export type PersonThing =
	| { kind: "session"; id: number }
	| { kind: "character"; id: number }
	| { kind: "lorebook"; id: number }
	| { kind: "session-annex"; sessionId: number }
	| { kind: "lorebook-annex"; lorebookId: number }
	| { kind: "user-annex"; userId: number }
export type PersonOp = "read" | "write" | "delete"
/** `reason`: one plain sentence a person may read. */
export type PersonAnswer = { ok: true } | { ok: false; reason: string }

const OK: PersonAnswer = { ok: true }
const no = (reason: string): PersonAnswer => ({ ok: false, reason })
const NOT_FOUND = {
	session: "Session not found.",
	character: "Character not found.",
	lorebook: "Lorebook not found."
}

/** The db-taking twin of `checkSessionAccess` (utils/sessionAccess.ts): same two queries, same semantics. */
async function sessionAccessOf(db: Db, sessionId: number, userId: number) {
	const [s] = await db
		.select({ userId: schema.sessions.userId })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	if (!s) return { exists: false, isOwner: false, hasAccess: false }
	const isOwner = s.userId === userId
	const [guest] = await db
		.select({ userId: schema.sessionGuests.userId })
		.from(schema.sessionGuests)
		.where(and(eq(schema.sessionGuests.sessionId, sessionId), eq(schema.sessionGuests.userId, userId)))
		.limit(1)
	return { exists: true, isOwner, hasAccess: isOwner || !!guest }
}

/** The twin of `canViewCharacter`: shared, or in (as cast or voice) a session the person can read. */
async function canViewCharacterOf(db: Db, characterId: number, userId: number): Promise<boolean> {
	if (await isSharedWith(db, "character", characterId, userId)) return true
	const [asCast, asVoice] = await Promise.all([
		db
			.select({ sessionId: schema.sessionCharacters.sessionId })
			.from(schema.sessionCharacters)
			.where(eq(schema.sessionCharacters.characterId, characterId)),
		db
			.select({ sessionId: schema.sessionPersonas.sessionId })
			.from(schema.sessionPersonas)
			.where(eq(schema.sessionPersonas.personaId, characterId))
	])
	const ids = new Set<number>([...asCast, ...asVoice].map((r) => r.sessionId))
	for (const id of ids) if ((await sessionAccessOf(db, id, userId)).hasAccess) return true
	return false
}

/**
 * 🚧 (M2b) May this person do `op` to `thing`? Never more than a click could.
 * An admin is no super-user here except where the existing helper says so
 * (a lorebook READ, as `lorebookAccessFor`).
 */
export async function personMay(
	db: Db,
	person: ActingPerson,
	op: PersonOp,
	thing: PersonThing
): Promise<PersonAnswer> {
	const uid = person.userId
	switch (thing.kind) {
		case "session":
		case "session-annex": {
			const id = thing.kind === "session" ? thing.id : thing.sessionId
			const a = await sessionAccessOf(db, id, uid)
			if (!a.exists || !a.hasAccess) return no(NOT_FOUND.session)
			if (thing.kind === "session" ? op === "read" : op !== "delete") return OK
			return a.isOwner ? OK : no("Only the session's owner may do that.")
		}
		case "character": {
			const [c] = await db
				.select({ userId: schema.characters.userId })
				.from(schema.characters)
				.where(eq(schema.characters.id, thing.id))
				.limit(1)
			if (!c) return no(NOT_FOUND.character)
			if (c.userId === uid) return OK
			if (op === "read" && (await canViewCharacterOf(db, thing.id, uid))) return OK
			return no(op === "read" ? NOT_FOUND.character : "Only the character's owner may do that.")
		}
		case "lorebook":
		case "lorebook-annex": {
			const id = thing.kind === "lorebook" ? thing.id : thing.lorebookId
			if (op === "read") {
				const access = await lorebookAccessFor(id, uid, { db, isAdmin: person.isAdmin })
				return access ? OK : no(NOT_FOUND.lorebook)
			}
			if (op === "write") {
				return (await findOwnedBook(db, uid, id)) ? OK : no(NOT_FOUND.lorebook)
			}
			const [b] = await db
				.select({ userId: schema.lorebooks.userId })
				.from(schema.lorebooks)
				.where(eq(schema.lorebooks.id, id))
				.limit(1)
			return b && b.userId === uid ? OK : no(NOT_FOUND.lorebook)
		}
		case "user-annex":
			return thing.userId === uid ? OK : no("That belongs to someone else.")
	}
}
