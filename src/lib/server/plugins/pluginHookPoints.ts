/**
 * A plugin's declared hook points (R54), registered in this process from the
 * **stored manifest** — the same treatment core's own points get.
 *
 * A **hook** is a declared point where authored code may run (NOMENCLATURE
 * §12). Core declares its points in `@serene-pub/core-catalog`
 * (`CORE_HOOK_DECLARATIONS`) and holds them in-process; a plugin declares its
 * own under `ExtensionDecl.hooks`, and the packager writes them to the
 * manifest's `declaredHooks`, keyed `<slug>:hook/<key>` exactly as the
 * announcement keys them. ⚠ Not the manifest's `hooks` block, which is the
 * wire form of the code the plugin RUNS (`hooks.handlers`, …).
 *
 * Held while the plugin is installed and withdrawn on uninstall, like its
 * events. Nothing dispatches to a declared point yet — core has none of its
 * own implemented either (`pipelines/boot/coreHooks.ts`) — so this is the
 * declaration only: known, listed, and never refused for being a plugin's.
 */

import { CORE_HOOK_DECLARATIONS } from "@serene-pub/core-catalog"
import type { HookDeclaration } from "@serene-pub/sdk"

type HookPoint = HookDeclaration & { id: string; pluginId: string }

/** On `globalThis`: a Vite SSR reload re-evaluates this module. */
const POINTS_KEY = Symbol.for("serene-pub.pluginHookPoints")
const points = ((globalThis as Record<symbol, unknown>)[POINTS_KEY] ??=
	new Map<string, HookPoint>()) as Map<string, HookPoint>

const isIdList = (l: unknown) =>
	l === undefined ||
	(Array.isArray(l) && l.every((x) => typeof x === "string"))

/**
 * Register a plugin's declared hook points; returns a sentence per entry
 * refused. Replaces whatever this plugin registered before.
 */
export function registerPluginHookPoints(
	manifest: unknown,
	pluginId: string
): string[] {
	withdrawPluginHookPoints(pluginId)
	const declared = (manifest as { declaredHooks?: unknown } | null)
		?.declaredHooks
	if (declared === undefined) return []
	if (!declared || typeof declared !== "object" || Array.isArray(declared))
		return [
			`'declaredHooks' is not a record of hook ids — the manifest's hook points were not registered`
		]
	const refused: string[] = []
	const own = `${pluginId}:hook/`
	for (const [id, raw] of Object.entries(declared)) {
		if (!id.startsWith(own) || id.length === own.length) {
			refused.push(
				`hook '${id}' is not under '${own}' — a package declares only its own hook points`
			)
			continue
		}
		const d = raw as Partial<HookDeclaration> | null
		if (
			!d ||
			typeof d.event !== "string" ||
			!d.event ||
			!isIdList(d.before) ||
			!isIdList(d.after)
		) {
			refused.push(
				`hook '${id}' is malformed — it names its event, and 'before'/'after' are lists of hook ids`
			)
			continue
		}
		points.set(id, { ...(d as HookDeclaration), id, pluginId })
	}
	return refused
}

/** Drop a plugin's declared hook points (uninstall, reinstall). */
export function withdrawPluginHookPoints(pluginId: string): void {
	for (const [id, p] of points) if (p.pluginId === pluginId) points.delete(id)
}

/**
 * Every declared hook point this instance knows — core's, then each
 * installed plugin's — by fully-qualified id. `pluginId` is `null` for core's.
 */
export function declaredHookPoints(): Array<
	HookDeclaration & { id: string; pluginId: string | null }
> {
	return [
		...Object.entries(CORE_HOOK_DECLARATIONS).map(([id, d]) => ({
			...d,
			id,
			pluginId: null
		})),
		...points.values()
	]
}

/** One declared hook point by id, or undefined. */
export const declaredHookPoint = (id: string) =>
	declaredHookPoints().find((p) => p.id === id)
