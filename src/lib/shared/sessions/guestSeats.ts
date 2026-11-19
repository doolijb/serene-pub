/**
 * 🚧 The two **guest seat switches** (owner rulings G3, G4, 2026-11-16): per
 * session, the owner's, both on by default.
 *
 * - **Guests can bring their own characters** (`guestsBringOwn`): a guest adds,
 *   swaps, removes and benches seats for character cards and personas they
 *   own, and opens a seat by naming it (a card-less player seat).
 * - **Guests can take cast members** (`guestsTakeCast`): a guest takes or
 *   leaves the seat of a card-less member of the session's cast nobody plays
 *   (unseated, or seated in play by the session's owner).
 *
 * Off freezes that kind of seat for guests as it is: a guest keeps the seats
 * they hold and can neither add, swap, remove, bench nor bring back one of
 * that kind. Nothing is unseated when a switch goes off; the owner is never
 * frozen. Stored on `sessions.metadata` (no column, no migration): a missing
 * key reads as on, so every existing session is on with nothing written.
 *
 * The write half is `$lib/server/sessions/guestSeats` (one writer). The
 * sentences live here so the server's refusal and the page's line are one
 * text.
 */

/** Where a session's *bring their own* switch lives on `sessions.metadata`. */
export const GUESTS_BRING_OWN_METADATA_KEY = "guestsBringOwn"
/** Where a session's *take cast members* switch lives on `sessions.metadata`. */
export const GUESTS_TAKE_CAST_METADATA_KEY = "guestsTakeCast"

/** The two switches as a session row holds them; a missing key is on. */
export interface GuestSeatSwitches {
	/** Guests can bring their own characters (cards and personas they own, named seats). */
	bringOwn: boolean
	/** Guests can take card-less cast members nobody plays. */
	takeCast: boolean
}

/**
 * The switches stored on a session row's `metadata`. Only a stored `false`
 * switches one off: a missing key, or anything that is not a boolean, reads
 * as on.
 */
export function storedGuestSeatSwitches(metadata: unknown): GuestSeatSwitches {
	const m =
		metadata && typeof metadata === "object" && !Array.isArray(metadata)
			? (metadata as Record<string, unknown>)
			: {}
	return {
		bringOwn: m[GUESTS_BRING_OWN_METADATA_KEY] !== false,
		takeCast: m[GUESTS_TAKE_CAST_METADATA_KEY] !== false
	}
}

/**
 * 🚧 The sentences (★ copy for the owner). Each names the session's owner as
 * the person to ask: a guest cannot leave a session by themselves either.
 */
export const GUEST_SEAT_SENTENCES = {
	/** A guest's seat action refused, and the guest's line, with *bring their own* off. */
	bringOwnOff:
		"The session's owner has switched off bringing your own characters. Ask them to change your seats.",
	/** A guest's seat action refused, and the guest's line, with *take cast members* off. */
	takeCastOff:
		"The session's owner has switched off taking cast members. Ask them to change your seats.",
	/** A guest asked for a cast member who has a card. */
	cardedMember: (name: string): string =>
		`${name} has a character card, so only the session's owner can seat them. Ask the session's owner, or take a cast member without a card.`,
	/** A guest asked for a cast member a seat already holds (a benched one too). */
	memberHeld: (name: string): string =>
		`${name} already has a seat in this session. Ask the session's owner, or take someone nobody plays.`
} as const
