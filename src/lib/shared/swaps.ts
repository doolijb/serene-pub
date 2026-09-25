/**
 * Session swaps (PLAN-turn-order R28–R40): `{ spec, node, definition }` — a
 * definition a spec's node offers, seeded at create by a preset's
 * `defaults.swaps` or the form. The SDK's `StoredSwapContribution` is the
 * shape; this is the one reader of it off the wire or a stored json column,
 * shared by the create form and the create handler so both drop the same
 * malformed entries.
 */
import type { StoredSwapContribution } from "@serene-pub/sdk"

export type { StoredSwapContribution }

/** Well-formed entries only: three non-empty strings. Anything else is dropped. */
export function storedSwapsOf(value: unknown): StoredSwapContribution[] {
	if (!Array.isArray(value)) return []
	return value.flatMap((v) => {
		const c = v as Partial<StoredSwapContribution> | null
		return c &&
			typeof c.spec === "string" &&
			c.spec &&
			typeof c.node === "string" &&
			c.node &&
			typeof c.definition === "string" &&
			c.definition
			? [{ spec: c.spec, node: c.node, definition: c.definition }]
			: []
	})
}
