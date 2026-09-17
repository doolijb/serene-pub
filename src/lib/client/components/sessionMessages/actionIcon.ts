/**
 * A declared icon name → the Lucide component (U5c). Actions declare
 * kebab-case names (`book-open-text`); this resolves them against the set
 * once, for every venue, with `Play` as the stand-in for a name the set
 * does not know — an action with an unknown icon is still an action.
 */
import * as Icons from "@lucide/svelte"

export function actionIcon(name?: string): any {
	const pascal = (name ?? "")
		.split("-")
		.map((p) => p.charAt(0).toUpperCase() + p.slice(1))
		.join("")
	return (Icons as any)[pascal] ?? Icons.Play
}
