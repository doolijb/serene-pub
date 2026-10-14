/**
 * **Retold fields** (PLAN-cast-retold-fields-2026-10-13; NOMENCLATURE §8).
 *
 * A card is a starter. A cast member may tell some of the card's fields in
 * its own words: `lorebook_bindings.retold` is `Partial<Record<RetoldField,
 * boolean>>`, where `true` means the member's own column is read and
 * `false`/absent means the card's value reads through. The member's column is
 * KEPT either way — switching a field back to the card hides the member's
 * text, never discards it.
 *
 * ⚠ Not *override* (a config scope), not *amendment* (a dated overlay — the
 * retold flags and columns are themselves amendable), not *diverged*.
 *
 * `face` is the picture the member is drawn with (`face_media_id`); not a
 * *portrait* (the picture pipeline), not an *avatar* (the card's own picture).
 */
export const RETOLD_FIELDS = [
	"description",
	"personality",
	"scenario",
	"firstMessage",
	"alternateGreetings",
	"exampleDialogues",
	"face"
] as const

export type RetoldField = (typeof RETOLD_FIELDS)[number]

/** The retold flags as stored on a cast member. */
export type RetoldFlags = Partial<Record<RetoldField, boolean>>

/** The retold fields that carry prose (everything but `face`). */
export const RETOLD_TEXT_FIELDS = [
	"description",
	"personality",
	"scenario",
	"firstMessage",
	"exampleDialogues"
] as const satisfies readonly RetoldField[]

export function isRetoldField(value: unknown): value is RetoldField {
	return (
		typeof value === "string" &&
		(RETOLD_FIELDS as readonly string[]).includes(value)
	)
}

/**
 * Validate a `retold` value from a client. Returns the flags, or an error
 * sentence. Keys must be retold fields and values booleans.
 */
export function parseRetoldFlags(
	value: unknown
): { ok: true; retold: RetoldFlags } | { ok: false; error: string } {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return {
			ok: false,
			error: "Retold fields must be an object of field names to true or false."
		}
	}
	const retold: RetoldFlags = {}
	for (const [key, flag] of Object.entries(value as Record<string, unknown>)) {
		if (!isRetoldField(key)) {
			return {
				ok: false,
				error: `"${key}" is not a field a cast member can retell. Retold fields are ${RETOLD_FIELDS.join(", ")}.`
			}
		}
		if (typeof flag !== "boolean") {
			return {
				ok: false,
				error: `The retold flag for "${key}" must be true or false.`
			}
		}
		retold[key] = flag
	}
	return { ok: true, retold }
}

/** The fields a member's flags say are retold, in canonical order. */
export function retoldFieldList(
	retold: RetoldFlags | null | undefined
): RetoldField[] {
	if (!retold) return []
	return RETOLD_FIELDS.filter((field) => retold[field] === true)
}
