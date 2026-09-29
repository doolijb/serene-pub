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

/**
 * The seven, exactly as the CHECK constraint on the tables spells them.
 *
 * 🚧 `location` and `session_location` (attributes phase 4, 2026-09-26): a
 * place holds state of its own. `location` is the durable layer — a
 * `core:entry/location` lore entry, by `lorebook_entries.id` — and
 * `session_location` is this run's layer over it, by the SAME entry id
 * (exactly as `session_cast` names the character a `card` names), kept
 * apart per session by `session_id`.
 */
export const OWNER_KINDS = [
	"card",
	"cast_member",
	"lorebook",
	"session",
	"session_cast",
	"location",
	"session_location"
] as const

export type OwnerKind = (typeof OWNER_KINDS)[number]

export const isOwnerKind = (v: unknown): v is OwnerKind =>
	typeof v === "string" && (OWNER_KINDS as readonly string[]).includes(v)

/**
 * An owner, as everything above the tables names one.
 *
 * `id` means a different table per kind — `characters.id` for `card` and
 * `session_cast`, `lorebook_bindings.id` for `cast_member`, `lorebooks.id`,
 * `sessions.id`, `lorebook_entries.id` for `location` and `session_location`
 * — which is why there is no foreign key on the column and why
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
 */
export function resolutionChain(
	owner: StateOwner,
	links: {
		castMemberId?: number | null
		characterId?: number | null
		lorebookId?: number | null
	}
): StateOwner[] {
	switch (owner.kind) {
		case "session_cast": {
			const chain: StateOwner[] = [owner]
			if (links.castMemberId)
				chain.push({ kind: "cast_member", id: links.castMemberId })
			chain.push({ kind: "card", id: owner.id })
			return chain
		}
		case "session": {
			const chain: StateOwner[] = [owner]
			if (links.lorebookId)
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
