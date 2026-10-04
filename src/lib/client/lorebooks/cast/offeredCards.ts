/**
 * The cards the Cast board's card picker offers (plan A25).
 *
 * A card draws ONE cast member — the card they are linked to, or one a dated
 * change draws them with, on any line and at any date — and the server
 * refuses a card another member has. So the picker leaves those out: every
 * member's linked card, every other member's dated cards, and any card a
 * member reads as at the moment being read, which keeps the member's own
 * current card from being offered back. The member being given a card keeps
 * their own dated cards on offer: linking one of them is still them.
 */
export function offeredCards<C extends { id?: number }>(opts: {
	characters: readonly C[]
	/** The members as stored: `characterId` is the card each is linked to. */
	members: readonly { id: number; characterId?: number | null }[]
	/** The members as the moment reads them. */
	resolved: readonly { id?: number; characterId?: number | null }[]
	/** A member's cast amendments. */
	amendmentsOf: (
		memberId: number
	) => readonly { fields?: Record<string, unknown> | null }[]
	/** The member the card is for; null for a new member. */
	target: number | null
}): C[] {
	const taken = new Set<number>()
	const take = (id: unknown) => {
		if (typeof id === "number") taken.add(id)
	}
	for (const member of opts.members) {
		take(member.characterId)
		if (member.id === opts.target) continue
		for (const amendment of opts.amendmentsOf(member.id))
			take(amendment.fields?.characterId)
	}
	for (const member of opts.resolved) take(member.characterId)
	return opts.characters.filter((c) => c.id == null || !taken.has(c.id))
}
