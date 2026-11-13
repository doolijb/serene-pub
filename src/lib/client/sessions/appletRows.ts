/**
 * 🚧 M2d: the Apps view and Home's Apps section read this. An applet is a
 * plugin whose genres declare `applet: true` and whose `view` is the plugin
 * id; one plugin is ONE row however many applet genres it offers. A genre is
 * listed only when the server sent its `appletCard` — the launcher's own test
 * (`appletMount`) passed — so a card never opens "Not available".
 */
export interface AppletGenreLike {
	genreId: string
	name: string
	/** The applet card (`sessions:genres`): present exactly when `/apps/<view>` mounts. */
	appletCard?: {
		title: string
		poster?: string
		logo?: string
		blurb?: string
	}
	shape?: { applet?: boolean; view?: string } | null
}

export interface AppletRow {
	/** The plugin id — the `/apps/<pluginId>` address. */
	pluginId: string
	title: string
	poster?: string
	logo?: string
	blurb?: string
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
	return g?.appletCard ? appletOwner(g.shape) : null
}

export function appletRows(genres: readonly AppletGenreLike[]): AppletRow[] {
	const byPlugin = new Map<string, AppletRow>()
	for (const g of genres) {
		const owner = appletLauncher(g)
		if (!owner) continue
		let row = byPlugin.get(owner)
		if (!row) {
			// All rows of one plugin carry the same card: the first one wins.
			const { title, poster, logo, blurb } = g.appletCard!
			row = { pluginId: owner, title, poster, logo, blurb, genres: [] }
			byPlugin.set(owner, row)
		}
		if (!row.genres.some((x) => x.genreId === g.genreId))
			row.genres.push({ genreId: g.genreId, name: g.name })
	}
	return [...byPlugin.values()].sort((a, b) => a.title.localeCompare(b.title))
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
