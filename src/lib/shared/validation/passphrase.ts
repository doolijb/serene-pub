import { z } from "zod"

/**
 * The one passphrase rule.
 *
 * Extracted from `sockets/users.ts` so the environment-driven recovery reset
 * (26 §10, tier 3) enforces exactly what the socket layer does. Without a
 * shared definition, `.env` becomes a route to a password the app's own UI
 * would have refused — which is how a break-glass quietly becomes a way to
 * weaken an account rather than recover it.
 */
export const passphraseSchema = z
	.string()
	.min(10, "Passphrase must be at least 10 characters long")
	.max(128, "Passphrase must be at most 128 characters long")
	.regex(/[a-z]/, "Passphrase must contain at least one lowercase letter")
	.regex(/[A-Z]/, "Passphrase must contain at least one uppercase letter")
	.regex(
		/[^a-zA-Z0-9]/,
		"Passphrase must contain at least one special character"
	)
