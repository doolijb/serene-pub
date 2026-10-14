/**
 * Whether the home wizard's **Character** step is on screen, for the Library
 * beside it (less-confusing plan A3, 2026-10-11).
 *
 * "Browse the library" on that step opens the Library view next to the
 * wizard, and a card taken there is chosen on the step. Inside the wizard
 * the person is picking the character the AI plays, not filling a
 * collection, so the Library detail's primary reads **Pick this character**
 * and its chip **Picked** while this says the step is active; everywhere
 * else they stay **Import** and **In your characters**.
 *
 * A module store rather than a context: the Library is mounted by the shell
 * beside the page, not under it, so nothing the home page provides reaches
 * it. The home page is the only writer (an effect that clears it again on
 * unmount); the Library detail only reads. It is never written during SSR,
 * so a server render always reads it off.
 */
export const wizardCharacterStep = $state({
	/** The Character step is the wizard's current step. */
	active: false,
	/** The character chosen on it, or null. */
	pickedCharacterId: null as number | null
})
