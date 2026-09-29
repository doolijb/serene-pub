/**
 * Whether this host can mount a PLUGIN's or an AUTHORED component at all
 * (F1): each built artifact records what it was built against — the widget
 * protocol and the host-element vocabulary (`builtAgainst`, the SDK's
 * `ComponentBuiltAgainst`) — and a host that has moved on refuses it with a
 * sentence ("built for widget protocol 3; this host speaks 2") instead of
 * mounting it into a failure nobody can read.
 *
 * Judged at OFFER time, server-side: an incompatible component is not offered
 * (as a disabled plugin's is not), so no page ever imports it, and the reason
 * rides in the admin data (`PluginRow.componentRefusals`,
 * `Components.Summary.refusal`). Core's own components are built with the
 * app and never judged.
 *
 * - A plugin's record is its manifest component entry's `builtAgainst`,
 *   written by `serene-pub build`. An entry without one predates the record
 *   and is judged compatible.
 * - An authored component's is read back from its stored toolchain
 *   fingerprint (`builtAgainstOfFingerprint`) — the compiler writes both. A
 *   compiler instance recompiles a row whose fingerprint differs at boot, so
 *   this bites where it cannot: an imported artifact on a no-compiler
 *   instance, or a boot whose compiler is unavailable.
 *
 * Light: no compiler import (`@serene-pub/cli/component-source` is the pure
 * half), because every session view reads it.
 */
import { componentBuiltAgainstFinding } from "@serene-pub/sdk"
import { builtAgainstOfFingerprint } from "@serene-pub/cli/component-source"

/** One of a plugin's components this host will not mount, and why. */
export interface ComponentRefusal {
	slug: string
	reason: string
}

const componentsOf = (manifest: unknown): Array<{ slug?: unknown; builtAgainst?: unknown }> => {
	const raw = (manifest as { components?: unknown } | null | undefined)?.components
	return Array.isArray(raw) ? raw.filter((c) => c && typeof c === "object") : []
}

/**
 * Why this host will not mount the plugin component `slug`, or `undefined`
 * when it may (or when the manifest does not declare it — the caller's own
 * "not declared" check decides that).
 */
export function pluginComponentRefusal(manifest: unknown, slug: string): string | undefined {
	const entry = componentsOf(manifest).find((c) => c.slug === slug)
	return entry ? componentBuiltAgainstFinding(entry.builtAgainst) : undefined
}

/** Every component of a plugin this host will not mount — the admin plugins list shows them. */
export function pluginComponentRefusals(manifest: unknown): ComponentRefusal[] {
	const out: ComponentRefusal[] = []
	for (const c of componentsOf(manifest)) {
		if (typeof c.slug !== "string") continue
		const reason = componentBuiltAgainstFinding(c.builtAgainst)
		if (reason) out.push({ slug: c.slug, reason })
	}
	return out
}

/** Why this host will not mount an authored component compiled under `fingerprint`, or `undefined`. */
export function authoredComponentRefusal(fingerprint: string | null | undefined): string | undefined {
	return componentBuiltAgainstFinding(builtAgainstOfFingerprint(fingerprint))
}
