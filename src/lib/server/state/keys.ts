/**
 * The names a template addresses state by.
 *
 * Lifted out of `resolve.ts` so that the expression evaluator can key a slot
 * without importing the resolver — the resolver evaluates expressions to
 * compute derived slots, and the two importing each other is a cycle. Three
 * pure string functions, no database, no registry: exactly the part both sides
 * need and neither should own.
 *
 * `resolve.ts` re-exports all three, because every existing caller imports them
 * from there and a key function has no business having two spellings.
 */

/**
 * `adventure:slot/weather@1` → `weather`.
 *
 * Templates read `state.world.weather`, not the address the row is filed under.
 * Every slot ALSO appears under its fully qualified key (`acme_rp_tension`), so
 * when two owners declare the same local name the bare key goes to whichever id
 * sorts first and neither slot becomes unreachable. One sentence, deterministic,
 * and nothing is silently lost.
 */
export const slotKey = (id: string): string =>
	id.replace(/^.*:slot\//, "").replace(/@\d+$/, "")

export const qualifiedSlotKey = (id: string): string =>
	id
		.replace(/@\d+$/, "")
		.replace(/:slot\//, "_")
		.replace(/[.\-]/g, "_")

/** A cast member's name as a template addresses it: `state.cast.verity`. */
export const castKey = (name: string): string =>
	name
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "") || "unnamed"

/**
 * 🚧 A location's key as a widget and the ledger address its owner (phase 4):
 * `location:harbor`. Prefixed so a place and a character that slug alike
 * stay two owners; a template reads the bare slug, `state.locations.harbor`.
 */
export const locationOwnerKey = (name: string): string => `location:${castKey(name)}`
