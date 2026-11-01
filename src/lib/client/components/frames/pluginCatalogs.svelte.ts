/**
 * 🚧 **A plugin's string catalog, on the client** (M0, SHAPES L5; lane P3).
 *
 * `pluginCatalogFor(pluginId, language)` is reactive: `undefined` while the
 * first ask is in flight, then the catalog's entries (empty when the package
 * ships none for the language, or the ask was refused — no retry loop). The
 * widget wire reads it so a frame's `ctx.t` resolves plugin catalog → the
 * app's translation → English.
 */
import { SvelteMap } from "svelte/reactivity"
import { awaitReply } from "$lib/client/utils/awaitReply"
import { typedSocketOrNull } from "$lib/client/sockets/typedSocket"

const catalogs = new SvelteMap<string, ReadonlyMap<string, string>>()
const asked = new Set<string>()

export function pluginCatalogFor(
	pluginId: string,
	language: string
): ReadonlyMap<string, string> | undefined {
	const key = `${pluginId}|${language}`
	const have = catalogs.get(key)
	if (have) return have
	if (asked.has(key)) return undefined
	const socket = typedSocketOrNull()
	if (!socket) return undefined
	asked.add(key)
	awaitReply({
		socket,
		event: "pluginCatalogs:get",
		errorEvent: "pluginCatalogs:get:error",
		params: { pluginId, language },
		match: (r) => r?.pluginId === pluginId && r?.language === language,
		timeoutMs: 30_000
	}).then(
		(res) => catalogs.set(key, new Map(Object.entries(res?.entries ?? {}))),
		() => catalogs.set(key, new Map())
	)
	return undefined
}
