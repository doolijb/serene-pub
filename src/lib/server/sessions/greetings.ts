/**
 * Greeting seeding — the create pipeline's behaviour, as callable halves
 * (24 §12, T8).
 *
 * Moved out of `sessions.ts`'s create handler so the same logic serves the
 * pipeline path: `collectSessionGreetings` is what the
 * `core:query/session-greetings@1` node reads through the host, and
 * `writeSessionGreetings` is what `core:consumer/seed-greetings@1` commits.
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
	persona: SelectPersona | undefined | null
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

export interface SessionGreetingEntry {
	characterId: number
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
		where: (cc, { eq }) => eq(cc.sessionId, sessionId),
		with: { character: true },
		orderBy: (cc, { asc }) => asc(cc.position)
	})
	const sessionPersona = await db.query.sessionPersonas.findFirst({
		where: (cp, { eq, and, isNotNull }) =>
			and(eq(cp.sessionId, sessionId), isNotNull(cp.personaId)),
		with: { persona: true },
		orderBy: (cp, { asc }) => asc(cp.position)
	})

	const entries: SessionGreetingEntry[] = []
	for (const cc of sessionCharacters) {
		if (!cc.character) continue
		const texts = buildCharacterFirstSessionMessage({
			character: cc.character,
			persona: sessionPersona?.persona,
			isGroup
		})
		if (texts.length > 0)
			entries.push({ characterId: cc.character.id, texts })
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
