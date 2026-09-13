/**
 * Who a stat belongs to, and how the five owner kinds line up into one chain.
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

/** The five, exactly as the CHECK constraint on the tables spells them. */
export const OWNER_KINDS = [
	"card",
	"cast_member",
	"lorebook",
	"session",
	"session_cast"
] as const

export type OwnerKind = (typeof OWNER_KINDS)[number]

export const isOwnerKind = (v: unknown): v is OwnerKind =>
	typeof v === "string" && (OWNER_KINDS as readonly string[]).includes(v)

/**
 * An owner, as everything above the tables names one.
 *
 * `id` means a different table per kind — `characters.id` for `card` and
 * `session_cast`, `lorebook_bindings.id` for `cast_member`, `lorebooks.id`,
 * `sessions.id` — which is why there is no foreign key on the column and why
 * this type is the only place the mapping is written down for code to read.
 */
export interface StateOwner {
	kind: OwnerKind
	id: number
}

/** Which half of a declaration's `appliesTo` an owner kind belongs to. */
export const ownerFacet = (kind: OwnerKind): "cast" | "world" =>
	kind === "lorebook" || kind === "session" ? "world" : "cast"

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
		case "cast_member":
			return links.characterId
				? [owner, { kind: "card", id: links.characterId }]
				: [owner]
		default:
			return [owner]
	}
}
