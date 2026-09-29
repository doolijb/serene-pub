/**
 * 🚧 `change-sprite` (anyone may ask): open the sprite picker for one line.
 *
 * The controls' own rule (a settled character line the viewer may control),
 * held here too: a request is not a grant.
 */

/** A line as this answer reads it. */
export interface SpriteLine {
	characterId?: number | null
	isNarratorResponse?: boolean | null
	isGenerating?: boolean | null
}

/** What this answer needs of the page. */
export interface ChangeSpriteDeps<M extends SpriteLine> {
	findMessage(messageId: number): M | undefined
	canControl(msg: M): boolean
	showSpritePicker(msg: M): void
}

/** Answer one `change-sprite`. */
export function answerChangeSprite<M extends SpriteLine>(params: unknown, deps: ChangeSpriteDeps<M>): void {
	const p = params as Record<string, unknown>
	const msg = deps.findMessage(Number(p.messageId))
	if (!msg?.characterId || msg.isNarratorResponse || msg.isGenerating || !deps.canControl(msg))
		throw new Error("that line's sprite is not yours to change")
	deps.showSpritePicker(msg)
}
