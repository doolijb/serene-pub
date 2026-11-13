/**
 * Greeting seeding — the create pipeline's behaviour, as callable halves
 * (24 §12, T8).
 *
 * Moved out of `sessions.ts`'s create handler so the same logic serves the
 * pipeline path: `collectSessionGreetings` is what the
 * `core:query/session-greetings@1` node reads through the host, and
 * `writeSessionGreetings` is what `core:outlet/seed-greetings@1` commits.
 * One implementation behind two declared nodes — parity by construction, and
 * the byte-parity test (createChat.parity.int.test.ts) guards the seam
 * against drift.
 */
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { insertLegacy } from "$lib/server/messages/store"
import { canonicalChannel } from "$lib/server/messages/channels"
import { InterpolationEngine } from "$lib/server/utils/interpolation/InterpolationEngine"
import { resolveCharacterName } from "$lib/shared/utils/resolveCharacterName"
import {
	cardlessSeatCard,
	seatCardAsRead,
	seatMembersAsRead,
	type SeatCardRow
} from "$lib/server/pipelines/prompt/seatCards"
import { cardsNow } from "$lib/server/cast/seatedCast"
import { withSeatName } from "$lib/server/sessions/seatName"

// db is the global Db — see db/types.d.ts

/**
 * The greeting history for one character's first message — the first entry
 * seeds the message, the rest are the swipes a person can flip through.
 * Interpolated against the session's first persona ({{char}}, {{user}}).
 */
export function buildCharacterFirstSessionMessage({
	character,
	persona,
	isGroup
}: {
	character: SelectCharacter
	persona: SelectCharacter | undefined | null
	isGroup: boolean
}): string[] {
	const history: string[] = []
	const engine = new InterpolationEngine()
	const context = engine.createInterpolationContext({
		currentCharacterName: resolveCharacterName(character),
		currentPersonaName: persona?.name || "User"
	})
	if (!isGroup || !character.groupOnlyGreetings?.length) {
		if (character.firstMessage) {
			history.push(
				engine.interpolateString(character.firstMessage.trim(), context)!
			)
		}
		if (character.alternateGreetings) {
			history.push(
				...character.alternateGreetings.map(
					(g) => engine.interpolateString(g.trim(), context)!
				)
			)
		}
	} else if (character.groupOnlyGreetings?.length) {
		// A group session uses only group greetings.
		history.push(
			...character.groupOnlyGreetings.map(
				(g) => engine.interpolateString(g.trim(), context)!
			)
		)
	} else {
		// Fallback firstMessage if no greetings are available.
		history.push(
			`Sits down at the table, "I didn't think you'd show up so soon."`
		)
	}
	return history
}

/**
 * 🚧 Seat rows with their card as the session reads it: the member each seat
 * seats, laid over the card's **current card version** (`cardsNow`, never the
 * row's ⏳ copy or frozen columns); a seat no member answers for reads the
 * card's current version alone. Order and every other key kept.
 *
 * `cardless` (character seats only — a player seat never takes it): a row with
 * NO card that stores a member reads that member's own fields as an id-less
 * card-shaped row (`cardlessSeatCard`).
 */
async function seatsAsRead<
	R extends SeatCardRow & { character?: SelectCharacter | null }
>(
	db: Db,
	sessionId: number,
	rows: readonly R[],
	opts: { cardless?: boolean } = {}
): Promise<R[]> {
	const asReads = await seatMembersAsRead(db, sessionId, rows, opts)
	const now = await cardsNow(
		db,
		rows.flatMap((row) => (row.character ? [row.character.id] : []))
	)
	return rows.map((row, i) => {
		if (!row.character) {
			const asRead = asReads[i]
			return opts.cardless && asRead && row.castMemberId != null
				? {
						...row,
						character: cardlessSeatCard(
							asRead
						) as unknown as SelectCharacter
					}
				: row
		}
		const base = (now.get(row.character.id) ??
			row.character) as unknown as SelectCharacter
		const asRead = asReads[i]
		return {
			...row,
			character: asRead ? seatCardAsRead(base, asRead) : base
		}
	})
}

