import { z } from "zod"

/**
 * Shared types and helpers of the Edit Session form and the cards drawn out
 * of it (`EditSessionForm.svelte`, `SessionBenchedSeats.svelte`, …).
 */

// Populated either from the full session load (session.sessionCharacters/Personas,
// which carry the complete row) or from CharacterSelectModal/
// PersonaSelectModal (which only carry the display-column subset from
// "characters:list") — Partial<...> reflects the latter. A persona is a
// character the user voices, so both lists hold the same row shape.
export type SeatCard = Partial<SelectCharacter> & { id: number }

/** The session the form edits, as `sessions:get` answers it. */
type EditedSession = NonNullable<Sockets.Sessions.Get.Response["session"]>
/** A character seat's saved side (`session.sessionCharacters`). */
export type SavedCharacterSeat = NonNullable<
	EditedSession["sessionCharacters"]
>[number]
/** A player seat's saved side (`session.sessionPersonas`). */
export type SavedPlayerSeat = NonNullable<
	EditedSession["sessionPersonas"]
>[number]

/**
 * 🚧 The session's card-less player seats (`isCardlessPlayerSeat`): a
 * player character with no card, shown by its seat name — renamed or
 * removed here, committed by Save (`playerSeatChanges`). `userId` is the
 * seat's player: a guest edits only their own.
 */
export type PlayerSeatDraft = {
	id: number
	name: string
	userId: number | null
}

export type SeatKind = "character" | "member" | "persona" | "player"

export type ValidationErrors = Record<string, string>

// The F29 floor (19 §2) — defined once in the shared standardGenre module,
// re-exported here. When "sessions:genres" returns nothing (a
// registry that never synced), the form behaves exactly as before modes
// existed: no picker, every section shown, today's save rules.
export { STANDARD_GENRE_ID } from "$lib/shared/sessions/standardGenre"

// Zod validation schema
export const sessionSchema = z.object({
	name: z.string().min(1, "Session name is required").trim(),
	scenario: z.string().optional()
})

/** The card a section sits in: the shared `panel-card` utility. */
export const CARD_CLASS = "panel-card"

/**
 * The guests the form wants. A pending change like the cast (note 34):
 * added and removed here, committed by Save as the difference from the
 * session's saved guests (`guestChanges`), dropped with the form. A row
 * picked but not yet saved carries only the user the picker returned.
 */
export type GuestRow = {
	userId: number
	user?: { username?: string | null; displayName?: string | null } | null
}

/** A seat the bench draft moves: which seat (by the id its write names) and where it should end up. */
export type BenchChange = {
	seat: {
		characterId?: number
		castMemberId?: number
		playerSeatId?: number
	}
	enabled: boolean
}

/** The seated ids, then the benched ones: the turn order is the seated order. */
export function seatedThenBenchedIds(
	seated: ReadonlyArray<{ id: number }>,
	benched: ReadonlyArray<{ id: number }>
): number[] {
	return [...seated, ...benched].map((s) => s.id)
}
export function characterPositionsOf(
	seated: ReadonlyArray<{ id: number }>,
	benched: ReadonlyArray<{ id: number }>
): Record<number, number> {
	return Object.fromEntries(
		[...seated, ...benched].map((cc, i) => [cc.id, i])
	)
}

export const cardLabel = (c: SeatCard) => c.nickname || c.name || ""

/** 🚧 The "Played by" control of one seat: the person now (a user id as a string) and who it may be given to. */
export type PlayedByChoice = {
	value: string
	options: Array<{ value: string; label: string }>
	/**
	 * The move half of the control: the seat's name, the sentence of a pick
	 * awaiting confirmation (null when none), and whether a confirmed move is
	 * held until Save.
	 */
	move?: { name: string; sentence: string | null; drafted: boolean }
}
