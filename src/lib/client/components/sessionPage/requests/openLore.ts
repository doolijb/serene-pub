/**
 * 🚧 `open-lore` (anyone may ask): open the lorebooks panel on a lorebook,
 * an entry or a scene. Nothing is refused: a field of the wrong shape is
 * dropped, and any scope but `'scenes'` is `'history'`.
 */

/** Where the lorebooks panel opens. */
export interface LoreTarget {
	lorebookId: number | undefined
	scope: "history" | "scenes"
	entryId: number | undefined
	sceneId: number | undefined
}

/** What this answer needs of the page's panels. */
export interface OpenLoreDeps {
	/** Point the lorebooks panel at `target`. */
	showLore(target: LoreTarget): void
	/** Open the lorebooks panel (never toggling it shut). */
	openLorebooksPanel(): void
}

/** Answer one `open-lore`. */
export function answerOpenLore(params: unknown, deps: OpenLoreDeps): void {
	const p = params as Record<string, unknown>
	deps.showLore({
		lorebookId: typeof p.lorebookId === "number" ? p.lorebookId : undefined,
		scope: p.scope === "scenes" ? "scenes" : "history",
		entryId: typeof p.entryId === "number" ? p.entryId : undefined,
		sceneId: typeof p.sceneId === "number" ? p.sceneId : undefined
	})
	deps.openLorebooksPanel()
}
