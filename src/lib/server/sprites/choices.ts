/**
 * What a line's speaker can show — the host half of
 * `core:query/sprites-for@1` (DESIGN-sprites §2.3, §5.2).
 *
 * The sprite SET is decided in one order, and `decidedBy` names which rung
 * decided it so the receipt answers "why this outfit":
 *
 *   1. `override`  — the session's `core:slot/sprite-set@1` on the speaker
 *                    (play, not canon: "she changed clothes in this scene");
 *   2. `amendment` — the cast member's `spriteSet`, resolved through
 *                    `castMemberAsOf` (the ONE server-side cast resolver —
 *                    agreed with the lorebooks session, never a second path);
 *   3. `default`   — the card's default set.
 *
 * A name that the resolved card has no set for falls to the default set and
 * says so (`missing`), never silently.
 *
 * ⚠ The CARD whose sprites are read is the cast member's RESOLVED
 * `characterId`, not the session's: a card-swap amendment ("the older card
 * from Y20") brings that card's art with it, which is the case the ruling was
 * built for.
 *
 * ⚠ Appearances: a member placed twice at one moment is two people
 * (`castMemberAsOf(...).appearances`). A session speaker names a card, not an
 * appearance, so this reads the un-narrowed `member` — one face per card —
 * until a speaker can name which appearance is talking.
 */

import { and, desc, eq, lt } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { valueOf } from "$lib/server/state/resolve"
import { castMemberAsOf } from "$lib/server/sockets/amendments"
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

export type SpriteSetDecidedBy = "override" | "amendment" | "default"

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
	/** The line's text. */
	text: string
	/** Anything to choose between — the tail's junction reads this. */
	has: boolean
}

const nothing = (text = ""): SpriteChoicesV1 => ({
	characterId: null,
	set: null,
	defaultSet: null,
	labels: [],
	last: null,
	recent: [],
	decidedBy: "default",
	text,
	has: false
})

export async function spriteChoicesFor(
	db: Db,
	params: { sessionId: number; messageId: number }
): Promise<SpriteChoicesV1> {
	const message = await db.query.sessionMessages.findFirst({
		where: and(
			eq(schema.sessionMessages.id, params.messageId),
			eq(schema.sessionMessages.sessionId, params.sessionId)
		),
		columns: {
			id: true,
			content: true,
			characterId: true,
			isNarratorResponse: true
		}
	})
	if (!message) return nothing()
	const text = message.content ?? ""
	// A narrator's line, a person's line: no character speaker, no face.
	if (!message.characterId || message.isNarratorResponse) return nothing(text)
	const speakerId = message.characterId

	const session = await db.query.sessions.findFirst({
		where: eq(schema.sessions.id, params.sessionId),
		columns: { lorebookId: true, lorebookBranchId: true }
	})

	// ── Which set, and whose card ──────────────────────────────────────────
	let cardId = speakerId
	let wanted: string | null = null
	let decidedBy: SpriteSetDecidedBy = "default"

	const override = await valueOf(db, {
		sessionId: params.sessionId,
		owner: { kind: "session_cast", id: speakerId },
		slotId: SPRITE_SET_SLOT_ID
	})
	if (session?.lorebookId) {
		const resolved = await castMemberAsOf(db, {
			lorebookId: session.lorebookId,
			characterId: speakerId,
			at: { branchId: session.lorebookBranchId ?? null }
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

	const art = (await spriteLabelsFor(db, [cardId])).get(cardId)
	if (!art || art.sets.size === 0) return { ...nothing(text), characterId: cardId }
	const defaultSet = art.defaultSet ?? [...art.sets.keys()][0]

	let set = defaultSet
	let missing: string | undefined
	if (wanted) {
		if (art.sets.has(wanted)) set = wanted
		else {
			missing = wanted
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
				lt(schema.sessionMessages.id, message.id)
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
		text,
		has: labels.length > 0
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