export interface SessionGreetingEntry {
	/** The card the seat holds; null for a card-less seat (then `castMemberId` is the speaker). */
	characterId: number | null
	/** A card-less seat's member — written as `metadata.speaker = "seated-member:<id>"`; absent for a carded seat. */
	castMemberId?: number
	/** First entry is the message; the whole list becomes the swipe history. */
	texts: string[]
}

/**
 * What the session's cast wants to say first — the read half. Position
 * order, interpolated against the first persona, empty when the session has
 * no characters (an ordinary state, not a failure).
 */
export async function collectSessionGreetings(
	db: Db,
	sessionId: number
): Promise<{ isGroup: boolean; entries: SessionGreetingEntry[] }> {
	const [session] = await db
		.select({ isGroup: schema.sessions.isGroup })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	const isGroup = !!session?.isGroup

	// ⚠ `asc(cc.position)`, not `asc(cc.position ?? 0)`. The callback is handed
	// the TABLE, so `cc.position` is a column object and never nullish — the
	// coalesce could only ever have fired on a column that does not exist, and
	// both tables have had `position` since the cast rows did. Ordering is
	// unchanged.
	const sessionCharacters = await db.query.sessionCharacters.findMany({
		// Character seats: not an envoy, and a card or a member (a card-less
		// seat has a member only).
		where: (cc, { eq, and, or, isNull, isNotNull }) =>
			and(
				eq(cc.sessionId, sessionId),
				isNull(cc.envoySlug),
				or(isNotNull(cc.characterId), isNotNull(cc.castMemberId))
			),
		with: { character: true },
		orderBy: (cc, { asc }) => asc(cc.position)
	})
	const sessionPersona = await db.query.sessionPersonas.findFirst({
		where: (cp, { eq, and, isNotNull }) =>
			and(eq(cp.sessionId, sessionId), isNotNull(cp.personaId)),
		with: { persona: true },
		orderBy: (cp, { asc }) => asc(cp.position)
	})

	// A seat greets in the words of the cast member it seats — their own
	// name, and the first message and other greetings they retell — over the
	// member's active card (seat-cast S2: `seatCardsAsRead`, which finds the
	// member wherever it lives, the session's own book included). Nobody
	// retelling: the card's words.
	const seats = await seatsAsRead(db, sessionId, sessionCharacters, {
		cardless: true
	})
	// `{{user}}` is the first player seat's name: its member as read (★pT-1,
	// 2026-11-05: "Everything in session is cast -> active card"), a seat
	// name still winning.
	const [personaSeat] = sessionPersona
		? await seatsAsRead(db, sessionId, [
				{
					castMemberId: sessionPersona.castMemberId,
					character: sessionPersona.persona
				}
			])
		: []
	const persona = withSeatName(personaSeat?.character, sessionPersona?.seatName)

	const entries: SessionGreetingEntry[] = []
	for (const cc of seats) {
		if (!cc.character) continue
		// A card-less seat greets only while it is live.
		if (cc.characterId == null && cc.removedAt != null) continue
		const texts = buildCharacterFirstSessionMessage({
			character: cc.character,
			persona,
			isGroup
		})
		// The row's own `characterId` column — a card-less seat's `character`
		// carries no id, and a member id is never a card id.
		if (texts.length > 0)
			entries.push(
				cc.characterId == null
					? {
							characterId: null,
							castMemberId: cc.castMemberId!,
							texts
						}
					: { characterId: cc.characterId, texts }
			)
	}
	return { isGroup, entries }
}

/**
 * Seed the greetings — the write half. One assistant message per entry, the
 * full list as its swipe history, on the genre's declared greeting channel.
 *
 * The channel goes on the legacy row, which the mirror carries (20 §7, 0200).
 * It used to be patched onto `messages` after the insert, because the legacy
 * row had no channel to write — which made this the one production writer
 * that reached past the store, and made a lane something the prompt-facing
 * read could not see.
 */
