/**
 * What a line's speaker can show — the host half of the sprite picker,
 * `core:oracle/pick-sprite@1` (DESIGN-sprites §2.3, §5.2).
 *
 * Keyed by WHO is speaking, never by a message: the picker is handed the
 * line's text and its speaker by the reply spec (owner, 2026-10-05: "the
 * explicit text or string passed in"), so nothing here reads a line back.
 *
 * The sprite SET is decided in one order, and `decidedBy` names which rung
 * decided it so the receipt answers "why this outfit":
 *
 *   0. `spec`      — a set the spec wired to the picker's `set` port (no core
 *                    spec does; a plugin's may);
 *   1. `override`  — the session's `core:slot/sprite-set@1` on the speaker
 *                    (play, not canon: "she changed clothes in this scene");
 *   2. `amendment` — the cast member's `spriteSet`, as read through
 *                    `memberAsRead` for a seat with a member; through
 *                    `cardMemberAt` (the card-keyed entry point to the one
 *                    cast resolver, `castAsOf` — never a second resolver) for
 *                    a seat with none yet;
 *   3. `default`   — the member's own default set when it has sets, else the
 *                    card's default set.
 *
 * A name that the resolved card has no set for falls to the default set and
 * says so (`missing`, and `missingAskedBy` the rung that asked), never silently.
 *
 * ⚠ The CARD whose sprites are read is the cast member's RESOLVED
 * `characterId`, not the session's: a card-swap amendment ("the older card
 * from Y20") brings that card's art with it, which is the case the ruling was
 * built for. A swapped-in card with no sprites at all falls back to the
 * member's OWN card rather than to no face — a missing portrait is not a
 * different person. A cast member's OWN sets (owner, 2026-11-05: members carry
 * sprites, own over card) come before any card: when it has them, they are the
 * art and no card draws them.
 *
 * ⚠ Resolved where the SESSION reads its book (finding #39): its line with
 * every fork cut (`line`), at its story clock or the head — `sessionReadingOf`,
 * the reading every other session-side reader of the book takes.
 *
 * ⚠ Appearances: a member placed twice at one moment is two people
 * (`cardMemberAt(...).appearances`). A session speaker names a card, not an
 * appearance, so this reads the un-narrowed `member` — one face per card —
 * until a speaker can name which appearance is talking.
 */

import { and, desc, eq, ne } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { valueOf } from "$lib/server/state/resolve"
import { memberFormOn } from "$lib/server/state/memberForm"
import type { StateOwner } from "$lib/server/state/owners"
import { sessionReadingOf, lineOfReading } from "$lib/server/state/reading"
import { cardMemberAt } from "$lib/server/sockets/amendments"
import { memberAsRead } from "$lib/server/cast/memberAsRead"
import { seatOf } from "$lib/server/sessions/seats"
import { spriteLabelsFor, spriteLabelsForMembers } from "$lib/server/sprites"
import {
	asShownSprite,
	normalizeSpriteName,
	type ShownSprite
} from "$lib/shared/sprites"

/** The session override's slot id — declared in core-catalog `slots.ts`. */
export const SPRITE_SET_SLOT_ID = "core:slot/sprite-set@1"

/** How far back "recent" reaches, for the picker's recency penalty. */
const RECENT_LINES = 5

export type SpriteSetDecidedBy = "spec" | "override" | "amendment" | "default"

/** `core:shape/sprite-choices@1`. */
export interface SpriteChoicesV1 {
	/**
	 * The card whose sprites these are — the speaker's, after any card swap;
	 * null when the sets are the cast member's own.
	 */
	characterId: number | null
	/**
	 * 🚧 The speaker's cast member — the seat's (host-filled, seat-cast S3,
	 * ★S3-4); null when the seat stores none. Absent when no seat was read
	 * (a speaker that is no card). `characterId` stays the card the art
	 * comes from (⏳).
	 */
	castMemberId?: number | null
	/** The set in force for the line. */
	set: string | null
	defaultSet: string | null
	/** That set's sprite labels with an image, sorted. */
	labels: string[]
	/** The speaker's previous shown sprite, for stickiness. */
	last: ShownSprite | null
	/** Labels shown on the speaker's recent lines, newest first. */
	recent: string[]
	decidedBy: SpriteSetDecidedBy
	/** A set name was asked for and the card has none by that name. */
	missing?: string
	/**
	 * Beside `missing`: which rung asked for it (plan A25). `decidedBy` is
	 * `default` then — the card's default set is what shows — and this keeps
	 * the spec's set, the session's override, or the member's set, on the
	 * receipt.
	 */
	missingAskedBy?: Exclude<SpriteSetDecidedBy, "default">
}

const nothing = (): SpriteChoicesV1 => ({
	characterId: null,
	set: null,
	defaultSet: null,
	labels: [],
	last: null,
	recent: [],
	decidedBy: "default"
})

type SeatMapOf = Awaited<ReturnType<typeof import("$lib/server/state/seatRefs").loadSeatMap>>

