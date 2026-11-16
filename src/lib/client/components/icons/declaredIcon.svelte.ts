import type { Component } from "svelte"
import { CURATED_ICONS } from "./curatedIcons"
import DeclaredIconPlaceholder from "./DeclaredIconPlaceholder.svelte"

/**
 * Settled lazy loads: an icon module, or `null` for an unknown name. A memo
 * of immutable modules, not state — a plain `Map`, deliberately (a
 * `$state(new Map())` is not reactive on mutation anyway). Re-runs are driven
 * by `settled` below.
 */
const resolved = new Map<string, Component<any> | null>()

/** Loads in flight, so two sites asking for one name import once. */
const inFlight = new Map<string, Promise<void>>()

/** Bumped when any load settles; `declaredIconOf` reads it so callers re-run. */
let settled = $state(0)

/** `Lucide…` and `…Icon` are the barrel's other spellings of an icon. */
const curatedOf = (name: string): Component<any> | undefined => {
	const own = (n: string) =>
		Object.hasOwn(CURATED_ICONS, n) ? CURATED_ICONS[n] : undefined
	return (
		own(name) ??
		(name.startsWith("Lucide") ? own(name.slice(6)) : undefined) ??
		(name.endsWith("Icon") ? own(name.slice(0, -4)) : undefined)
	)
}

function load(name: string): void {
	if (inFlight.has(name)) return
	const done = (icon: Component<any> | null) => {
		resolved.set(name, icon)
		settled++
	}
	inFlight.set(
		name,
		import("./lucideIconModules").then(
			(m) => m.loadLucideIcon(name).then(done, () => done(null)),
			() => done(null)
		)
	)
}

/**
 * The icon component for a declared lucide name (an export name, verbatim).
 * A curated name answers at once; any other loads lazily — the same-size
 * placeholder is returned until it arrives, and a template, `{@const}` or
 * `$derived` that called this re-runs and swaps it in. An unknown name, or a
 * falsy one, draws `fallback`. Owner ruling ★P15, 2026-11-13: no warning.
 */
export function declaredIconOf(
	name: string | undefined | null,
	fallback: Component<any>
): Component<any> {
	if (!name) return fallback
	const curated = curatedOf(name)
	if (curated) return curated
	void settled
	if (resolved.has(name)) return resolved.get(name) ?? fallback
	load(name)
	return DeclaredIconPlaceholder as Component<any>
}