export async function writeSessionGreetings(
	db: Db,
	opts: {
		sessionId: number
		userId: number
		entries: SessionGreetingEntry[]
		channel?: string
	}
): Promise<number[]> {
	// Canonical (ruling 2026-09-09): lane 1 is the bare slug, so a genre that
	// redirects its greetings to `intro:1` and one that says `intro` seed onto
	// one lane rather than two.
	const channel = canonicalChannel(opts.channel)
	const ids: number[] = []
	for (const entry of opts.entries) {
		const created = await insertLegacy(db, {
			userId: opts.userId,
			sessionId: opts.sessionId,
			personaId: null,
			characterId: entry.characterId,
			role: "assistant",
			channel,
			content: entry.texts[0],
			isGenerating: false,
			metadata: {
				// A card-less seat speaks as its member; the store's speaker
				// stamp (rule d) fills `cast_member_id` from this.
				...(entry.characterId == null && entry.castMemberId != null
					? { speaker: `seated-member:${entry.castMemberId}` }
					: {}),
				isGreeting: true,
				swipes: {
					currentIdx: 0,
					history: entry.texts
				}
			}
		})
		ids.push(created.id)
	}
	return ids
}

/**
 * A seated envoy's **declared greeting**, interpolated — the read half of
 * `core:query/envoy-greeting@1` (lair re-plan R6, 2026-09-28): the line the
 * Lair's Castellan opens every new session with.
 *
 * `undefined` — the write is skipped — when the envoy is not live-seated in
 * the session, or declares no greeting. Interpolated with the same engine
 * the cards' greetings use: `{{char}}` is the envoy's name, `{{user}}` and
 * `{{playerLabel}}` the session's player label (R4; the cascade every reader
 * uses), `{{characterNames}}` the party's names joined with "and" (empty at
 * creation for a genre that seats nobody yet — the copy writes `{{#if}}`).
 * No model call: a create run is a person waiting.
 */
export async function collectEnvoyGreeting(
	db: Db,
	sessionId: number,
	envoyKey: string | undefined,
	language = "en"
): Promise<{ text: string; channel: string } | undefined> {
	const key = envoyKey?.trim()
	if (!key) return undefined
	const { seatedEnvoys } = await import(
		"$lib/server/pipelines/entities/envoys"
	)
	const seat = (await seatedEnvoys(db, sessionId)).find(
		(e) => e.origin === "genre" && e.key === key && !e.removedAt
	)
	const greeting = seat?.greeting
	if (!seat || !greeting) return undefined
	const { i18nText } = await import("@serene-pub/sdk")
	const template = i18nText(greeting.text, language)?.trim()
	if (!template) return undefined
	const name = i18nText(seat.name, language) || seat.key
	const { playerLabelFor } = await import(
		"$lib/server/pipelines/entities/sessionGenres"
	)
	const playerLabel = await playerLabelFor(db, sessionId)
	const party = await db.query.sessionCharacters.findMany({
		where: (cc, { and, eq, or, isNull, isNotNull }) =>
			and(
				eq(cc.sessionId, sessionId),
				isNull(cc.envoySlug),
				or(isNotNull(cc.characterId), isNotNull(cc.castMemberId)),
				isNull(cc.removedAt)
			),
		with: { character: true },
		orderBy: (cc, { asc }) => asc(cc.position)
	})
	const { joinWithAnd } = await import("$lib/shared/utils/joinWithAnd")
	// The party's names are the members' own, as the session reads them.
	const partyRead = await seatsAsRead(db, sessionId, party, {
		cardless: true
	})
	const characterNames = joinWithAnd(
		partyRead
			.filter((cc) => cc.character && cc.isActive !== false)
			.map((cc) => resolveCharacterName(cc.character!))
	)
	const engine = new InterpolationEngine()
	const context = engine.createInterpolationContext({
		currentCharacterName: name,
		currentPersonaName: playerLabel,
		additionalContext: {
			...(playerLabel ? { playerLabel } : {}),
			characterNames
		}
	})
	const text = engine.interpolateString(template, context)?.trim()
	if (!text) return undefined
	return { text, channel: canonicalChannel(greeting.channel) }
}
