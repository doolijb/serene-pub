/**
 * The Models view's **Group by** choice: how the list is gathered under
 * headings — where a model lives, what it can do, or which connection it
 * belongs to.
 *
 * Remembered per browser, like the memory tier: it is a way of reading the
 * list, not a fact about the install, so one person's choice never moves
 * another's view and nothing is stored on the server.
 *
 * ⚠ Pure. No Svelte, no socket.
 */

export type ModelsGroupBy = "where" | "can-do" | "connection"

export const MODELS_GROUP_BY: readonly {
	value: ModelsGroupBy
	label: string
}[] = [
	{ value: "where", label: "Where it lives" },
	{ value: "can-do", label: "What it can do" },
	{ value: "connection", label: "Connection" }
]

export const DEFAULT_MODELS_GROUP_BY: ModelsGroupBy = "where"

/** The one key. Per viewer, per browser — see the header. */
export const MODELS_GROUP_BY_KEY = "serene-pub:modelsGroupBy"

/** A value out of storage, or the default. */
export function parseModelsGroupBy(
	value: string | null | undefined
): ModelsGroupBy {
	return MODELS_GROUP_BY.some((g) => g.value === value)
		? (value as ModelsGroupBy)
		: DEFAULT_MODELS_GROUP_BY
}

/**
 * ⚠ Both accessors are wrapped: `localStorage` is a getter that THROWS in a
 * browser with site data blocked, so `typeof localStorage` is not enough on
 * its own and a bare read would take the whole view down with it.
 */
export function readModelsGroupBy(): ModelsGroupBy {
	try {
		return parseModelsGroupBy(localStorage.getItem(MODELS_GROUP_BY_KEY))
	} catch {
		return DEFAULT_MODELS_GROUP_BY
	}
}

export function writeModelsGroupBy(value: ModelsGroupBy): void {
	try {
		localStorage.setItem(MODELS_GROUP_BY_KEY, value)
	} catch {
		// A viewer whose browser will not store it still gets the grouping they
		// picked for this visit; there is nothing to tell them about.
	}
}
