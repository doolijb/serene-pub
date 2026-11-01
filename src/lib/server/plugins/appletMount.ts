import { effectivePermissions, declaredPermissions } from "./permissions"
import { surfacesOf, frameSrc } from "./frameHost"

/** The slice of a plugin row the applet launcher reads. */
export interface AppletPluginRow {
	enabled: boolean
	name: string
	version?: string | null
	manifest: unknown
	adminDenied?: string[] | null
}

export interface AppletGenreRow {
	genreId: string
	name: string
	shape?: { applet?: boolean; view?: string } | null
}

export interface AppletMount {
	src: string
	title: string
	genres: Array<{ genreId: string; name: string }>
	grants: string[]
}

/**
 * 🚧 M2c: what `/apps/<pluginId>` mounts. Null (the not-found state) unless the plugin is enabled, offers at least
 * one applet genre it provides the view for, and declares a `session-view` surface. The frame's grants are the
 * plugin's EFFECTIVE `applet:*` keys, plus its storage keys.
 */
export function appletMount(
	pluginId: string,
	plugin: AppletPluginRow | undefined,
	genres: readonly AppletGenreRow[]
): AppletMount | null {
	if (!plugin?.enabled) return null
	const mine = genres.filter(
		(g) => g.shape?.applet === true && g.shape.view === pluginId
	)
	if (!mine.length) return null
	const surface = surfacesOf(plugin.manifest).sessionView
	if (!surface) return null
	const eff = effectivePermissions(
		declaredPermissions(plugin.manifest as any),
		plugin.adminDenied ?? null
	)
	const grants = eff
		.map((p) => p.key)
		.filter((k) => k.startsWith("applet:") || k === "storage" || k === "storage-per-user")
	return {
		src: frameSrc(pluginId, surface.entry, plugin.version ?? undefined),
		title: surface.title ?? plugin.name,
		genres: mine.map((g) => ({ genreId: g.genreId, name: g.name })),
		grants
	}
}
