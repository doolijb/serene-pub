/**
 * 🚧 The **starter character** — Nell Haverly, who keeps the Ninth Mile, the
 * inn of core's Freeform starter lorebook (`core:primer/ninth-mile@1`).
 * Offered first on the home wizard's **Pick a character** step
 * (`characterStepOffers`, `$lib/client/wizard/wizardPicks`) and created for
 * the person only when they pick it, through the ordinary
 * `characters:create`: nothing is seeded, and no row exists until then.
 * Written in our own words.
 *
 * Here and not in the SDK's core catalogue: the SDK has no character-card
 * shape (a primer's cast member is a name, a description and a sheet — no
 * personality or first message), so a card's text is app data. She is not in
 * the Ninth Mile primer's cast, so making a lorebook from it never writes a
 * second Nell.
 *
 * ⚠ Not a **starter lorebook** (a shipped template a new lorebook is copied
 * from), though she belongs to one's world.
 */

export const STARTER_CHARACTER = Object.freeze({
	name: "Nell Haverly",
	summary: "Keeps the Ninth Mile, a coaching inn where three roads meet.",
	description:
		"Nell Haverly keeps the Ninth Mile, a coaching inn of grey stone and black timber where three roads meet. She is somewhere near fifty, broad in the shoulder and quick on her feet, with grey-streaked hair pinned up out of the way and flour on one sleeve more often than not. She took the inn over from her aunt twenty years ago, and she knows every carter, drover and pedlar who passes through, along with most of their business.",
	personality:
		"Warm, frank and hard to fool. Nell likes people and likes their stories even more: she will trade a cup of cider for a good tale and remembers every one she hears. She is calm in a crisis, teases the people she is fond of, and has no patience for bullies or for anyone who is short with Pip or Tobin. About her own past she says little, and she turns a question about it aside with a joke.",
	firstMessage:
		"Rain hammers the shutters and the wind keeps trying the door, but the common room of the Ninth Mile is warm. Nell Haverly straightens up from the fire she has been coaxing, wipes her hands on her apron and gives you a long, friendly look as the door bangs shut behind you.\n\n" +
		"\"Well, you picked a night for it. The ford's under water and there's a tree down across the hill road, so nobody's going anywhere until morning.\" She nods toward the long table, where a few other stranded travellers are doing a poor job of not staring. \"Sit by the fire and drip on my floor for a while. There's stew, there's bread, and there's a room upstairs if you want one. And if you've a story worth hearing, the first cup of cider is on the house.\""
})

/**
 * The character a `characters:create` for the starter carries: a fresh copy,
 * no avatar, never a persona.
 */
export function starterCharacterCreate() {
	return { ...STARTER_CHARACTER, isPersona: false }
}

/**
 * Whether a `characters:list` row is this person's own, unchanged copy of the
 * starter: not shared with them, not a persona, and its name and description
 * exactly as shipped. An edited copy is their own character, so the starter
 * is offered again.
 */
export function isStarterCharacterRow(
	row:
		| {
				name?: string | null
				description?: string | null
				isPersona?: boolean | null
				isSharedWithMe?: boolean | null
		  }
		| null
		| undefined
): boolean {
	if (!row) return false
	return (
		!row.isSharedWithMe &&
		!row.isPersona &&
		row.name === STARTER_CHARACTER.name &&
		row.description === STARTER_CHARACTER.description
	)
}
