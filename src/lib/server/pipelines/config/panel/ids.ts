/**
 * An option's opaque handle.
 *
 * 05 §0a puts structural editing behind a system setting, so the payload
 * carries **no topology** — not the node key, not the count, not the order. The
 * id is an HMAC over the address keyed on the instance secret, which buys two
 * things at once: it is not an encoding anyone can read back, and a handle
 * lifted from another install names nothing here.
 *
 * Resolving an id is therefore a *search* — mint every address's id and look
 * for a match (see `locate` in `write.ts`) — and that is deliberate. The
 * alternative, a reversible encoding, is the same leak this rule exists to
 * prevent, one base64 decode away.
 */

import { createHmac } from "node:crypto"

/**
 * The opaque handle for an address.
 *
 * Keyed on the instance secret so it is stable for this install and meaningless
 * on any other. Hex, and only hex: the payload is scanned for node keys, and an
 * id that could spell one would be a leak wearing a hash's clothes.
 */
export function optionId(
	secret: string,
	nodeKey: string,
	slot: string,
	path: string
): string {
	return createHmac("sha256", secret)
		.update(`${nodeKey}\u0000${slot}\u0000${path}`)
		.digest("hex")
		.slice(0, 32)
}