async function loadSeatMapOf(db: Db, sessionId: number): Promise<SeatMapOf> {
	const { loadSeatMap } = await import("$lib/server/state/seatRefs")
	return loadSeatMap(db, sessionId)
}

/**
 * ⏳ The state owner of the seat that holds card `cardId`: `session_cast` by
 * the card while the flip is off; once it is on (`state/memberForm.ts`) the
 * seat's own owner — `seated_member` or `player_seat` — through the door
 * (`memberFormOf`, `storedSeatOwner`'s read), where a seat's values live. A
 * card no seat holds keeps the `session_cast` owner. `map`: one seat read
 * for a batch.
 */
async function seatOwnerOfCard(
	db: Db,
	sessionId: number,
	cardId: number,
	map?: SeatMapOf
): Promise<StateOwner> {
	const owner: StateOwner = { kind: "session_cast", id: cardId }
	if (!memberFormOn()) return owner
	const { memberFormOf } = await import("$lib/server/state/seatRefs")
	const seated = memberFormOf(map ?? (await loadSeatMapOf(db, sessionId)), owner)
	return (seated as StateOwner | null) ?? owner
}

/**
 * Does the cast member draw from sprite sets of its own — at least one set with
 * a picture? Then no card draws it, and nothing falls back to a card.
 */
export async function memberDrawsOwnSprites(
	db: Db,
	castMemberId: number
): Promise<boolean> {
	const own = (await spriteLabelsForMembers(db, [castMemberId])).get(
		castMemberId
	)
	return !!own && own.sets.size > 0
}

/**
 * What `speaker` can show in this session, for the picker.
 *
 * `excludeMessageId` is the row the run is writing — the reply the picker is
 * choosing a face for — so it is never one of the speaker's own "recent"
 * lines, whatever it showed before a regenerate. Every other line of the
 * speaker's in the session counts, newest first.
 */
export async function spriteChoicesFor(
	db: Db,
	params: {
		sessionId: number
		/** The speaker's card — `character:<id>`'s id. Exactly one of this and `castMemberId`. */
		characterId?: number
		/**
		 * A card-less seat's speaker: its member (`seated-member:<id>`'s id — a
		 * member id, never a card id). Offers the member's own sprite sets only.
		 */
		castMemberId?: number
		/** A set the spec wired to the picker (`decidedBy: "spec"`). */
		set?: unknown
		/** The run's own row (`run.liveRow`), left out of "recent". */
		excludeMessageId?: number
	}
): Promise<SpriteChoicesV1> {
	// Exactly one of the two speaker forms; a card id and a member id share one
	// id range, so they stay in separately named variables.
	const memberSpeaker = params.castMemberId ?? null
	const speakerId = params.characterId ?? null
	if ((speakerId == null) === (memberSpeaker == null)) return nothing()
	const speakerKey = speakerId ?? memberSpeaker!
	if (!Number.isInteger(speakerKey) || speakerKey <= 0) return nothing()

	const reading = await sessionReadingOf(db, params.sessionId)

	// ── Which set, and whose card ──────────────────────────────────────────
	let cardId: number | null = speakerId
	let wanted: string | null = null
	let decidedBy: SpriteSetDecidedBy = "default"

	// The seat's cast member, as read over its active card: sprites follow the
	// dated card a card-swap amendment brings.
	const seat = await seatOf(
		db,
		params.sessionId,
		speakerId != null ? `character:${speakerId}` : `seated-member:${memberSpeaker}`
	)
	// A card-less seat's values live under its member's own owner (flip on);
	// flip off, a seat with no card has no stored owner, so no override.
	const overrideOwner: StateOwner | null =
		speakerId != null
			? await seatOwnerOfCard(db, params.sessionId, speakerId)
			: seat?.castMemberId != null && memberFormOn()
				? { kind: "seated_member", id: seat.castMemberId }
				: null
	const override = overrideOwner
		? await valueOf(db, {
				sessionId: params.sessionId,
				owner: overrideOwner,
				slotId: SPRITE_SET_SLOT_ID
			})
		: null
	const asRead =
		seat?.castMemberId != null
			? await memberAsRead(db, seat.castMemberId, { sessionId: params.sessionId })
			: null
	if (asRead) {
		cardId = speakerId != null ? (asRead.activeCardId ?? speakerId) : null
		const amended = normalizeSpriteName(asRead.spriteSet)
		if (amended) {
			wanted = amended
			decidedBy = "amendment"
		}
	} else if (reading && speakerId != null) {
		const resolved = await cardMemberAt(db, {
			lorebookId: reading.lorebookId,
			characterId: speakerId,
			at: {
				line: lineOfReading(reading),
				moment: reading.moment
			}
		})
		const member = resolved?.member as
			| { characterId?: unknown; spriteSet?: unknown }
			| undefined
		if (typeof member?.characterId === "number") cardId = member.characterId
		const amended = normalizeSpriteName(member?.spriteSet)
		if (amended) {
			wanted = amended
			decidedBy = "amendment"
		}
	}
	const overridden = normalizeSpriteName(override)
	if (overridden) {
		wanted = overridden
		decidedBy = "override"
	}
	const asked = normalizeSpriteName(params.set)
	if (asked) {
		wanted = asked
		decidedBy = "spec"
	}

	// The member's own sets, when it has any with an image, are the art — no
	// card draws them, and nothing falls back to a card inside them.
	const memberOwns = asRead
		? await memberDrawsOwnSprites(db, asRead.castMemberId)
		: false
	const ownArt = memberOwns
		? (await spriteLabelsForMembers(db, [asRead!.castMemberId])).get(
				asRead!.castMemberId
			)
		: undefined
	// A card-less seat has no card to fall back on: the member's own sets only.
	let art = memberOwns
		? ownArt
		: cardId != null
			? (await spriteLabelsFor(db, [cardId])).get(cardId)
			: undefined
	// The swapped-in card has no art: the member's own card still does.
	if (
		!memberOwns &&
		speakerId != null &&
		(!art || art.sets.size === 0) &&
		cardId !== speakerId
	) {
		const own = (await spriteLabelsFor(db, [speakerId])).get(speakerId)
		if (own && own.sets.size > 0) {
			cardId = speakerId
			art = own
		}
	}
	if (!art || art.sets.size === 0)
		return { ...nothing(), characterId: cardId, castMemberId: seat?.castMemberId ?? null }
	const defaultSet = art.defaultSet ?? [...art.sets.keys()][0]

	let set = defaultSet
	let missing: string | undefined
	let missingAskedBy: SpriteChoicesV1["missingAskedBy"]
	if (wanted) {
		if (art.sets.has(wanted)) set = wanted
		else {
			missing = wanted
			if (decidedBy !== "default") missingAskedBy = decidedBy
			decidedBy = "default"
		}
	}
	const labels = [...(art.sets.get(set) ?? [])].sort()

	// ── The speaker's recent faces (stickiness, recency) ───────────────────
	const earlier = await db
		.select({
			metadata: schema.sessionMessages.metadata,
			isHidden: schema.sessionMessages.isHidden
		})
		.from(schema.sessionMessages)
		.where(
			and(
				eq(schema.sessionMessages.sessionId, params.sessionId),
				speakerId != null
					? eq(schema.sessionMessages.characterId, speakerId)
					: eq(schema.sessionMessages.castMemberId, memberSpeaker!),
				...(params.excludeMessageId !== undefined
					? [ne(schema.sessionMessages.id, params.excludeMessageId)]
					: [])
			)
		)
		.orderBy(desc(schema.sessionMessages.id))
		.limit(RECENT_LINES * 2)
	const shown = earlier
		.filter((r) => !r.isHidden)
		.map((r) => asShownSprite((r.metadata as any)?.sprite))
		.filter((s): s is ShownSprite => s !== null)
	const last = shown[0] ?? null
	const recent = shown.slice(0, RECENT_LINES).map((s) => s.label)

	return {
		characterId: memberOwns ? null : cardId,
		castMemberId: seat?.castMemberId ?? null,
		set,
		defaultSet,
		labels,
		last,
		recent,
		decidedBy,
		...(missing ? { missing } : {}),
		...(missingAskedBy ? { missingAskedBy } : {})
	}
}

