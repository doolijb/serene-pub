/**
 * Facts about embeddings that BOTH sides need, and neither should re-spell.
 *
 * Two values that both sides read: the capability the embedding star registers,
 * and the idle-unload default. ⚠ Neither may be re-spelled anywhere. A capability
 * id is a PRIMARY KEY value, and a default written out twice is a number that can
 * be changed in one place and not the other.
 *
 * Client-safe on purpose: the sidebar reads the capability to find the star, and
 * the server reads it through `$lib/server/embedding/target`.
 */

/**
 * The transform `connection_defaults` keys the embedding star by.
 *
 * ⚠ The server re-exports this as `EMBEDDING_CAPABILITY` rather than declaring
 * its own. A second spelling of a PRIMARY KEY value is a row nothing ever
 * matches again.
 */
export const EMBEDDING_CAPABILITY = "text->embedding"

/** How long an idle local model stays resident, when the row says nothing. */
export const DEFAULT_EMBEDDING_TTL_MINUTES = 5

/**
 * Are embeddings on?
 *
 * **The star IS the switch.** There is no enabled column anywhere in the schema:
 * every screen asks this, and gets its answer from the same row the runtime
 * resolves. A stored boolean beside it would be a second value to keep in step
 * with the endpoint config.
 *
 * A function rather than the expression pasted at each site, because there are
 * five of them and a capability id spelled five ways is five places that can be
 * spelled differently.
 *
 * Takes the map `systemSettings:get` carries (`SystemSettingsCtx.capabilityDefaults`)
 * so nothing client-side has to know the storage shape.
 */
export function embeddingsStarred(
	capabilityDefaults:
		| Record<string, { connectionId?: number | null }>
		| undefined
		| null
): boolean {
	return (
		(capabilityDefaults?.[EMBEDDING_CAPABILITY]?.connectionId ?? null) !==
		null
	)
}
