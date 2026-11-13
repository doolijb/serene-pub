import { effectivePermissions, declaredPermissions } from "./permissions"
import { surfacesOf, frameSrc, isSafeUiPath } from "./frameHost"
import { safeAssetsDir } from "./packageHost"
import { i18nText } from "@serene-pub/sdk"

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
	/** 🚧 M2d: the manifest's `appletCard.poster` as a served `/plugin-assets/…` URL; absent unless safe, under assets, and versioned. */
	poster?: string
	/** 🚧 M2d: the manifest's `appletCard.logo`, served the same way. */
	logo?: string
	/** 🚧 M2d: the manifest's `appletCard.blurb`, resolved `en` text; absent when empty. */
	blurb?: string
	genres: Array<{ genreId: string; name: string }>
	grants: string[]
}

/** 🚧 M2d: the applet card a `sessions:genres` row carries — the mount's title, poster, logo and blurb. */
export interface AppletCard {
	title: string
	poster?: string
	logo?: string
	blurb?: string
}

/** The card of a mount: only the keys the mount has. */
export function appletCardOf(mount: AppletMount): AppletCard {
	return {
		title: mount.title,
		...(mount.poster ? { poster: mount.poster } : {}),
		...(mount.logo ? { logo: mount.logo } : {}),
		...(mount.blurb ? { blurb: mount.blurb } : {})
	}
}

/** A card image path as its served URL, or undefined when unsafe, outside the assets folder, or the row has no version. */
function cardAssetUrl(
	manifest: unknown,
	pluginId: string,
	version: string | null | undefined,
	path: unknown
): string | undefined {
	const dir = safeAssetsDir(manifest)
	if (!dir || !version || typeof path !== "string") return undefined
	if (!isSafeUiPath(path) || !path.startsWith(`${dir.replace(/\/+$/, "")}/`)) return undefined
	return `/plugin-assets/${encodeURIComponent(pluginId)}/${encodeURIComponent(version)}/${path
		.split("/")
		.map(encodeURIComponent)
		.join("/")}`
}

/**
 * 🚧 M2c: what `/apps/<pluginId>` mounts. Null (the not-found state) unless the plugin is enabled, offers at least
 * one applet genre it provides the view for, and declares a `session-view` surface. The frame's grants are the
 * plugin's EFFECTIVE `applet:*` keys, plus its storage keys. 🚧 M2d: the manifest's `appletCard` adds the
 * optional `poster`, `logo` and `blurb` (read defensively; install is the rule, this is the second look).
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
	const card = (plugin.manifest as { appletCard?: unknown } | null)?.appletCard
	const c = card && typeof card === "object" && !Array.isArray(card) ? (card as Record<string, unknown>) : {}
	const poster = cardAssetUrl(plugin.manifest, pluginId, plugin.version, c.poster)
	const logo = cardAssetUrl(plugin.manifest, pluginId, plugin.version, c.logo)
	const blurb = c.blurb === undefined ? "" : i18nText(c.blurb as any)
	return {
		src: frameSrc(pluginId, surface.entry, plugin.version ?? undefined),
		title: surface.title ?? plugin.name,
		...(poster ? { poster } : {}),
		...(logo ? { logo } : {}),
		...(blurb ? { blurb } : {}),
		genres: mine.map((g) => ({ genreId: g.genreId, name: g.name })),
		grants
	}
}
