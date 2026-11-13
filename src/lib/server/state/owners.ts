/**
 * Who a stat belongs to, and how the owner kinds line up into one chain.
 *
 * Card is the template, lorebook is the world, session is the instance
 * (`DESIGN-stats-and-states.md`). Every read walks the same order —
 * session → lorebook → card → declaration default — with **absence meaning
 * inherit, never zero**. That last clause is the whole rule: a session that has
 * never touched Health reads the world's Health, and a world that has never
 * touched it reads the card's.
 *
 * A cast member is where "character" meets "world", which is why the cast chain
 * has three links and the world chain has two: there is no card behind a
 * world's weather.
 */
import { memberFormOn } from "$lib/server/state/memberForm"

/**
 * The nine, exactly as the CHECK constraint on the tables spells them.
 *
 * 🚧 `location` and `session_location` (attributes phase 4, 2026-09-26): a
 * place holds state of its own. `location` is the durable layer — a
 * `core:entry/location` lore entry, by `lorebook_entries.id` — and
 * `session_location` is this run's layer over it, by the SAME entry id
 * (exactly as `session_cast` names the character a `card` names), kept
 * apart per session by `session_id`.
 *
 * 🚧 `player_seat` (2026-10-14): a player seat in one session, by
 * `session_personas.id` — the owner a card-less player character's stats are
 * written against. Session-scoped like `session_cast`, but with no card
 * behind it, so its chain is itself alone.
 *
 * 🚧 `seated_member` (S4, ★K-1): a character seat in one session, by its
 * seated cast member (`lorebook_bindings.id`) — the owner a character seat's
 * values are stored under once the flip is on (`memberForm.ts`). Accepted by
 * `isOwnerKind` only then; while it is off, the doors translate it to the
 * seat's `session_cast` owner before anything validates it.
 */
export const OWNER_KINDS = [
	"card",
	"cast_member",
	"lorebook",
	"session",
	"session_cast",
	"location",
	"session_location",
	"player_seat",
	"seated_member"
] as const

export type OwnerKind = (typeof OWNER_KINDS)[number]

export const isOwnerKind = (v: unknown): v is OwnerKind =>
	typeof v === "string" &&
	(OWNER_KINDS as readonly string[]).includes(v) &&
	// ⏳ Refused, as before S4, until the flip is on (`memberForm.ts`).
	(v !== "seated_member" || memberFormOn())

/**
 * An owner, as everything above the tables names one.
 *
 * `id` means a different table per kind — `characters.id` for `card` and
 * `session_cast`, `lorebook_bindings.id` for `cast_member`, `lorebooks.id`,
 * `sessions.id`, `lorebook_entries.id` for `location` and `session_location`,
 * `session_personas.id` for `player_seat`, `lorebook_bindings.id` (the seated
 * cast member) for 🚧 `seated_member` — which is why there is no foreign key on the column and why
 * this type is the only place the mapping is written down for code to read.
 */
export interface StateOwner {
	kind: OwnerKind
	id: number
}

/** Which part of a declaration's `appliesTo` an owner kind belongs to. */
export const ownerFacet = (kind: OwnerKind): "cast" | "world" | "location" =>
	kind === "lorebook" || kind === "session"
		? "world"
		: kind === "location" || kind === "session_location"
			? "location"
			: "cast"

/**
 * The layers a read falls through, nearest first.
 *
 * Built from the owner the caller asked about rather than from the session,
 * because `valueOf` answers "what is this owner's value" and an owner names its
 * own starting layer: asking about a `card` must not reach a session's live
 * value, which is exactly what "portable, exportable, no session" means.
 *
 * 🚧 (m3b-V2) `ownBookMemberId` and `ownBookId` are the session's own book's
 * (read before `castMemberId` and `lorebookId`, the attached book's); the
 * caller passes them only where the session keeps its values in its notes
 * (`chainFor`).
 */
export function resolutionChain(
	owner: StateOwner,
	links: {
		castMemberId?: number | null
		ownBookMemberId?: number | null
		characterId?: number | null
		lorebookId?: number | null
		ownBookId?: number | null
	}
): StateOwner[] {
	switch (owner.kind) {
		case "session_cast": {
			const chain: StateOwner[] = [owner]
			if (links.ownBookMemberId)
				chain.push({ kind: "cast_member", id: links.ownBookMemberId })
			if (links.castMemberId && links.castMemberId !== links.ownBookMemberId)
				chain.push({ kind: "cast_member", id: links.castMemberId })
			chain.push({ kind: "card", id: owner.id })
			return chain
		}
		// 🚧 S4 (`memberForm.ts`): a seat in member form falls through what its
		// card's `session_cast` row fell through — the seat, the own book's
		// member, the attached book's member, then the card the seat holds
		// (`links.characterId`; none for a card-less seat). A player seat does
		// so only once the flip is on: before it, a carded player seat is its
		// card's `session_cast` owner and `player_seat` is a card-less seat alone.
		case "seated_member":
			return seatChain(owner, links)
		case "player_seat":
			return memberFormOn() ? seatChain(owner, links) : [owner]
		case "session": {
			const chain: StateOwner[] = [owner]
			if (links.ownBookId)
				chain.push({ kind: "lorebook", id: links.ownBookId })
			if (links.lorebookId && links.lorebookId !== links.ownBookId)
				chain.push({ kind: "lorebook", id: links.lorebookId })
			return chain
		}
		case "session_location":
			// This run's layer, then the place as the world knows it: the
			// same entry id on both links, as a seat and its card share one.
			return [owner, { kind: "location", id: owner.id }]
		case "cast_member":
			return links.characterId
				? [owner, { kind: "card", id: links.characterId }]
				: [owner]
		default:
			return [owner]
	}
}

/** 🚧 A seat's chain in member form: the seat, its members (own book's first), its card. */
function seatChain(
	owner: StateOwner,
	links: { castMemberId?: number | null; ownBookMemberId?: number | null; characterId?: number | null }
): StateOwner[] {
	const chain: StateOwner[] = [owner]
	if (links.ownBookMemberId)
		chain.push({ kind: "cast_member", id: links.ownBookMemberId })
	if (links.castMemberId && links.castMemberId !== links.ownBookMemberId)
		chain.push({ kind: "cast_member", id: links.castMemberId })
	if (links.characterId) chain.push({ kind: "card", id: links.characterId })
	return chain
}

/**
 * 🚧 ⏳ The owner a session's cast **link** (`resolve.ts` `CastMemberLink`)
 * stores its values under. Flip off (`memberForm.ts`): its card's
 * `session_cast`. Flip on: a player seat's `player_seat` (its link carries
 * `playerSeatId`), a character seat's `seated_member` by the **seat's** member
 * (`seatMemberId`, never the link's `castMemberId`); ⏳ a member-less seat
 * keeps its card's `session_cast` (the `seat-keys` pass leaves it).
 */
export function castOwnerOf(link: {
	characterId: number
	seatMemberId?: number | null
	playerSeatId?: number | null
}): StateOwner {
	if (memberFormOn()) {
		if (typeof link.playerSeatId === "number") return { kind: "player_seat", id: link.playerSeatId }
		if (typeof link.seatMemberId === "number") return { kind: "seated_member", id: link.seatMemberId }
	}
	return { kind: "session_cast", id: link.characterId }
}
