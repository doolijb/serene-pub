/**
 * What Admin › Plugins says about installed extensions, pure so it is tested
 * (`pluginsAdmin.test.ts`): the status a row shows, the backend words, and
 * what uninstalling takes. Uninstall removes the extension and its stored
 * data; its hook-call log history is kept.
 */
import { deletionFor, type AdminDeletion } from "$lib/client/components/admin/changelist"

type Plugin = Pick<
	Sockets.Plugins.PluginRow,
	"pluginId" | "name" | "enabled" | "warm" | "swaps"
>

export const PLUGIN_NOUN = { singular: "plugin", plural: "plugins" }

export function backendWord(b: string): string {
	return b === "quickjs" ? "WASM — max isolation" : b === "ses" ? "SES — faster" : b
}

/**
 * Enabled plugins are "Loaded" or "Idle" only while the sandbox runs —
 * with it off nothing is ever loaded, so the word would be a false promise.
 */
export function pluginStatus(
	p: Plugin,
	sandboxEnabled: boolean
): { key: string; label: string; order: number; title?: string } {
	if (!p.enabled) return { key: "disabled", label: "Disabled", order: 3 }
	if (!sandboxEnabled) return { key: "enabled", label: "Enabled", order: 2 }
	return p.warm
		? { key: "loaded", label: "Loaded", order: 0, title: "A copy is loaded in its sandbox right now" }
		: { key: "idle", label: "Idle", order: 1, title: "Nothing loaded — the first hook call loads it" }
}

export function pluginUninstall(rows: readonly Plugin[]): AdminDeletion {
	const d = deletionFor(rows, {
		noun: PLUGIN_NOUN,
		label: (p) => p.name,
		related: (p) => [
			{ label: "Removed with it", items: ["its stored data"] },
			...(p.swaps?.total
				? [{ label: "Withdrawn", items: [`${p.swaps.total} swap contribution${p.swaps.total === 1 ? "" : "s"}`] }]
				: [])
		],
		consequence: () => "Its hook-call log history is kept"
	})
	return {
		...d,
		title: d.title.replace(/^Delete/, "Uninstall"),
		confirmLabel: d.confirmLabel.replace(/^Delete/, "Uninstall")
	}
}
