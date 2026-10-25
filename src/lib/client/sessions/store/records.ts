/**
 * 🚧 The session store's records (pr-6s2 G3) and the two pure helpers that split a
 * `sessions:get` payload into them and compose the cast back. No runes: the store
 * (`sessionStore.svelte.ts`) holds these types in maps.
 */

/** The session as `sessions:get` / `sessions:refresh` carry it (the page's `session`, composed back from the records). */
export type SessionPayload = NonNullable<Sockets.Sessions.Get.Response["session"]>
/** 🚧 One session's row as the session store holds it: the payload without its four collections (each is its own record). */
export type SessionRecord = Omit<
	SessionPayload,
	"sessionMessages" | "sessionCharacters" | "sessionPersonas" | "sessionGuests"
>
/** 🚧 One message row, by its id. */
export type SessionMessageRecord = SessionPayload["sessionMessages"][number]
/** 🚧 One card a seat wears (`characters.id`): a cast member's and a persona's are one record. */
export type SessionCardRecord = SessionPayload["sessionCharacters"][number]["character"]
/** 🚧 One session's members: its two seat kinds without the card each wears (the store's cards hold it), and its guests. */
export interface SessionMembersRecord {
	characters: Omit<SessionPayload["sessionCharacters"][number], "character">[]
	personas: Omit<SessionPayload["sessionPersonas"][number], "persona">[]
	/** As the payload carried it; undefined when it carried none. */
	guests: SessionPayload["sessionGuests"]
}
/** 🚧 One scene of the open session's `scenes:list`, by its id (G §G-5b: carries `loreSources`). */
export type SessionSceneRecord = Sockets.Scenes.List.SceneWithEntry
/** 🚧 One run in flight, by its run id: its newest `sessions:runStatus` frame (G §G-3). Dropped on the end frame (`status: null`). */
export interface SessionRunRecord {
	sessionId: number
	runId: string
	kind: import("@serene-pub/sdk").RunKind
	status: import("@serene-pub/sdk").StatusText
	/** A reply run, on this channel. */
	reply?: { channel: string }
}
/** 🚧 The session's genre row as `sessions:genreOf` answered; null = answered, not offered here. */
export type SessionGenreRecord = Sockets.Sessions.GenreOf.Response["genre"]
/** 🚧 Which message rows the page holds, ascending, and how it pages. */
export interface SessionMessageWindow {
	ids: readonly number[]
	pagination: Sockets.Sessions.Get.Response["pagination"]
}
/** 🚧 The three collections composed back with their cards — what `castOf` returns. */
export interface SessionCast {
	sessionCharacters: SessionPayload["sessionCharacters"]
	sessionPersonas: SessionPayload["sessionPersonas"]
	/** Present only when the members record holds guests. */
	sessionGuests?: SessionPayload["sessionGuests"]
}
/** 🚧 What `patchSession` may change: the row's own fields, plus the three the payload carries untyped. */
export type SessionPatch = Partial<SessionRecord> & {
	rewind?: import("$lib/shared/sessions/rewind").RewindState | null
	channels?: unknown
	spriteSetOverrides?: Record<number, unknown>
}

/** Splits one payload into its records. Pure. Rows sorted ascending by id; cards are each seat's nested card (a null card skipped). */
export function splitPayload(p: SessionPayload): {
	session: SessionRecord
	rows: SessionMessageRecord[]
	members: SessionMembersRecord
	cards: NonNullable<SessionCardRecord>[]
} {
	const { sessionMessages, sessionCharacters, sessionPersonas, sessionGuests, ...session } = p
	const rows = [...(sessionMessages ?? [])].sort((a, b) => a.id - b.id)
	const byId = new Map<number, NonNullable<SessionCardRecord>>()
	const characters = (sessionCharacters ?? []).map((seat) => {
		const { character, ...rest } = seat
		if (character) byId.set(character.id, character)
		return rest
	})
	const personas = (sessionPersonas ?? []).map((seat) => {
		const { persona, ...rest } = seat
		if (persona) byId.set((persona as { id: number }).id, persona as NonNullable<SessionCardRecord>)
		return rest
	})
	return {
		session: session as SessionRecord,
		rows,
		members: { characters, personas, guests: sessionGuests },
		cards: [...byId.values()]
	}
}

/** Composes a members record back with its cards — a seat whose card the store lacks gets `null` (as the server sends a seat with no card). Pure. */
export function composeCast(
	members: SessionMembersRecord,
	card: (id: number) => SessionCardRecord | undefined
): SessionCast {
	const out: SessionCast = {
		sessionCharacters: members.characters.map((s) => ({
			...s,
			character: (s.characterId != null ? card(s.characterId) : undefined) ?? null
		})) as SessionCast["sessionCharacters"],
		sessionPersonas: members.personas.map((s) => ({
			...s,
			persona: (s.personaId != null ? card(s.personaId) : undefined) ?? null
		})) as SessionCast["sessionPersonas"]
	}
	if (members.guests !== undefined) out.sessionGuests = members.guests
	return out
}
