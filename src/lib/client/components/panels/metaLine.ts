/**
 * The meta line's facts (STYLE-GUIDE §6.4): what `MetaLine.svelte` draws,
 * kept in a `.ts` module so a plain test can import it under `tsc` (a named
 * export from a `.svelte` module is invisible to the ambient `*.svelte` type).
 */

/** One fact on a meta line; empty ones (`null`, `""`, `false`) are dropped. */
export type MetaLineItem = string | number | null | undefined | false

/** The facts that survive, in order: what the line actually draws. */
export function metaLineItems(items: readonly MetaLineItem[]): string[] {
	return items
		.filter((item) => item !== null && item !== undefined && item !== false)
		.map((item) => String(item).trim())
		.filter((item) => item.length > 0)
}
