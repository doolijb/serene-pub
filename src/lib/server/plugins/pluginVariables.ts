/**
 * A plugin's context VARIABLES, registered in this process from the **stored
 * manifest** while the plugin is installed (typed templates, P7 live-walk
 * defect, 2026-09-27).
 *
 * `definePluginVariable` runs only in the plugin's own process. Without this,
 * every variable a plugin band names was unknown here, so the SDK's `register()`
 * refused the plugin's banded definitions (`checkBandDeclarations`), the band
 * never reached a template's scope, and law T1 refused the plugin's specs at
 * install — Twenty Questions' `respond` and `judge-guess` ("it uses
 * secretEntry, which nothing supplies here"). The manifest's `variables`
 * section (the packager's `variablesOf`: the declared list plus every band's
 * variable) is data, registered here like its genres (`pluginGenres.ts`).
 *
 * **Order.** Variables → definitions (`register()` checks each band's
 * variable) → specs (T1 reads the bands' scope). `projectPluginPackage` and
 * `bootstrapPlugins` both call this first.
 *
 * **Lifecycle** follows `pluginGenres.ts` (R67): registered while the plugin
 * row exists, enabled or not — a disabled plugin's specs still resolve and a
 * panel still types their templates — and withdrawn on uninstall. Behind the
 * plugins-off flag at boot and on the socket (their callers are gated); the
 * terminal install registers in its own short-lived process.
 *
 * Idempotent: an identical re-declaration is accepted by the registry
 * (`refuseUnlessIdentical`), and a manifest unchanged since a clean
 * registration is not re-read. There is no table: every reader — the panel's
 * `rowSource` path (policy `bands` = `{ key: variableId }`), `templateScopeAt`,
 * law T1 — resolves a band's variable through the in-process registry.
 */

import {
	_withdrawVariable,
	definePluginVariable,
	getVariable,
	pluginVariableFindings,
	type VariableDecl
} from "@serene-pub/sdk"
import { plugins } from "$lib/server/db/schema"
import { notCoreRow } from "./frameHost"

interface Registered {
	/** Ids this plugin put into the registry (not ones something else held). */
	ids: Set<string>
	/** The manifest's `variables` as registered cleanly — skip when unchanged. */
	settled?: string
}

/** On `globalThis` for the reason `pluginGenres.ts` gives (Vite SSR reloads). */
const KEY = Symbol.for("serene-pub.pluginVariables")
const held = ((globalThis as Record<symbol, unknown>)[KEY] ??= new Map<
	string,
	Registered
>()) as Map<string, Registered>

/** Take back every variable one plugin registered. */
export function withdrawPluginVariables(pluginId: string): void {
	const mine = held.get(pluginId)
	if (!mine) return
	for (const id of mine.ids) _withdrawVariable(id)
	held.delete(pluginId)
}

/**
 * Register one plugin's variables from its manifest, replacing what it
 * registered before (an upgrade may have changed one). Returns a sentence per
 * declaration refused; a refusal costs that variable, never the others.
 * Synchronous, so no reader sees the plugin's variables missing mid-swap.
 */
export function registerPluginVariables(
	manifest: unknown,
	pluginId: string
): string[] {
	withdrawPluginVariables(pluginId)
	const raw = (manifest as { variables?: unknown } | null)?.variables
	if (raw === undefined) return []
	if (!Array.isArray(raw))
		return [`'variables' is not a list — the manifest's variables were not registered`]
	const mine: Registered = { ids: new Set() }
	held.set(pluginId, mine)
	const refused: string[] = []
	for (const v of raw as unknown[]) {
		const faults = pluginVariableFindings(pluginId, [v])
		const id = (v as { id?: unknown } | null)?.id
		if (faults.length) {
			refused.push(`${faults.join("; ")} — not registered`)
			continue
		}
		try {
			const existed = !!getVariable(id as string)
			definePluginVariable(pluginId, v as VariableDecl as never)
			if (!existed) mine.ids.add(id as string)
		} catch (e) {
			refused.push(`variable '${String(id)}': ${(e as Error).message}`)
		}
	}
	return refused
}

const signature = (manifest: unknown) =>
	JSON.stringify((manifest as { variables?: unknown } | null)?.variables ?? null)

/**
 * Reconcile the registry with the INSTALLED set: every installed plugin's
 * variables registered, every uninstalled one's withdrawn. Unchanged
 * manifests are left alone.
 */
export async function syncPluginVariables(db: Db): Promise<string[]> {
	const rows: Array<{ pluginId: string; manifest: unknown }> = await db
		.select({ pluginId: plugins.pluginId, manifest: plugins.manifest })
		.from(plugins)
		.where(notCoreRow())
	const installed = new Set(rows.map((r) => r.pluginId))
	for (const pluginId of [...held.keys()])
		if (!installed.has(pluginId)) withdrawPluginVariables(pluginId)
	const refused: string[] = []
	for (const row of rows) {
		const sig = signature(row.manifest)
		if (held.get(row.pluginId)?.settled === sig) continue
		const lines = registerPluginVariables(row.manifest, row.pluginId)
		const mine = held.get(row.pluginId)
		if (mine && !lines.length) mine.settled = sig
		for (const line of lines) refused.push(`'${row.pluginId}': ${line}`)
	}
	return refused
}
