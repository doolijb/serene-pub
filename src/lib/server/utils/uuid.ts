const UUID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * True for a well-formed uuid string (any RFC4122-ish variant, not
 * restricted to v4 — Postgres's own `uuid` column type is similarly
 * lenient). Used to validate uuids pulled from untrusted import data before
 * they reach a `uuid`-typed DB column: a malformed value passed straight to
 * Postgres surfaces as a raw, unhelpful driver error instead of being
 * treated as "no uuid, import as new".
 */
export function isValidUuid(value: unknown): value is string {
	return typeof value === "string" && UUID_PATTERN.test(value)
}
