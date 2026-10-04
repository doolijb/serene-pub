import { z } from "zod"

/**
 * The one display-name rule, shared by the socket handler and every field
 * that sets it.
 *
 * A display name is what the app calls a person; the username is only how
 * they sign in. Surrounding spaces are dropped, and an empty value is not an
 * error: it clears the name, and the app goes back to the username.
 */
export const DISPLAY_NAME_MAX_LENGTH = 50

export const displayNameSchema = z
	.string()
	.trim()
	.max(
		DISPLAY_NAME_MAX_LENGTH,
		`Display name must not exceed ${DISPLAY_NAME_MAX_LENGTH} characters`
	)
	.transform((name) => (name === "" ? null : name))
