import crypto from "crypto"

/**
 * Recursively sorts object keys so two structurally-identical values that
 * differ only in key order serialize identically. A plain
 * `JSON.stringify(value, Object.keys(value).sort())` looks like it does this
 * but doesn't — an array replacer is a key *allowlist* applied at every
 * nesting level, so nested objects whose keys aren't in that top-level-only
 * array get silently stringified as `{}`. This walks the structure directly
 * instead, so every level is both fully preserved and stably ordered.
 */
export function sortKeysDeep(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sortKeysDeep)
	if (value !== null && typeof value === "object") {
		const sorted: Record<string, unknown> = {}
		for (const key of Object.keys(
			value as Record<string, unknown>
		).sort()) {
			sorted[key] = sortKeysDeep((value as Record<string, unknown>)[key])
		}
		return sorted
	}
	return value
}

/**
 * Deterministic content hash used to detect whether an export/import
 * candidate is identical to what's already on record — hashes the
 * *current* live state on both sides at comparison time (rather than a
 * persisted hash column) so there's nothing to keep in sync when child rows
 * change independently of their parent (eg. lorebook entries living in a
 * separate table from the lorebook row itself).
 */
export function hashCanonicalJson(value: unknown): string {
	return crypto
		.createHash("sha256")
		.update(JSON.stringify(sortKeysDeep(value)))
		.digest("hex")
}
