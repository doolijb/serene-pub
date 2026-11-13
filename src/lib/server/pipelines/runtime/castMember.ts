/**
 * 🚧 The host half of `core:query/cast-member@1` and
 * `core:outlet/update-cast-member@1` (plan §32 §10, §33): one cast member as
 * a session reads it, and a session's story write to it.
 *
 * A leaf: every function takes `db` first; the server modules that touch the
 * database are imported inside the functions. The one cast-version write is
 * `writeCastVersion` (`characters/versions.ts`); this module never writes a
 * row itself.
 */
import { CAST_STATE_WORDS, type CastMemberV1 } from "@serene-pub/sdk"
import type { NodeVisibility } from "$lib/server/db/schema"
import {
	isCharacterProfileField,
	profileOf,
	type CharacterProfileField
} from "$lib/shared/characters/profile"

/** A refusal in words; the host turns it into a `HostScopeError`. */
export class CastMemberRefusal extends Error {
	constructor(sentence: string) {
		super(sentence)
		this.name = "CastMemberRefusal"
	}
}

const FORMS =
	"a seated member ('seated-member:<id>'), a player seat ('player-seat:<id>') or a cast member's id"

/** JSON with sorted keys, so two equal values compare equal whatever their key order. */
function stableJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`
	if (value && typeof value === "object")
		return `{${Object.entries(value as Record<string, unknown>)
			.filter(([, v]) => v !== undefined)
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
			.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`)
			.join(",")}}`
	return JSON.stringify(value) ?? "null"
}

const isFollow = (value: unknown): boolean =>
	!!value &&
	typeof value === "object" &&
	!Array.isArray(value) &&
	(value as Record<string, unknown>).follow === true &&
	Object.keys(value as object).length === 1

/** Resolves `member` to a cast member id of session `sessionId`, or refuses in words. */
export async function resolveCastMember(
	db: Db,
	sessionId: number,
	member: unknown
): Promise<number> {
	if (typeof member === "string") {
		const { parseSeatRef, seatOf } = await import(
			"$lib/server/sessions/seats"
		)
		const parsed = parseSeatRef(member)
		if (parsed && parsed.form !== "character") {
			const seat = await seatOf(db, sessionId, member.trim())
			if (!seat)
				throw new CastMemberRefusal(
					`'${member.trim()}' is not seated in this session.`
				)
			if (seat.castMemberId == null)
				throw new CastMemberRefusal(
					`'${member.trim()}' voices no cast member in this session.`
				)
			return seat.castMemberId
		}
	} else if (
		typeof member === "number" &&
		Number.isSafeInteger(member) &&
		member > 0
	) {
		const schema = await import("$lib/server/db/schema")
		const { eq } = await import("drizzle-orm")
		const [row] = await db
			.select({
				id: schema.lorebookBindings.id,
				lorebookId: schema.lorebookBindings.lorebookId,
				overlayOf: schema.lorebookBindings.overlayOf
			})
			.from(schema.lorebookBindings)
			.where(eq(schema.lorebookBindings.id, member))
			.limit(1)
		if (!row)
			throw new CastMemberRefusal(`Cast member ${member} does not exist.`)
		if (row.overlayOf != null)
			throw new CastMemberRefusal(
				`Cast member ${member} is this session's notes on cast member ${row.overlayOf}; name cast member ${row.overlayOf} instead.`
			)
		const [session] = await db
			.select({ lorebookId: schema.sessions.lorebookId })
			.from(schema.sessions)
			.where(eq(schema.sessions.id, sessionId))
			.limit(1)
		const { overlayChainOf } = await import("$lib/server/state/reading")
		const books = new Set<number>(await overlayChainOf(db, sessionId))
		if (session?.lorebookId != null) books.add(session.lorebookId)
		if (!books.has(row.lorebookId))
			throw new CastMemberRefusal(
				`Cast member ${member} is not in this session's lorebook.`
			)
		return row.id
	}
	throw new CastMemberRefusal(`A cast member is named by ${FORMS}.`)
}

async function readOf(db: Db, sessionId: number, id: number) {
	const { membersAsRead } = await import("$lib/server/cast/memberAsRead")
	const read = (await membersAsRead(db, [id], { sessionId })).get(id)
	if (!read)
		throw new CastMemberRefusal(
			`Cast member ${id} is not in this session's cast.`
		)
	return read
}

/** One cast member as session `sessionId` reads it. */
export async function readCastMember(
	db: Db,
	sessionId: number,
	member: unknown
): Promise<CastMemberV1> {
	const id = await resolveCastMember(db, sessionId, member)
	const read = await readOf(db, sessionId, id)
	return {
		castMemberId: id,
		cardId: read.activeCardId,
		cardVersion: read.cardVersion,
		cardless: read.cardless,
		behindCard: read.behindCard,
		follows: read.follows,
		profile: profileOf(read)
	} as CastMemberV1
}

/** What a person or the admin chooses, and a run may not change: the keys that name a face, a likeness image or a voice. */
function chosenValuesOf(profile: ReturnType<typeof profileOf>) {
	return {
		faceMediaId: profile.faceMediaId ?? null,
		likenessImage:
			(profile.likeness as { imageMediaId?: number | null } | null)
				?.imageMediaId ?? null,
		voice: (profile.timbre as { voice?: unknown } | null)?.voice ?? null,
		narrationVoice:
			(profile.timbre as { narrationVoice?: unknown } | null)
				?.narrationVoice ?? null
	}
}

/** A greeting's `groupOnly: false` says what absence says; dropped before the shape compare. */
const withoutFalseGroupOnly = (key: string, value: unknown): unknown =>
	key === "greetings" && Array.isArray(value)
		? value.map((g) =>
				g &&
				typeof g === "object" &&
				!Array.isArray(g) &&
				(g as { groupOnly?: unknown }).groupOnly === false
					? Object.fromEntries(
							Object.entries(g).filter(([k]) => k !== "groupOnly")
						)
					: g
			)
		: value

const NODE_VISIBILITIES: readonly NodeVisibility[] = [
	"normal",
	"legendary",
	"hidden"
]

/**
 * Refuses a `changes` that is not a set of character profile fields or the
 * two node keys (`nodeState`, `nodeVisibility`); answers its entries, each
 * value as the character profile keeps it (or the follow; a node key has no
 * follow).
 */
function checkChanges(changes: unknown): [string, unknown][] {
	if (!changes || typeof changes !== "object" || Array.isArray(changes))
		throw new CastMemberRefusal(
			"'changes' must be an object of character profile fields."
		)
	const entries = Object.entries(changes as Record<string, unknown>).filter(
		([, v]) => v !== undefined
	)
	if (!entries.length)
		throw new CastMemberRefusal(
			"'changes' names nothing to change, so there is nothing to write."
		)
	return entries.map(([key, value]) => {
		if (key === "nodeState" || key === "nodeVisibility") {
			// 🚧 Provisional copy: the owner has not seen these sentences.
			if (isFollow(value))
				throw new CastMemberRefusal(
					`'${key}' has no card value to follow; give it a value.`
				)
			if (
				key === "nodeState" &&
				!(CAST_STATE_WORDS as readonly unknown[]).includes(value)
			)
				throw new CastMemberRefusal(
					`'${String(value)}' is not a cast state; a cast member's state is one of ${CAST_STATE_WORDS.join(", ")}.`
				)
			if (
				key === "nodeVisibility" &&
				!(NODE_VISIBILITIES as readonly unknown[]).includes(value)
			)
				throw new CastMemberRefusal(
					`'${String(value)}' is not a cast visibility; it is one of normal, legendary, hidden.`
				)
			return [key, value]
		}
		if (!isCharacterProfileField(key))
			throw new CastMemberRefusal(
				`'${key}' is not a character profile field, so this write does not change it.`
			)
		if (isFollow(value)) return [key, { follow: true }]
		if (key === "name" && (typeof value !== "string" || !value.trim()))
			throw new CastMemberRefusal(
				"A cast member's 'name' must be a non-empty text."
			)
		const normal = (
			profileOf({ [key]: value }) as unknown as Record<string, unknown>
		)[key]
		if (
			stableJson(normal) !== stableJson(withoutFalseGroupOnly(key, value))
		)
			throw new CastMemberRefusal(
				`'${key}' is not in the shape a character profile keeps for it; give it as the profile reads it, or { follow: true }.`
			)
		return [key, normal]
	})
}

/**
 * A story write to one cast member: gated by `writes.lore`, checked, then the
 * one writer's story path (it routes itself by the lore write mode and
 * anchors to the turn, so Back takes it).
 */
export async function writeCastMember(
	db: Db,
	input: {
		sessionId: number
		member: unknown
		changes: unknown
		/** `run:<id>`; the session's own when the write has no run. */
		runId?: number | string | null
		/** The turn's message; undefined when none. */
		messageId?: number
	}
): Promise<{
	id: number
	castVersionId: number
	castMemberId: number
	coalesced: boolean
}> {
	const { sessionId } = input
	const { loreWriteRefusal } = await import("$lib/server/messages/writes")
	const noLore = await loreWriteRefusal(db, sessionId)
	if (noLore) throw new CastMemberRefusal(noLore)
	const id = await resolveCastMember(db, sessionId, input.member)
	const entries = checkChanges(input.changes)

	// The values a person or the admin chooses stay as the session reads them.
	const now = chosenValuesOf(profileOf(await readOf(db, sessionId, id)))
	const asked: Record<string, unknown> = Object.fromEntries(entries)
	const would = (key: CharacterProfileField) =>
		asked[key] !== undefined && !isFollow(asked[key])
	const next = chosenValuesOf(
		profileOf(Object.fromEntries(entries.filter(([, v]) => !isFollow(v))))
	)
	const refuse = (what: string) => {
		throw new CastMemberRefusal(
			`${what} is chosen by a person, not by a run, so this write does not change it.`
		)
	}
	if (would("faceMediaId") && next.faceMediaId !== now.faceMediaId)
		refuse("A face")
	if (would("likeness") && next.likenessImage !== now.likenessImage)
		refuse("A likeness image")
	if (
		would("timbre") &&
		(stableJson(next.voice) !== stableJson(now.voice) ||
			stableJson(next.narrationVoice) !== stableJson(now.narrationVoice))
	)
		refuse("A voice")

	const { writeCastVersion } = await import("$lib/server/characters/versions")
	const { version, coalesced } = await db.transaction(async (tx: Db) =>
		writeCastVersion(tx, {
			member: id,
			changes: asked as Parameters<typeof writeCastVersion>[1]["changes"],
			writtenBy:
				input.runId != null
					? `run:${input.runId}`
					: `session:${sessionId}`,
			// A run names its OWN turn message: its later lines (a death's-door
			// table row) must not seal it — the same rule clock moves and
			// world-row state use (`ownAnchor`, state/write.ts `anchorFor`).
			session: {
				id: sessionId,
				messageId: input.messageId,
				...(input.runId != null && input.messageId != null
					? { ownAnchor: true }
					: {})
			}
		})
	)
	return {
		id: version.id,
		castVersionId: version.id,
		castMemberId: id,
		coalesced
	}
}
