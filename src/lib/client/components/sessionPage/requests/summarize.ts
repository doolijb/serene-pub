/**
 * 🚧 `summarize` (core only): open the summarize modal on a selection of
 * lines. Lines already in a scene are dropped from the selection; an empty
 * selection, a scene in a session that does not open scenes, and a selection
 * with a gap (the modal's own check, said with a toast) are refused — and
 * the widget keeps its selection.
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
}

/** Answer one `summarize`. */
export function answerSummarize(params: unknown, deps: SummarizeDeps): void {
	const p = params as Record<string, unknown>
	const ids = ((p.messageIds as number[] | undefined) ?? []).filter((id) => !deps.scened.has(id))
	if (!ids.length) throw new Error("select at least one message")
	const kind = p.kind === "scene" || p.kind === "character" ? p.kind : "world"
	if (kind === "scene" && !deps.opensScenes()) throw new Error("this session does not open scenes")
	deps.select(ids)
	deps.openSummarize(kind)
	// The gap check refused it (and said so): the widget keeps its selection.
	if (!deps.summarizeOpen()) throw new Error("the selection has a gap")
}
