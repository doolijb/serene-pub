/**
 * 🚧 `prompt-details` (anyone may ask): open the prompt one line was written
 * from. A request is not a grant: it is an administrator's (DG1), with
 * context debugging on, and only for a line that recorded its prompt.
 */

/** A line as this answer reads it. */
export interface PromptLine {
	id: number
	debugMeta?: any
}

/** What the page's prompt report shows. */
export interface PromptReport {
	messageId: number
	prompt?: string
	messages?: any[]
	meta: any
}

/** What this answer needs of the page. */
export interface PromptDetailsDeps {
	/** The viewer is an administrator. */
	mayRead: boolean
	contextDebugging: boolean
	findMessage(messageId: number): PromptLine | undefined
	showReport(report: PromptReport): void
}

/** Answer one `prompt-details`. */
export function answerPromptDetails(params: unknown, deps: PromptDetailsDeps): void {
	const p = params as Record<string, unknown>
	if (!deps.mayRead || !deps.contextDebugging)
		throw new Error("prompt details are administrators', with context debugging on")
	const msg = deps.findMessage(Number(p.messageId))
	const meta = (msg as any)?.debugMeta
	if (!msg || !meta) throw new Error("that message has no recorded prompt")
	deps.showReport({ messageId: msg.id, prompt: meta?.prompt, messages: meta?.messages, meta })
}
