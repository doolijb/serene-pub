/**
 * Who is speaking a side-character turn, resolved once (ruling 2026-09-07).
 *
 * The trigger's first step accepts **either** an existing character or a name
 * somebody typed, and this turns that choice into the one fact the run carries:
 * a name, an optional character id, whether the session's lorebook has heard of
 * them, and — when the pick was a real character — the card the prompt renders.
 *
 * ## participant ≠ character
 *
 * ⚠ **Nothing here writes a membership.** No `session_characters` row, no
 * position, no `isActive`. A side character is a participant *for one turn*: the
 * prompt speaks as them and the retrieval scope names them, and the moment the
 * turn ends there is nothing left but a message. The free-form case makes that
 * literal — there is no row to add even if somebody wanted to.
 *
 * Round-robin exclusion is likewise **not** enforced here, deliberately.
 * `getNextCharacterTurn` drops every `isNarratorResponse` row before it matches
 * a character id, so a side-character turn is outside the rotation by the row it
 * writes. A second statement of the rule in this module would be free to
 * disagree with the first, and the first is the one the rotation actually reads.
 *
 * ## `known`, and what core does with it
 *
 * `known` is false exactly when the chosen name matches nothing in the session's
 * lorebook. It is the **fact**, and core stops at the fact: it reaches a script
 * through the input node's declared `extras` — the one dispatch core scripts and
 * extension hooks share — and a script decides whether to suggest adding them.
 * Core never suggests, never notifies and never writes.
 */

import { and, eq, isNull } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"

/** The card fields a side character's prompt entry is compiled from. */
export interface SideCharacterCard {
	id: number
	name: string
	nickname: string | null
	description: string | null
	personality: string | null
}

export interface SideCharacterFact {
	name: string
	/** Null for a free-form name — a participant with no row behind them. */
	characterId: number | null
	/** Does the session's lorebook already know this name? */
	known: boolean
	/** Present only when the pick was a real character. */
	character: SideCharacterCard | null
}

/** What the trigger's first step can send. */
export interface SideCharacterPick {
	characterId?: number | null
	name?: string | null
}

/** A refusal a person can act on, or the fact. */
export type SideCharacterResolution =
	| { ok: true; speaker: SideCharacterFact }
	| { ok: false; error: string }

const norm = (v: unknown): string =>
	typeof v === "string" ? v.trim().toLowerCase() : ""

/**
 * Every name the session's lorebook answers to.
 *
 * Bindings first — they are the lorebook's own roster and carry the display
 * name, the synced aliases and the absorbed ones. ⚠ `aliases` and
 * `absorbedAliases` are unioned rather than read one at a time: the sync helpers
 * REPLACE `aliases` wholesale on every entity edit, so an absorbed identity
 * lives only in the second column and reading either alone finds half the names
 * (the same union `availableSceneCast.ts` makes).
 *
 * Entry titles come next, because a lorebook that names a character in an entry
 * without ever binding one still knows that name — and "the lorebook has never
 * heard of them" is the claim `known: false` makes.
 */
async function lorebookNames(
	db: Db,
	lorebookId: number
): Promise<{ names: Set<string>; characterIds: Set<number> }> {
	const names = new Set<string>()
	const characterIds = new Set<number>()

	const bindings = (await db
		.select()
		.from(schema.lorebookBindings)
		.where(eq(schema.lorebookBindings.lorebookId, lorebookId))) as any[]
	for (const b of bindings) {
		if (typeof b.characterId === "number") characterIds.add(b.characterId)
		for (const n of [
			b.name,
			...(Array.isArray(b.aliases) ? b.aliases : []),
			...(Array.isArray(b.absorbedAliases) ? b.absorbedAliases : [])
		]) {
			const k = norm(n)
			if (k) names.add(k)
		}
	}

	const entries = (await db
		.select({ title: schema.lorebookEntries.title })
		.from(schema.lorebookEntries)
		.where(eq(schema.lorebookEntries.lorebookId, lorebookId))) as any[]
	for (const e of entries) {
		const k = norm(e.title)
		if (k) names.add(k)
	}

	return { names, characterIds }
}

/**
 * Resolve the trigger's first step.
 *
 * @param userId the person who pressed the button. A character id is checked
 * against their own characters — a forged id reaching a prompt as somebody
 * else's card would make the picker decoration, which is the same reasoning
 * `sessions:triggerFunction` applies to a menu trigger's subject.
 */
