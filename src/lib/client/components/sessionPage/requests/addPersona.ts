/**
 * 🚧 `add-persona` (core only): open the page's add-persona modal. It takes
 * no params and refuses nothing.
 */

/** What this answer needs of the page. */
export interface AddPersonaDeps {
	showAddPersona(): void
}

/** Answer one `add-persona`. */
export function answerAddPersona(_params: unknown, deps: AddPersonaDeps): void {
	deps.showAddPersona()
}
