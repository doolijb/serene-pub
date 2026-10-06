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
 *   2. `amendment` — the cast member's `spriteSet`, resolved through
 *                    `cardMemberAt` (the card-keyed entry point to the one
 *                    cast resolver, `castAsOf` — never a second resolver);
 *   3. `default`   — the card's default set.
 *
 * A name that the resolved card has no set for falls to the default set and
 * says so (`missing`, and `missingAskedBy` the rung that asked), never silently.
 *
 * ⚠ The CARD whose sprites are read is the cast member's RESOLVED
 * `characterId`, not the session's: a card-swap amendment ("the older card
 * from Y20") brings that card's art with it, which is the case the ruling was
 * built for. A swapped-in card with no sprites at all falls back to the
 * member's OWN card rather than to no face — a missing portrait is not a
 * different person.
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
import { sessionReadingOf, lineOfReading } from "$lib/server/state/reading"
import { cardMemberAt } from "$lib/server/sockets/amendments"
import { spriteLabelsFor } from "$lib/server/sprites"
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
	/** The card whose sprites these are — the speaker's, after any card swap. */
	characterId: number | null
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
		/** The speaker's card — `character:<id>`'s id. */
		characterId: number
		/** A set the spec wired to the picker (`decidedBy: "spec"`). */
		set?: unknown
		/** The run's own row (`run.liveRow`), left out of "recent". */
		excludeMessageId?: number
	}
): Promise<SpriteChoicesV1> {
	const speakerId = params.characterId
	if (!Number.isInteger(speakerId) || speakerId <= 0) return nothing()

	const reading = await sessionReadingOf(db, params.sessionId)

	// ── Which set, and whose card ──────────────────────────────────────────
	let cardId = speakerId
	let wanted: string | null = null
	let decidedBy: SpriteSetDecidedBy = "default"

	const override = await valueOf(db, {
		sessionId: params.sessionId,
		owner: { kind: "session_cast", id: speakerId },
		slotId: SPRITE_SET_SLOT_ID
	})
	if (reading) {
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

	let art = (await spriteLabelsFor(db, [cardId])).get(cardId)
	// The swapped-in card has no art: the member's own card still does.
	if ((!art || art.sets.size === 0) && cardId !== speakerId) {
		const own = (await spriteLabelsFor(db, [speakerId])).get(speakerId)
		if (own && own.sets.size > 0) {
			cardId = speakerId
			art = own
		}
	}
	if (!art || art.sets.size === 0) return { ...nothing(), characterId: cardId }
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
				eq(schema.sessionMessages.characterId, speakerId),
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
		characterId: cardId,
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
			owner: { kind: "session_cast", id: params.characterId },
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
	for (const id of characterIds) {
		const v = normalizeSpriteName(
			await valueOf(db, {
				sessionId,
				owner: { kind: "session_cast", id },
				slotId: SPRITE_SET_SLOT_ID
			})
		)
		if (v) out[id] = v
	}
	return out
}
