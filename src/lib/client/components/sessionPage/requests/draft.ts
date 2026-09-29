/**
 * 🚧 `draft` (core only): replace the composer's draft. No `content` empties
 * it. It refuses nothing.
 */

/** What this answer needs of the page's composer. */
export interface DraftDeps {
	setDraft(content: string): void
}

/** Answer one `draft`. */
export function answerDraft(params: unknown, deps: DraftDeps): void {
	const p = params as Record<string, unknown>
	deps.setDraft(String(p.content ?? ""))
}