export async function resolveSideCharacter(
	db: Db,
	sessionId: number,
	userId: number,
	pick: SideCharacterPick
): Promise<SideCharacterResolution> {
	const typed = typeof pick.name === "string" ? pick.name.trim() : ""
	const pickedId =
		typeof pick.characterId === "number" ? pick.characterId : null

	if (typed.length > 120)
		return { ok: false, error: "That name is too long (max 120 characters)." }

	const [session] = (await db
		.select({ lorebookId: schema.sessions.lorebookId })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)) as any[]
	if (!session) return { ok: false, error: "Session not found." }

	let card: SideCharacterCard | null = null
	if (pickedId != null) {
		const [row] = (await db
			.select({
				id: schema.characters.id,
				name: schema.characters.name,
				nickname: schema.characters.nickname,
				description: schema.characters.description,
				personality: schema.characters.personality
			})
			.from(schema.characters)
			.where(
				and(
					eq(schema.characters.id, pickedId),
					eq(schema.characters.userId, userId)
				)
			)
			.limit(1)) as any[]
		if (!row)
			return {
				ok: false,
				error: "That character is not available for this session."
			}
		// A live presence — somebody's own voice in this session, whoever's —
		// is refused as a speaker (U5b review W6). The picker never offers
		// one (`listSideCharacterOptions`), so a request naming one did not
		// come through the picker; and seating one would have the model
		// narrate a character a person is playing while the run's
		// portrayals pin them to that person. The reply road's null seat
		// (`runReply`) stays as the belt to this: a fact that reaches the
		// run anyway is seated as nobody.
		if ((await livePresenceIds(db, sessionId)).has(pickedId))
			return {
				ok: false,
				error:
					"That character is somebody's presence in this session — a person speaks as " +
					"them, so the narrator cannot. Pick another character, or type a name."
			}
		card = row as SideCharacterCard
	}

	// The typed name wins over the card's, so somebody may pick a character and
	// still have them announced under a name this scene uses. Absent, the card
	// supplies it — `characters.name` is NOT NULL, so a picked character always
	// has one.
	//
	// ⚠ **One guard, not two.** An earlier draft refused `no pick and no name`
	// up front as well, which read as defence in depth and was not: a picked
	// character can never produce an empty name here, so the two conditions are
	// the same condition and mutating either left the other passing. A branch
	// no test can distinguish from its neighbour is a branch that will drift.
	const name = typed || card?.name || ""
	if (!name)
		return {
			ok: false,
			error: "Choose a character or type a name for this turn."
		}

	// No lorebook is not the same as an unknown name, and it must not read as
	// one: `known: false` is what a script acts on, and "add them to the
	// lorebook you do not have" is not a suggestion anybody can take.
	if (!session.lorebookId)
		return {
			ok: true,
			speaker: { name, characterId: pickedId, known: true, character: card }
		}

	const { names, characterIds } = await lorebookNames(db, session.lorebookId)
	const known =
		(pickedId != null && characterIds.has(pickedId)) || names.has(norm(name))

	return {
		ok: true,
		speaker: { name, characterId: pickedId, known, character: card }
	}
}

/**
 * The characters this person may send as a side character.
 *
 * Their own characters, minus whoever is already in the session's cast — a cast
 * member has a turn of their own, and offering them here would be two routes to
 * one voice with different rotation consequences — and minus the session's
 * live **presences** (`session_personas`): a persona is a character somebody
 * *plays*, and since the library merge it is one of "their own characters"
 * like any other. Offering it here would seat the model as a person's own
 * presence for a turn, and the run's portrayals would then pin that character
 * to the person while the model narrates them (U5a review, W3).
 *
 * ⚠ **A removed member is offerable again**, and the `removedAt` filter is what
 * says so. `session_characters` rows are soft-deleted, and the rotation already
 * ignores a removed one — so somebody who left the party is exactly the person
 * a side-character turn is for. Filtering on the row's mere existence would
 * make "they left, and now they cannot come back for one scene" the rule, which
 * is the opposite of the feature. A detached presence is offerable on the same
 * terms.
 */
export async function listSideCharacterOptions(
	db: Db,
	sessionId: number,
	userId: number
): Promise<Array<{ id: number; name: string; nickname: string | null }>> {
	const cast = (await db
		.select({
			characterId: schema.sessionCharacters.characterId,
			removedAt: schema.sessionCharacters.removedAt
		})
		.from(schema.sessionCharacters)
		.where(eq(schema.sessionCharacters.sessionId, sessionId))) as any[]
	const seated = new Set<number>(
		cast
			.filter((c) => !c.removedAt)
			.map((c) => c.characterId)
			.filter((id: unknown): id is number => typeof id === "number")
	)
	for (const id of await livePresenceIds(db, sessionId)) seated.add(id)

	const rows = (await db
		.select({
			id: schema.characters.id,
			name: schema.characters.name,
			nickname: schema.characters.nickname
		})
		.from(schema.characters)
		.where(eq(schema.characters.userId, userId))) as any[]

	return rows
		.filter((r) => !seated.has(r.id))
		.sort((a, b) => String(a.name).localeCompare(String(b.name)))
}

/**
 * The characters attached to the session as somebody's presence — live
 * `session_personas` rows, whoever owns them. Read by the picker above and
 * by the reply road, which seats no presence as a side character's speaker
 * (the belt to the picker's braces).
 */
export async function livePresenceIds(
	db: Db,
	sessionId: number
): Promise<Set<number>> {
	const rows = await db
		.select({ characterId: schema.sessionPersonas.personaId })
		.from(schema.sessionPersonas)
		.where(
			and(
				eq(schema.sessionPersonas.sessionId, sessionId),
				isNull(schema.sessionPersonas.removedAt)
			)
		)
	return new Set(
		rows
			.map((r) => r.characterId)
			.filter((id): id is number => typeof id === "number")
	)
}
