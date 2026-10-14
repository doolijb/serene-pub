/**
 * 🚧 `summarize` (core only): open the summarize modal on a selection of
 * lines. Lines already in a scene are dropped from the selection; an empty
 * selection, a scene in a session that does not open scenes, and a selection
 * with a gap (the modal's own check, said with a toast) are refused — and
 * the widget keeps its selection.
 *
 * 🚧 With no `messageIds` at all (W3): the conversation's own selection
 * starts instead, and the person picks the lines — what Chronicle's
 * *Summarize scene* asks, as the composer's Lore pane's button did.
 *
 * 🚧 With a `sceneId` (live scenes §7): that scene of this session is
 * summarized as it stands — its range, or its captured lines — in the page's
 * Process scene window, which runs it and saves the review. What a scene
 * divider's *Summarize* asks; `messageIds` is then ignored. A scene whose run
 * still runs or waits in review opens that run's window (§15 G8: a divider's
 * or Chronicle's *Ready to review*), never a second run.
 */

export type SummaryKind = "scene" | "world" | "character"

/** What this answer needs of the page. */
export interface SummarizeDeps {
	/** The lines already summarized into a scene. */
	scened: { has(messageId: number): boolean }
	/** Whether this session opens scenes. */
	opensScenes(): boolean
	/** Make `ids` the page's selection. */
	select(ids: number[]): void
	/** Open the summarize modal (it refuses a gap itself, and stays shut). */
	openSummarize(kind: SummaryKind): void
	/** Whether the modal opened. */
	summarizeOpen(): boolean
	/** Start the conversation's selection, empty (the person picks the lines). */
	startSelection(): void
	/** Is `sceneId` one of this session's scenes? */
	hasScene(sceneId: number): boolean
	/** Summarize an existing scene in the Process scene window. */
	processScene(sceneId: number): void
}

/** Answer one `summarize`. */
export function answerSummarize(params: unknown, deps: SummarizeDeps): void {
	const p = params as Record<string, unknown>
	const kind = p.kind === "scene" || p.kind === "character" ? p.kind : "world"
	if (kind === "scene" && !deps.opensScenes()) throw new Error("this session does not open scenes")
	if (kind === "scene" && p.sceneId !== undefined) {
		const sceneId = p.sceneId
		if (typeof sceneId !== "number" || !Number.isInteger(sceneId) || !deps.hasScene(sceneId))
			throw new Error("that scene is not one of this session's")
		deps.processScene(sceneId)
		return
	}
	if (p.messageIds === undefined) {
		deps.startSelection()
		return
	}
	const ids = ((p.messageIds as number[] | undefined) ?? []).filter((id) => !deps.scened.has(id))
	if (!ids.length) throw new Error("select at least one message")
	deps.select(ids)
	deps.openSummarize(kind)
	// The gap check refused it (and said so): the widget keeps its selection.
	if (!deps.summarizeOpen()) throw new Error("the selection has a gap")
}
