/**
 * A plugin's node definitions, as **declarations this process knows about**
 * (D-6b).
 *
 * Projecting them into `pipeline_definition_registry` is what makes a plugin's
 * node addressable — the panel renders its parameters from rows, the run path
 * finds its owner and its transport there, and none of that loads the plugin
 * (F6). But the *executor* resolves a node's declaration through the SDK's
 * in-process registry (`getDefinition`), which only ever holds what this build
 * imported: core's contracts and catalog. A plugin's definition is in neither,
 * so a spec placing one halted on `unknown type …` before its binding was ever
 * reached — the rows were right and the run still could not start.
 *
 * So the declaration is registered here as well, from the **stored manifest**,
 * which is data: `install.ts` reads a descriptor out of `nodeDefinitions[].declaration`
 * exactly as it reads the pipeline documents beside it, and this hands it to
 * the SDK's own `describe*Definition`. Nothing evaluates the plugin.
 *
 * ## Two rules this file enforces, because nothing downstream can
 *
 * **Namespace.** A definition a package declares must sit under that package's
 * slug. `defineExtension` refuses otherwise where the author is, and F6 says
 * core reads a package's claims rather than trusting them: a manifest naming
 * `core:task/…` would otherwise re-point core's own row and re-declare core's
 * own type in this process.
 *
 * **What this process registered.** The boot sync projects *everything the
 * running build declares* (`allDefinitions()`) as core's, and marks a core row
 * it no longer declares as removed. A plugin's declaration sitting in that same
 * map would be synced as core's own — owner NULL, `transport: 'node'` — and its
 * node would then be dispatched as a core binding that does not exist. So the
 * pins registered from a plugin are remembered, and the boot sync excludes
 * them.
 *
 * ⚠ **Registration outlives an uninstall, for this process.** The SDK's
 * registry has no way to withdraw one declaration (`_clearDefinitions` empties
 * it), so a package uninstalled while the app runs leaves its descriptor here
 * until a restart. Nothing dispatches through it — the registry ROW is deleted
 * with the package, so no binding is built — and the cost is the sentence a
 * spec still pinning it gets: "no binding registered" rather than "unknown
 * type". Both are dead ends; only the wording differs, and a restart settles
 * it.
 */

import {
	describeInletDefinition,
	describeOracleDefinition,
	describeOutletDefinition,
	describeQueryDefinition,
	describeTaskDefinition,
	getDefinition,
	type Descriptor
} from "@serene-pub/sdk"

/** The kinds a handler can implement — a node on the spine, and nothing else. */
const REGISTER_BY_KIND: Record<string, (d: any) => unknown> = {
	inlet: describeInletDefinition,
	query: describeQueryDefinition,
	task: describeTaskDefinition,
	oracle: describeOracleDefinition,
	outlet: describeOutletDefinition
}

/** Pins this process registered from a plugin's manifest — see the header. */
const fromPlugins = new Set<string>()

/** What {@link registerPluginDefinitions} put in the in-process registry. */
export function pluginDefinitionPins(): ReadonlySet<string> {
	return fromPlugins
}

/**
 * The declarations a stored manifest carries, tolerant of its json being
 * anything and scoped to the package's own namespace.
 *
 * ⏳ A manifest built before the packager carried declarations has summaries
 * without one; those packages install exactly as they did, with no registry row
 * of their own, until they are rebuilt.
 */
export function pluginDeclarationsOf(
	manifest: unknown,
	pluginId: string
): { declarations: Descriptor[]; refused: string[] } {
	const m =
		manifest && typeof manifest === "object" ? (manifest as any) : undefined
	const raw = m?.nodeDefinitions
	const declarations: Descriptor[] = []
	const refused: string[] = []
	if (!Array.isArray(raw)) return { declarations, refused }
	for (const summary of raw) {
		const d = (summary as { declaration?: unknown })?.declaration
		if (!d || typeof d !== "object") continue
		const decl = d as Descriptor
		if (typeof decl.id !== "string" || !decl.id) {
			refused.push(`a node definition declares no id`)
			continue
		}
		if (decl.id.split(":")[0] !== pluginId) {
			refused.push(
				`node definition '${decl.id}': a package may only declare ids under its own ` +
					`namespace ('${pluginId}:…'). The declaration was not registered.`
			)
			continue
		}
		if (!REGISTER_BY_KIND[String(decl.kind)]) {
			refused.push(
				`node definition '${decl.id}': '${String(decl.kind)}' is not a kind a handler ` +
					`implements — an inlet, query, task, oracle or outlet is.`
			)
			continue
		}
		// A package built before K1a projected no `public` from its handler;
		// the handler's own entry still says what its author chose (R62).
		const handlers = m?.hooks?.handlers
		const publicByHandler =
			Array.isArray(handlers) &&
			handlers.some((h: any) => h?.definitionId === decl.id && h?.visibility === "public")
		declarations.push(publicByHandler && !decl.public ? { ...decl, public: true } : decl)
	}
	return { declarations, refused }
}

/**
 * Put a package's declarations in this process's registry.
 *
 * Per declaration and never fatal: a package whose declaration this process
 * already holds under different content is refused *that* definition — the
 * SDK's guard, which is right (a pin means one thing per process) — and says
 * so, rather than costing the install its other declarations. The stored row is
 * updated either way, so the new declaration is live after a restart.
 */
export function registerPluginDefinitions(
	declarations: readonly Descriptor[]
): {
	registered: string[]
	refused: string[]
} {
	const registered: string[] = []
	const refused: string[] = []
	for (const decl of declarations) {
		const describe = REGISTER_BY_KIND[String(decl.kind)]
		if (!describe) continue
		try {
			// `describe*` sets the kind itself; the declaration is passed as it
			// was stored so nothing about it is re-derived here.
			describe(decl)
			fromPlugins.add(decl.id)
			registered.push(decl.id)
		} catch (e) {
			refused.push(
				`node definition '${decl.id}': ${e instanceof Error ? e.message : String(e)}` +
					(getDefinition(decl.id)
						? ` This process already holds a different declaration under that pin; ` +
							`the stored row was updated and a restart picks it up.`
						: "")
			)
		}
	}
	return { registered, refused }
}