/**
 * Show a character in another sprite set **for this session only**
 * (DESIGN-sprites §2.3) — "she changed clothes in this scene". Writes the
 * `core:slot/sprite-set@1` value on the speaker's `session_cast` owner through
 * the ordinary state write, so it is anchored to the conversation (a branch or
 * a swipe behind it reads the old outfit), versioned, and in the ledger.
 * `set: null` clears it, and the cast member's own set applies again.
 */
export async function setSessionSpriteSet(
	db: Db,
	params: {
		sessionId: number
		characterId: number
		set: string | null
		updatedBy: string
	}
): Promise<void> {
	const { setValue } = await import("$lib/server/state/write")
	const set = normalizeSpriteName(params.set)
	await setValue(
		db,
		{ sessionId: params.sessionId, updatedBy: params.updatedBy },
		{
			owner: await seatOwnerOfCard(db, params.sessionId, params.characterId),
			slotId: SPRITE_SET_SLOT_ID,
			value: set || null,
			note: set ? `Shown in the "${set}" sprite set` : "Sprite set cleared"
		}
	)
}

/**
 * The session's sprite-set overrides, by character id — what the client needs
 * to draw a CURRENT sprite in the outfit the session changed to, before the
 * character's next line records it. Absent entries have no override.
 */
export async function spriteSetOverridesFor(
	db: Db,
	sessionId: number,
	characterIds: readonly number[]
): Promise<Record<number, string>> {
	const out: Record<number, string> = {}
	// ⏳ Read through the seat once (`seatOwnerOfCard`); the answer stays keyed
	// by card id, the key the client draws by.
	const map = memberFormOn() ? await loadSeatMapOf(db, sessionId) : undefined
	for (const id of characterIds) {
		const v = normalizeSpriteName(
			await valueOf(db, {
				sessionId,
				owner: await seatOwnerOfCard(db, sessionId, id, map),
				slotId: SPRITE_SET_SLOT_ID
			})
		)
		if (v) out[id] = v
	}
	return out
}
