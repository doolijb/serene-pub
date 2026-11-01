/**
 * 🚧 M2c: the Sessions view's **Apps** group. An applet is a plugin whose
 * genres declare `applet: true` and whose `view` is the plugin id;
 * one plugin is ONE row however many applet genres it offers. A genre is
 * listed only when the server sent its `appletTitle` — the launcher's own test
 * (`appletMount`) passed — so a row never opens "Not available".
 */
export interface AppletGenreLike {
	genreId: string
	name: string
	/** The launcher's title (`sessions:genres`): present exactly when `/apps/<view>` mounts. */
	appletTitle?: string
	shape?: { applet?: boolean; view?: string } | null
}

export interface AppletRow {
	/** The plugin id — the `/apps/<pluginId>` address. */
	pluginId: string
	label: string
	/** A short line naming the plugin's applet genres. */
	subtitle: string
	genres: Array<{ genreId: string; name: string }>
}

/** The applet's owner plugin id, or null for a genre that is not an applet. */
export function appletOwner(
	shape: { applet?: boolean; view?: string } | null | undefined
): string | null {
	return shape?.applet === true && shape.view ? shape.view : null
}

/** The launcher a genre starts in (`/apps/<pluginId>`), or null: an applet genre the server vouched for. */
export function appletLauncher(g: AppletGenreLike | null | undefined): string | null {
	return g?.appletTitle ? appletOwner(g.shape) : null
}

export function appletRows(genres: readonly AppletGenreLike[]): AppletRow[] {
	const byPlugin = new Map<string, AppletRow>()
	for (const g of genres) {
		const owner = appletLauncher(g)
		if (!owner) continue
		let row = byPlugin.get(owner)
		if (!row) {
			row = { pluginId: owner, label: g.appletTitle!, subtitle: "", genres: [] }
			byPlugin.set(owner, row)
		}
		if (!row.genres.some((x) => x.genreId === g.genreId))
			row.genres.push({ genreId: g.genreId, name: g.name })
	}
	const rows = [...byPlugin.values()]
	for (const r of rows) {
		r.subtitle = r.genres.map((g) => g.name).join(" · ")
	}
	return rows.sort((a, b) => a.label.localeCompare(b.label))
}

/** The genre names a `sessionsGenres` filter stands for (unknown ids are dropped). */
export function genreNamesFor(
	ids: readonly string[],
	genres: readonly { genreId: string; name: string }[]
): string[] {
	const names: string[] = []
	for (const id of ids) {
		const n = genres.find((g) => g.genreId === id)?.name
		if (n && !names.includes(n)) names.push(n)
	}
	return names
}
