/**
 * Which items the Connections **Add** menu offers.
 *
 * Pulled out of `AddMenu.svelte` so the gating is a plain function a unit test
 * can read: the menu's items live in a closed popover, which a server render
 * never shows.
 */

export type AddMenuItemKey =
	| "connection"
	| "koboldcpp"
	| "ollama"
	| "model"
	| "by-name"

/**
 * Whether this instance can run a local runtime (KoboldCPP, Ollama) for
 * itself. False in the Android app, where the server refuses to switch either
 * manager on — the same predicate the setup wizard's Choose an LLM step hides
 * its "KoboldCPP, run by Serene Pub" and managed Ollama doors on. Settings not
 * yet arrived read as true, as they do there.
 */
export function canRunLocalRuntimes(
	settings: { isAndroidWrapper?: boolean } | null | undefined
): boolean {
	return !settings?.isAndroidWrapper
}

/** The Add menu's items, in display order. */
export function addMenuItemKeys(opts: {
	canAddByName: boolean
	canRunLocalRuntimes: boolean
}): AddMenuItemKey[] {
	return [
		"connection",
		...(opts.canRunLocalRuntimes ? (["koboldcpp", "ollama"] as const) : []),
		"model",
		...(opts.canAddByName ? (["by-name"] as const) : [])
	]
}
