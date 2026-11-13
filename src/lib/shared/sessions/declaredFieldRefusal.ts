/** A refusal when `fields` is not a plain object of the genre's DECLARED fields. Pure given the keys. */
export function declaredFieldRefusal(
	fields: unknown,
	declared: readonly string[] | null,
	genreId: string
): string | null {
	if (fields === undefined) return null
	if (!fields || typeof fields !== "object" || Array.isArray(fields))
		return "The fields are an object of values."
	for (const key of Object.keys(fields)) {
		if (!declared || !declared.includes(key))
			return `'${key}' is not a field of the genre '${genreId}'.`
	}
	return null
}
